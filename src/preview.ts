import { addons } from 'storybook/preview-api';
import { STORY_ERRORED, STORY_FINISHED, STORY_MISSING, STORY_RENDERED, STORY_RENDER_PHASE_CHANGED, STORY_THREW_EXCEPTION } from 'storybook/internal/core-events';
import type { ElementErrorObservation, FontObservation, ImageObservation, Observation, ResourceObservation } from './model';
import { MESSAGE_NAMESPACE, MESSAGE_TYPE, MESSAGE_VERSION, RUN_QUERY_PARAM, STORY_QUERY_PARAM, type ScanMessage } from './protocol';

const params = new URLSearchParams(window.location.search);
const runId = params.get(RUN_QUERY_PARAM);
const storyId = params.get(STORY_QUERY_PARAM);

function snapshotFonts(): Map<FontFace, FontFaceLoadStatus> {
  const faces = new Map<FontFace, FontFaceLoadStatus>();
  if (!document.fonts) return faces;
  for (const face of document.fonts) faces.set(face, face.status);
  return faces;
}

function normalizedUrl(value: string): string {
  try { return new URL(value, window.location.href).href; } catch { return value; }
}

function runInstrumentation(currentRunId: string, currentStoryId: string): void {
  const startedAt = performance.now();
  const resources: ResourceObservation[] = [];
  const errors: ElementErrorObservation[] = [];
  const warnings: string[] = [];
  const resourceKeys = new Set<string>();
  const errorKeys = new Set<string>();
  const pendingElements = new Map<HTMLLinkElement | HTMLScriptElement, string>();
  const seenElementUrls = new WeakMap<HTMLLinkElement | HTMLScriptElement, string>();
  const observedElements = new WeakSet<HTMLLinkElement | HTMLScriptElement>();
  let lastActivity = performance.now();
  let renderFonts: Map<FontFace, FontFaceLoadStatus> | undefined;
  let sent = false;
  let settling = false;

  const addResource = (url: string, initiatorType: string, startTime: number) => {
    const normalized = normalizedUrl(url);
    const key = `${normalized}|${initiatorType}`;
    if (resourceKeys.has(key)) return;
    if (resources.length >= 5000) {
      if (!warnings.includes('Request limit reached; request coverage is incomplete.')) warnings.push('Request limit reached; request coverage is incomplete.');
      return;
    }
    resourceKeys.add(key);
    resources.push({ url: normalized, initiatorType, startTime });
    lastActivity = performance.now();
  };

  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('resource')) {
    try {
      performance.setResourceTimingBufferSize?.(2000);
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < startedAt) continue;
          const resource = entry as PerformanceResourceTiming;
          addResource(resource.name, resource.initiatorType, resource.startTime);
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      warnings.push('Resource Timing observation is unavailable; request coverage is incomplete.');
    }
  } else {
    warnings.push('Resource Timing is unavailable; request coverage is incomplete.');
  }
  window.addEventListener('resourcetimingbufferfull', () => {
    if (!warnings.includes('Resource Timing buffer filled; request coverage is incomplete.')) {
      warnings.push('Resource Timing buffer filled; request coverage is incomplete.');
    }
  });

  // Record initiated API calls as well: mocked or long-running calls may not yield timing entries.
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      addResource(url, 'fetch', performance.now());
      return originalFetch.call(this, input, init);
    };
  } else {
    warnings.push('fetch is unavailable; API request coverage is incomplete.');
  }
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async = true, username?: string | null, password?: string | null) {
    xhrUrls.set(this, String(url));
    return Reflect.apply(originalOpen, this, [method, url, async, username, password]);
  };
  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const url = xhrUrls.get(this);
    if (url) addResource(url, 'xmlhttprequest', performance.now());
    return originalSend.call(this, body);
  };

  const onElementError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tag = target.tagName;
    if (!['IMG', 'LINK', 'SCRIPT', 'VIDEO', 'AUDIO', 'SOURCE'].includes(tag)) return;
    const value = (target as HTMLImageElement).currentSrc || (target as HTMLLinkElement).href || (target as HTMLScriptElement).src || target.getAttribute('src') || '';
    if (!value) return;
    const url = normalizedUrl(value);
    const key = `${tag}|${url}`;
    if (errorKeys.has(key)) return;
    errorKeys.add(key);
    errors.push({ tag, url });
    lastActivity = performance.now();
  };
  window.addEventListener('error', onElementError, true);

  const resourceElementUrl = (element: Element): string | undefined => {
    if (element instanceof HTMLLinkElement) {
      if (!element.relList.contains('stylesheet') || !element.getAttribute('href')) return;
      return element.href;
    }
    if (element instanceof HTMLScriptElement && element.getAttribute('src')) return element.src;
  };
  const watchResourceElement = (element: Element) => {
    if (!(element instanceof HTMLLinkElement || element instanceof HTMLScriptElement)) return;
    const url = resourceElementUrl(element);
    if (!url) {
      pendingElements.delete(element);
      seenElementUrls.delete(element);
      return;
    }
    if (seenElementUrls.get(element) === url) return;
    seenElementUrls.set(element, url);
    pendingElements.set(element, url);
    addResource(url, element instanceof HTMLLinkElement ? 'link' : 'script', performance.now());
    if (observedElements.has(element)) return;
    observedElements.add(element);
    const onSettled = () => {
      pendingElements.delete(element);
      lastActivity = performance.now();
    };
    element.addEventListener('load', onSettled);
    element.addEventListener('error', onSettled);
  };
  const changes = new MutationObserver((records) => {
    lastActivity = performance.now();
    for (const record of records) {
      if (record.type === 'attributes') watchResourceElement(record.target as Element);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        watchResourceElement(node);
        for (const resource of node.querySelectorAll('link[href], script[src]')) watchResourceElement(resource);
      }
    }
  });
  changes.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'class', 'href', 'rel'] });
  if (!document.fonts) warnings.push('FontFaceSet is unavailable; font coverage is incomplete.');

  const observation = (): Observation => {
    const after = snapshotFonts();
    const fonts: FontObservation[] = [];
    for (const face of new Set([...(renderFonts?.keys() ?? []), ...after.keys()])) {
      fonts.push({
        family: face.family,
        weight: face.weight,
        style: face.style,
        atRender: renderFonts?.get(face) ?? 'unavailable',
        after: after.get(face) ?? renderFonts?.get(face) ?? 'unloaded',
      });
    }
    const images: ImageObservation[] = [...document.images]
      .filter((image) => Boolean(image.currentSrc || image.src))
      .map((image) => ({ url: normalizedUrl(image.currentSrc || image.src), complete: image.complete, naturalWidth: image.naturalWidth }));
    return { resources, images, elementErrors: errors, fonts, warnings };
  };

  const send = (status: ScanMessage['status'], error?: string) => {
    if (sent) return;
    sent = true;
    changes.disconnect();
    const message: ScanMessage = {
      namespace: MESSAGE_NAMESPACE,
      version: MESSAGE_VERSION,
      type: MESSAGE_TYPE,
      runId: currentRunId,
      storyId: currentStoryId,
      status,
      observation: observation(),
      ...(error ? { error } : {}),
    };
    window.parent.postMessage(message, window.location.origin);
  };

  const settle = async () => {
    if (settling || sent) return;
    settling = true;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const settlingStarted = performance.now();
    let fontReady = !document.fonts;
    if (document.fonts) void document.fonts.ready.then(() => { fontReady = true; });
    while (performance.now() - settlingStarted < 12000) {
      for (const image of document.images) if (image.loading !== 'eager') image.loading = 'eager';
      for (const element of pendingElements.keys()) {
        if (!element.isConnected) {
          pendingElements.delete(element);
          seenElementUrls.delete(element);
        }
      }
      const pendingImages = [...document.images].some((image) => Boolean(image.currentSrc || image.src) && !image.complete);
      if (fontReady && (!document.fonts || document.fonts.status === 'loaded') && !pendingImages && pendingElements.size === 0 && performance.now() - lastActivity >= 500) {
        send(warnings.length ? 'unsupported' : 'complete');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    warnings.push('Assets did not settle within 12 seconds.');
    send('timeout');
  };

  const channel = addons.getChannel();
  channel.on(STORY_RENDERED, (renderedId: string) => {
    if (renderedId === currentStoryId) renderFonts = snapshotFonts();
  });
  channel.on(STORY_FINISHED, (payload: { storyId: string; status: 'success' | 'error' }) => {
    if (payload.storyId !== currentStoryId) return;
    if (payload.status === 'error') send('render-error', 'Storybook reported a render or play error.');
    else void settle();
  });
  channel.on(STORY_RENDER_PHASE_CHANGED, (payload: { storyId?: string; newPhase?: string }) => {
    if (payload.storyId === currentStoryId && payload.newPhase === 'errored') send('render-error', 'Storybook reported a render error.');
  });
  channel.on(STORY_ERRORED, () => send('render-error', 'Storybook reported a story error.'));
  channel.on(STORY_THREW_EXCEPTION, () => send('render-error', 'The story threw an exception while rendering.'));
  channel.on(STORY_MISSING, () => send('render-error', 'Storybook could not find this story.'));
}

if (runId && storyId) runInstrumentation(runId, storyId);

export default {};
