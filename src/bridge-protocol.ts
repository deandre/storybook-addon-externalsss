import type { ScanSession } from './use-catalog-scan';

export const BRIDGE_QUERY = 'externalsssBridge';
export const BRIDGE_NAMESPACE = 'storybook-addon-externalsss/bridge';
export const BRIDGE_VERSION = 1;
export const BRIDGE_PATH = '/externalsss/bridge';
export const PANEL_ID = 'storybook-addon-externalsss/panel';

export function trustedOrigins(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('trustedManagerOrigins must be an array of exact HTTP(S) origins.');
  return value.map((origin: unknown) => {
    if (typeof origin !== 'string' || origin.includes('*')) throw new Error('Invalid trusted manager origin.');
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`Expected an exact HTTP(S) origin: ${origin}`);
    }
    return origin;
  });
}

export function bridgeMessage(bridgeId: string, requestId: string, type: string, payload = {}) {
  return { namespace: BRIDGE_NAMESPACE, version: BRIDGE_VERSION, bridgeId, requestId, type, ...payload };
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isBridgeEnvelope(value: unknown, bridgeId: string): value is Record<string, unknown> {
  return record(value) && value.namespace === BRIDGE_NAMESPACE && value.bridgeId === bridgeId
    && typeof value.requestId === 'string' && typeof value.type === 'string';
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function sourceUrl(value: unknown, origin: string): boolean {
  try { return typeof value === 'string' && new URL(value).origin === origin && ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function isRemoteSession(value: unknown, origin: string): value is Exclude<ScanSession, { phase: 'idle' }> {
  if (!record(value) || !['running', 'finished'].includes(String(value.phase))
    || !Array.isArray(value.targets) || !Array.isArray(value.results)) return false;
  const ids = new Set<string>();
  for (const target of value.targets) {
    if (!record(target) || typeof target.id !== 'string' || typeof target.name !== 'string'
      || ids.has(target.id) || !sourceUrl(target.previewHref, origin) || !sourceUrl(target.managerHref, origin)) return false;
    ids.add(target.id);
  }
  const observed = new Set<string>();
  for (const result of value.results) {
    if (!record(result) || typeof result.storyId !== 'string' || !ids.has(result.storyId) || observed.has(result.storyId)
      || !['complete', 'render-error', 'timeout', 'unsupported', 'cancelled'].includes(String(result.status))
      || !strings(result.warnings) || (result.error !== undefined && typeof result.error !== 'string')
      || !Array.isArray(result.findings)) return false;
    observed.add(result.storyId);
    if (!result.findings.every((finding: unknown) => record(finding) && typeof finding.key === 'string'
      && typeof finding.name === 'string' && (finding.url === undefined || typeof finding.url === 'string')
      && strings(finding.notes) && strings(finding.labels)
      && finding.labels.every((label) => ['failure', 'external', 'font-timing', 'mocking'].includes(label)))) return false;
  }
  if (value.phase === 'finished') return ['complete', 'cancelled', 'error'].includes(String(value.outcome))
    && (value.error === undefined || typeof value.error === 'string');
  const progress = value.progress;
  return typeof value.retrying === 'boolean' && record(progress) && Number.isInteger(progress.completed)
    && Number.isInteger(progress.total) && Number(progress.completed) >= 0 && Number(progress.completed) <= Number(progress.total)
    && Number(progress.total) <= ids.size && (progress.current === undefined || typeof progress.current === 'string');
}
