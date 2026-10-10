import type { Observation, StoryStatus } from './model';

export const MESSAGE_NAMESPACE = 'storybook-addon-externalsss';
export const MESSAGE_VERSION = 1;
export const MESSAGE_TYPE = 'result';
export const RUN_QUERY_PARAM = 'externalsssRun';
export const STORY_QUERY_PARAM = 'externalsssStory';

export interface ScanMessage {
  namespace: typeof MESSAGE_NAMESPACE;
  version: typeof MESSAGE_VERSION;
  type: typeof MESSAGE_TYPE;
  runId: string;
  storyId: string;
  status: Exclude<StoryStatus, 'cancelled'>;
  observation: Observation;
  error?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isScanMessageCandidate(value: unknown, runId: string, storyId: string): boolean {
  return record(value) && value.namespace === MESSAGE_NAMESPACE && value.type === MESSAGE_TYPE
    && value.runId === runId && value.storyId === storyId;
}

export function isScanMessage(value: unknown): value is ScanMessage {
  if (!record(value) || value.namespace !== MESSAGE_NAMESPACE || value.version !== MESSAGE_VERSION
    || value.type !== MESSAGE_TYPE || typeof value.runId !== 'string' || typeof value.storyId !== 'string'
    || !['complete', 'render-error', 'timeout', 'unsupported'].includes(String(value.status))
    || (value.error !== undefined && typeof value.error !== 'string')) return false;

  const observation = value.observation;
  if (!record(observation) || !Array.isArray(observation.resources) || !Array.isArray(observation.images)
    || !Array.isArray(observation.elementErrors) || !Array.isArray(observation.fonts)
    || !Array.isArray(observation.warnings) || !observation.warnings.every((item) => typeof item === 'string')) return false;

  return observation.resources.every((item) => record(item) && typeof item.url === 'string'
      && typeof item.initiatorType === 'string' && typeof item.startTime === 'number' && Number.isFinite(item.startTime))
    && observation.images.every((item) => record(item) && typeof item.url === 'string'
      && typeof item.complete === 'boolean' && typeof item.naturalWidth === 'number' && Number.isFinite(item.naturalWidth))
    && observation.elementErrors.every((item) => record(item) && typeof item.url === 'string' && typeof item.tag === 'string')
    && observation.fonts.every((item) => record(item) && typeof item.family === 'string'
      && typeof item.weight === 'string' && typeof item.style === 'string'
      && ['unloaded', 'loading', 'loaded', 'error', 'unavailable'].includes(String(item.atRender))
      && ['unloaded', 'loading', 'loaded', 'error'].includes(String(item.after)));
}
