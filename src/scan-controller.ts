import { RUN_QUERY_PARAM } from './protocol';
import { replaceStoryResult } from './report';
import { createRunId, type ScanSession } from './scan-story';
import type { StoryTarget } from './storybook-compat';
import type { StoryResult } from './model';

export function createScanController(
  getTargets: (runId: string) => StoryTarget[],
  observe: (target: StoryTarget, runId: string, signal: AbortSignal) => Promise<StoryResult>,
) {
  let session: ScanSession = { phase: 'idle' };
  let abort: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ScanSession) => { session = next; listeners.forEach((listener) => listener()); };
  const run = async (retrying = false) => {
    if (abort || (retrying && session.phase !== 'finished')) return;
    let targets = retrying && session.phase === 'finished' ? session.targets : [];
    let results = retrying && session.phase === 'finished' ? session.results : [];
    const current = new AbortController();
    abort = current;
    try {
      const runId = createRunId();
      if (!retrying) {
        publish({ phase: 'running', targets, results, retrying, progress: { completed: 0, total: 0 } });
        targets = getTargets(runId);
      }
      const pending = targets.filter((target) => !retrying || results.find((result) => result.storyId === target.id)?.status !== 'complete');
      if (retrying && pending.length === 0) return;
      let completed = 0;
      publish({ phase: 'running', targets, results, retrying, progress: { completed, total: pending.length } });
      for (const target of pending) {
        if (current.signal.aborted) break;
        publish({ phase: 'running', targets, results, retrying, progress: { completed, total: pending.length, current: target.name } });
        const preview = new URL(target.previewHref);
        preview.searchParams.set(RUN_QUERY_PARAM, runId);
        const result = await observe({ ...target, previewHref: preview.href }, runId, current.signal);
        if (abort !== current) return;
        results = replaceStoryResult(results, result);
        completed += 1;
        publish({ phase: 'running', targets, results, retrying, progress: { completed, total: pending.length } });
        if (result.status === 'cancelled') break;
      }
      if (abort === current) publish({ phase: 'finished', outcome: current.signal.aborted ? 'cancelled' : 'complete', targets, results });
    } catch (caught) {
      if (abort === current) publish({ phase: 'finished', outcome: 'error', targets, results,
        error: caught instanceof Error ? caught.message : 'The scan stopped unexpectedly.' });
    } finally {
      if (abort === current) abort = undefined;
    }
  };
  return {
    getSnapshot: () => session,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run: () => run(), retry: () => run(true), cancel: () => abort?.abort(),
    clear: () => { const previous = abort; abort = undefined; previous?.abort(); publish({ phase: 'idle' }); },
  };
}
export type ScanController = ReturnType<typeof createScanController>;
