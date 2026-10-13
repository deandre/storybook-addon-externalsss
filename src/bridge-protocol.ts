import type { ScanEvent, ScanProgress, RunningSession, UnresolvedStory } from './scan';
import type { StoryTarget } from './scan';
import type { StoryResult } from './model';
import { record, strings, enumValue, optionalString, finite, isStoryResult } from './validation';
export { record } from './validation';

export const BRIDGE_QUERY = 'externalsssBridge';
export const BRIDGE_NAMESPACE = 'storybook-addon-externalsss/bridge';
export const BRIDGE_VERSION = 2;
export const BRIDGE_PATH = '/externalsss/bridge';
export const PANEL_ID = 'storybook-addon-externalsss/panel';
export type BridgeCommand = 'hello' | 'start' | 'retry' | 'cancel';
export interface BridgeEnvelope {
  namespace: typeof BRIDGE_NAMESPACE;
  version: number;
  bridgeId: string;
  requestId: string;
  type: string;
}
export type BridgeMessage = BridgeEnvelope &
  ({ type: BridgeCommand | 'ready' } | { type: 'error'; error: string } | { type: 'event'; event: ScanEvent });

export function trustedOrigins(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('trustedManagerOrigins must be an array of exact HTTP(S) origins.');
  return value.map((origin: unknown) => {
    if (typeof origin !== 'string' || origin.includes('*')) throw new Error('Invalid trusted manager origin.');
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error(`Expected an exact HTTP(S) origin: ${origin}`);
    return origin;
  });
}
export function bridgeMessage(bridgeId: string, requestId: string, type: BridgeCommand | 'ready'): BridgeMessage;
export function bridgeMessage(
  bridgeId: string,
  requestId: string,
  type: 'error',
  payload: { error: string },
): BridgeMessage;
export function bridgeMessage(
  bridgeId: string,
  requestId: string,
  type: 'event',
  payload: { event: ScanEvent },
): BridgeMessage;
export function bridgeMessage(bridgeId: string, requestId: string, type: string, payload = {}) {
  return { namespace: BRIDGE_NAMESPACE, version: BRIDGE_VERSION, bridgeId, requestId, type, ...payload };
}
export function isBridgeEnvelope(value: unknown, bridgeId: string): value is BridgeEnvelope {
  return (
    record(value) &&
    value.namespace === BRIDGE_NAMESPACE &&
    value.bridgeId === bridgeId &&
    typeof value.version === 'number' &&
    typeof value.requestId === 'string' &&
    typeof value.type === 'string'
  );
}
export function isBridgeCommand(value: BridgeEnvelope): value is BridgeEnvelope & { type: BridgeCommand } {
  return (
    enumValue(value.type, ['hello', 'start', 'retry', 'cancel']) &&
    (value.type === 'hello' || value.requestId.length > 0)
  );
}
function sourceUrl(value: unknown, origin: string): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}
function isTarget(value: unknown, origin: string): value is StoryTarget {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    sourceUrl(value.previewHref, origin) &&
    sourceUrl(value.managerHref, origin)
  );
}
function targets(value: unknown, origin: string): value is StoryTarget[] {
  if (!Array.isArray(value) || !value.every((target) => isTarget(target, origin))) return false;
  return new Set(value.map((target) => target.id)).size === value.length;
}
function results(value: unknown, ids: Set<string>): value is StoryResult[] {
  if (!Array.isArray(value) || !value.every(isStoryResult)) return false;
  return (
    value.every((result) => ids.has(result.storyId)) &&
    new Set(value.map((result) => result.storyId)).size === value.length
  );
}
export function isProgress(value: unknown, totalLimit: number): value is ScanProgress {
  if (!record(value) || !finite(value.completed) || !finite(value.total)) return false;
  return (
    Number.isInteger(value.completed) &&
    Number.isInteger(value.total) &&
    value.completed >= 0 &&
    value.completed <= value.total &&
    value.total <= totalLimit &&
    optionalString(value.current)
  );
}
export function isRemoteRunningSession(value: unknown, origin: string): value is RunningSession {
  if (!record(value) || value.phase !== 'running' || !targets(value.targets, origin)) return false;
  if (!results(value.results, new Set(value.targets.map((target) => target.id)))) return false;
  return typeof value.retrying === 'boolean' && isProgress(value.progress, value.targets.length);
}
function unresolved(value: unknown): value is UnresolvedStory[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      record(item) &&
      typeof item.storyId === 'string' &&
      (item.result === undefined || (isStoryResult(item.result) && item.result.storyId === item.storyId)),
  );
}
export function isScanEvent(value: unknown, origin: string): value is ScanEvent {
  if (!record(value)) return false;
  switch (value.type) {
    case 'preparing':
    case 'cleared':
      return true;
    case 'started':
      return startedEvent(value, origin);
    case 'progress':
      return isProgress(value.progress, Number.MAX_SAFE_INTEGER);
    case 'result':
      return isStoryResult(value.result) && isProgress(value.progress, Number.MAX_SAFE_INTEGER);
    case 'finished':
      return finishedEvent(value);
    default:
      return false;
  }
}

function startedEvent(value: Record<string, unknown>, origin: string): boolean {
  return isRemoteRunningSession(value.session, origin) && strings(value.pendingStoryIds);
}
function finishedEvent(value: Record<string, unknown>): boolean {
  return (
    enumValue(value.outcome, ['complete', 'cancelled', 'error']) &&
    optionalString(value.error) &&
    unresolved(value.unresolved)
  );
}
