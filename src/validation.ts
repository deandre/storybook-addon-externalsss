import type {
  Finding,
  FontObservation,
  ImageObservation,
  Observation,
  ResourceObservation,
  StoryResult,
  StoryStatus,
} from './model';

import { STORY_STATUSES, FINDING_LABELS } from './model';
const FONT_STATUSES = ['unloaded', 'loading', 'loaded', 'error'] as const;

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function enumValue<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some((item) => item === value);
}
export function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
export function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}
export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function resource(value: unknown): value is ResourceObservation {
  return (
    record(value) && typeof value.url === 'string' && typeof value.initiatorType === 'string' && finite(value.startTime)
  );
}
function image(value: unknown): value is ImageObservation {
  return (
    record(value) && typeof value.url === 'string' && typeof value.complete === 'boolean' && finite(value.naturalWidth)
  );
}
function font(value: unknown): value is FontObservation {
  return (
    record(value) &&
    typeof value.family === 'string' &&
    typeof value.weight === 'string' &&
    typeof value.style === 'string' &&
    enumValue(value.atRender, [...FONT_STATUSES, 'unavailable']) &&
    enumValue(value.after, FONT_STATUSES)
  );
}
export function isObservation(value: unknown): value is Observation {
  if (!record(value)) return false;
  if (
    !Array.isArray(value.resources) ||
    !Array.isArray(value.images) ||
    !Array.isArray(value.elementErrors) ||
    !Array.isArray(value.fonts)
  )
    return false;
  return (
    value.resources.every(resource) &&
    value.images.every(image) &&
    value.fonts.every(font) &&
    value.elementErrors.every((item) => record(item) && typeof item.url === 'string' && typeof item.tag === 'string') &&
    strings(value.warnings)
  );
}
export function isFinding(value: unknown): value is Finding {
  return (
    record(value) &&
    typeof value.key === 'string' &&
    typeof value.name === 'string' &&
    optionalString(value.url) &&
    strings(value.notes) &&
    Array.isArray(value.labels) &&
    value.labels.every((label) => enumValue(label, FINDING_LABELS))
  );
}
export function isStoryResult(value: unknown): value is StoryResult {
  return (
    record(value) &&
    typeof value.storyId === 'string' &&
    enumValue<StoryStatus>(value.status, STORY_STATUSES) &&
    strings(value.warnings) &&
    optionalString(value.error) &&
    Array.isArray(value.findings) &&
    value.findings.every(isFinding)
  );
}
