import { record, enumValue, optionalString, isObservation } from './validation';
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

export function isScanMessageCandidate(value: unknown, runId: string, storyId: string): boolean {
  return record(value) && value.namespace === MESSAGE_NAMESPACE && value.type === MESSAGE_TYPE
    && value.runId === runId && value.storyId === storyId;
}

export function isScanMessage(value: unknown): value is ScanMessage {
  if (!record(value) || value.namespace !== MESSAGE_NAMESPACE || value.version !== MESSAGE_VERSION || value.type !== MESSAGE_TYPE) return false;
  return typeof value.runId === 'string' && typeof value.storyId === 'string'
    && enumValue(value.status, ['complete', 'render-error', 'timeout', 'unsupported'])
    && optionalString(value.error) && isObservation(value.observation);
}
