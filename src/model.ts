export type FindingLabel = 'failure' | 'external' | 'font-timing' | 'mocking';
export type StoryStatus = 'complete' | 'render-error' | 'timeout' | 'unsupported' | 'cancelled';

export interface ResourceObservation {
  url: string;
  initiatorType: string;
  startTime: number;
}

export interface ImageObservation {
  url: string;
  complete: boolean;
  naturalWidth: number;
}

export interface ElementErrorObservation {
  url: string;
  tag: string;
}

export interface FontObservation {
  family: string;
  style: string;
  weight: string;
  atRender: FontFaceLoadStatus | 'unavailable';
  after: FontFaceLoadStatus;
}

export interface Observation {
  resources: ResourceObservation[];
  images: ImageObservation[];
  elementErrors: ElementErrorObservation[];
  fonts: FontObservation[];
  warnings: string[];
}

export interface Finding {
  key: string;
  name: string;
  url?: string;
  labels: FindingLabel[];
  notes: string[];
}

export interface StoryResult {
  storyId: string;
  status: StoryStatus;
  findings: Finding[];
  warnings: string[];
  error?: string;
}

export function isInfrastructureUrl(url: URL, previewHref: string): boolean {
  const preview = new URL(previewHref);
  if (url.origin !== preview.origin) return false;
  const base = preview.pathname.slice(0, preview.pathname.lastIndexOf('/') + 1);
  if (url.pathname === `${base}index.json` || url.pathname === `${base}iframe.html`) return true;
  return ['sb-preview/', 'sb-manager/', '@vite/', 'node_modules/.vite/']
    .some((path) => url.pathname.startsWith(`${base}${path}`));
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return `${parsed.protocol}[local resource]`;
    return `${parsed.origin}${parsed.pathname}${parsed.search ? '?…' : ''}`;
  } catch {
    return url;
  }
}

export function classifyObservation(observation: Observation, previewHref: string): Finding[] {
  const previewOrigin = new URL(previewHref).origin;
  const findings = new Map<string, Finding>();
  const add = (key: string, name: string, url: string | undefined, label: FindingLabel, note: string) => {
    const finding = findings.get(key) ?? { key, name, url, labels: [], notes: [] };
    if (!finding.labels.includes(label)) finding.labels.push(label);
    if (!finding.notes.includes(note)) finding.notes.push(note);
    findings.set(key, finding);
  };
  const addUrl = (url: string, label: FindingLabel, note: string) => {
    if (!url) return;
    add(`url:${url}`, redactUrl(url), url, label, note);
  };
  const addExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== previewOrigin) {
        addUrl(url, 'external', 'This resource depends on another origin.');
      }
    } catch { /* Ignore URLs that cannot be compared to the preview origin. */ }
  };

  for (const resource of observation.resources) {
    let url: URL;
    try { url = new URL(resource.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || isInfrastructureUrl(url, previewHref)) continue;
    addExternalUrl(resource.url);
    if (resource.initiatorType === 'fetch' || resource.initiatorType === 'xmlhttprequest') {
      addUrl(resource.url, 'mocking', 'Review this request for deterministic test data. It may already be mocked.');
    }
  }

  for (const image of observation.images) {
    addExternalUrl(image.url);
    if (image.complete && image.naturalWidth === 0) addUrl(image.url, 'failure', 'The image completed without usable pixels.');
  }
  for (const element of observation.elementErrors) {
    addExternalUrl(element.url);
    addUrl(element.url, 'failure', `${element.tag.toLowerCase()} emitted a load error.`);
  }
  for (const font of observation.fonts) {
    const name = `${font.family} (${font.weight}, ${font.style})`;
    const key = `font:${name}`;
    if (font.after === 'error') add(key, name, undefined, 'failure', 'The font face failed to load.');
    if (font.atRender === 'loading') add(key, name, undefined, 'font-timing', 'The font was still loading when Storybook signaled render.');
    if ((font.atRender === 'unloaded' || font.atRender === 'unavailable') && font.after === 'loaded') {
      add(key, name, undefined, 'font-timing', 'The font became available after Storybook signaled render.');
    }
    if (font.after === 'loading') add(key, name, undefined, 'font-timing', 'The font was still loading when observation ended.');
  }

  return [...findings.values()].sort((a, b) => a.name.localeCompare(b.name));
}
