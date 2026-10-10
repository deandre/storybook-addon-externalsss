import { useRef, useState } from 'react';
import type { API } from 'storybook/manager-api';
import { classifyObservation, type StoryResult } from './model';
import { MESSAGE_NAMESPACE, MESSAGE_TYPE, RUN_QUERY_PARAM, STORY_QUERY_PARAM, isScanMessage, isScanMessageCandidate } from './protocol';
import type { ScanState } from './report';

const STORY_LIMIT_MS = 15000;

export interface StoryTarget {
  id: string;
  name: string;
  previewHref: string;
  managerHref: string;
}

export type ScanSession =
  | { phase: 'idle' }
  | { phase: 'running'; targets: StoryTarget[]; results: StoryResult[] }
  | { phase: 'finished'; outcome: ScanState; targets: StoryTarget[]; results: StoryResult[]; error?: string };

function createRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function wrapperMarkup(previewHref: string, expectedOrigin: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style></head><body><iframe id="story" src="${escapeAttribute(previewHref)}" title="Story scan"></iframe><script>
    var expectedOrigin = ${JSON.stringify(expectedOrigin)};
    window.addEventListener('message', function(event) {
      var story = document.getElementById('story');
      if (event.source !== story.contentWindow || event.origin !== expectedOrigin) return;
      var data = event.data;
      if (!data || data.namespace !== ${JSON.stringify(MESSAGE_NAMESPACE)} || data.type !== ${JSON.stringify(MESSAGE_TYPE)}
        || typeof data.runId !== 'string' || typeof data.storyId !== 'string') return;
      parent.postMessage(data, expectedOrigin);
    });
  </script></body></html>`;
}

function scanStory(target: StoryTarget, runId: string, signal: AbortSignal): Promise<StoryResult> {
  return new Promise((resolve, reject) => {
    const outer = document.createElement('iframe');
    outer.title = `Externalsss background scan of ${target.name}`;
    outer.tabIndex = -1;
    outer.setAttribute('aria-hidden', 'true');
    Object.assign(outer.style, {
      position: 'fixed', left: '-10000px', top: '0', width: '1280px', height: '800px',
      border: '0', opacity: '0', pointerEvents: 'none',
    });
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal.removeEventListener('abort', onAbort);
      outer.remove();
    };
    const finish = (result: StoryResult) => {
      if (settled) return;
      cleanup();
      resolve(result);
    };
    const onAbort = () => finish({ storyId: target.id, status: 'cancelled', findings: [], warnings: [] });
    const onMessage = (event: MessageEvent) => {
      if (event.source !== outer.contentWindow || event.origin !== window.location.origin
        || !isScanMessageCandidate(event.data, runId, target.id)) return;
      if (!isScanMessage(event.data)) {
        finish({ storyId: target.id, status: 'unsupported', findings: [], warnings: ['Invalid scan result received.'] });
        return;
      }
      try {
        finish({
          storyId: target.id,
          status: event.data.status,
          findings: classifyObservation(event.data.observation, target.previewHref),
          warnings: event.data.observation.warnings,
          error: event.data.error,
        });
      } catch {
        finish({ storyId: target.id, status: 'unsupported', findings: [], warnings: ['Could not classify the scan result.'] });
      }
    };
    if (signal.aborted) { onAbort(); return; }
    window.addEventListener('message', onMessage);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish({ storyId: target.id, status: 'timeout', findings: [], warnings: ['No scan result arrived within 15 seconds.'] }), STORY_LIMIT_MS);
    try {
      outer.srcdoc = wrapperMarkup(target.previewHref, window.location.origin);
      document.body.appendChild(outer);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function useCatalogScan(api: API) {
  const [session, setSession] = useState<ScanSession>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);

  const run = async () => {
    if (controller.current) return;
    let targets: StoryTarget[] = [];
    let results: StoryResult[] = [];
    try {
      const index = api.getIndex();
      if (!index) throw new Error('Storybook is still loading the story index. Try again shortly.');
      const scanRunId = createRunId();
      targets = Object.values(index.entries).filter((entry) => entry.type === 'story').map((entry) => {
        const hrefs = api.getStoryHrefs(entry.id, {
          inheritArgs: false, inheritGlobals: true,
          queryParams: { [RUN_QUERY_PARAM]: scanRunId, [STORY_QUERY_PARAM]: entry.id },
        });
        return {
          id: entry.id, name: entry.title ? `${entry.title} / ${entry.name}` : entry.name,
          previewHref: new URL(hrefs.previewHref, window.location.href).href,
          managerHref: hrefs.managerHref,
        };
      });
      const abort = new AbortController();
      controller.current = abort;
      setSession({ phase: 'running', targets, results });
      for (const target of targets) {
        if (abort.signal.aborted) break;
        const result = await scanStory(target, scanRunId, abort.signal);
        results = [...results, result];
        setSession({ phase: 'running', targets, results });
        if (result.status === 'cancelled') break;
      }
      setSession({ phase: 'finished', outcome: abort.signal.aborted ? 'cancelled' : 'complete', targets, results });
    } catch (caught) {
      setSession({ phase: 'finished', outcome: 'error', targets, results,
        error: caught instanceof Error ? caught.message : 'The scan stopped unexpectedly.' });
    } finally {
      controller.current = null;
    }
  };

  return { session, run, cancel: () => controller.current?.abort() };
}
