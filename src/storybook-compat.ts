import type { API } from 'storybook/manager-api';
import { RUN_QUERY_PARAM, STORY_QUERY_PARAM } from './protocol';

export interface StoryTarget {
  id: string;
  name: string;
  previewHref: string;
  managerHref: string;
}

type CatalogAPI = Pick<API, 'getUrlState'> & Partial<Pick<API, 'getIndex' | 'getStoryHrefs'>>;
type CatalogIndex = ReturnType<API['getIndex']>;

/** Keep newer convenience APIs optional so the same bundle runs on Storybook 9. */
export function getStoryTargets(
  api: CatalogAPI,
  runId: string,
  { index: fallbackIndex, locationHref = window.location.href, previewUrl = (globalThis as { PREVIEW_URL?: string }).PREVIEW_URL }:
    { index?: CatalogIndex; locationHref?: string; previewUrl?: string } = {},
): StoryTarget[] {
  const index = typeof api.getIndex === 'function' ? api.getIndex() : fallbackIndex;
  if (!index) throw new Error('Storybook is still loading the story index. Try again shortly.');
  const customParams = api.getUrlState().queryParams;
  const reservedParams = ['args', 'id', 'viewMode', 'refId', 'path', 'embed', 'freeze', 'addonPanel', 'externalsssBridge', RUN_QUERY_PARAM, STORY_QUERY_PARAM];
  const inheritedParams = Object.fromEntries(Object.entries(customParams ?? {})
    .filter(([key, value]) => value !== undefined && key !== 'globals' && !reservedParams.includes(key))) as Record<string, string>;

  return Object.values(index.entries).filter((entry) => entry.type === 'story' && !('refId' in entry && entry.refId)).map((entry) => {
    const queryParams = { [RUN_QUERY_PARAM]: runId, [STORY_QUERY_PARAM]: entry.id };
    // Native URL helpers append a query string, so use our URL builder when
    // a custom preview URL already contains query parameters or a fragment.
    const customPreview = previewUrl ? new URL(previewUrl, locationHref) : undefined;
    if (typeof api.getStoryHrefs === 'function' && !customPreview?.search && !customPreview?.hash) {
      const hrefs = api.getStoryHrefs(entry.id, { inheritArgs: false, inheritGlobals: true, queryParams });
      const preview = new URL(hrefs.previewHref, locationHref);
      const manager = new URL(hrefs.managerHref, locationHref);
      // Set custom parameters through URLSearchParams: the native helper can
      // drop them or leave characters such as '&' unescaped.
      for (const [key, value] of Object.entries(inheritedParams)) {
        preview.searchParams.set(key, value);
        manager.searchParams.set(key, value);
      }
      return {
        id: entry.id,
        name: entry.title ? `${entry.title} / ${entry.name}` : entry.name,
        previewHref: preview.href,
        managerHref: manager.href,
      };
    }

    const manager = new URL(locationHref);
    manager.search = '';
    manager.hash = '';
    // Match Storybook's directory handling for both /catalog/ and /catalog/index.html.
    const directory = manager.pathname.replace(/\/[^/]*\.html$/, '').replace(/\/?$/, '/');
    const preview = new URL(previewUrl || `${directory}iframe.html`, manager);
    for (const [key, value] of Object.entries(customParams ?? {})) {
      if (value !== undefined) {
        manager.searchParams.set(key, value);
        preview.searchParams.set(key, value);
      }
    }
    for (const key of reservedParams) {
      manager.searchParams.delete(key);
      preview.searchParams.delete(key);
    }
    manager.searchParams.set('path', `/story/${entry.id}`);
    preview.searchParams.set('id', entry.id);
    preview.searchParams.set('viewMode', 'story');
    for (const [key, value] of Object.entries(queryParams)) {
      manager.searchParams.set(key, value);
      preview.searchParams.set(key, value);
    }
    return {
      id: entry.id,
      name: entry.title ? `${entry.title} / ${entry.name}` : entry.name,
      previewHref: preview.href,
      managerHref: manager.href,
    };
  });
}

/** Composition indexes are loaded by Storybook, including its auth/error handling. */
export function getComposedCatalogs(
  refs: Record<string, { title?: string; url?: string; internal_index?: unknown; indexError?: unknown; loginUrl?: string }>,
  locationHref = window.location.href,
) {
  return Object.entries(refs).map(([refId, ref]) => {
    let url: string | undefined;
    try {
      const parsed = new URL(ref.url ?? '', locationHref);
      if (ref.url && ['http:', 'https:'].includes(parsed.protocol)) url = parsed.href;
    } catch { /* Invalid ref URLs remain unavailable instead of breaking the panel. */ }
    const status = !url || ref.indexError || ref.loginUrl ? 'unavailable' : ref.internal_index ? 'ready' : 'loading';
    return { refId, title: ref.title ?? refId, url, status };
  });
}
