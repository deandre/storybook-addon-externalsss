import type { StoryResult } from './model';

export type ScanState = 'complete' | 'cancelled' | 'error';
export interface StoryTarget {
  id: string;
  name: string;
  previewHref: string;
  managerHref: string;
}

export interface ScanProgress {
  completed: number;
  total: number;
  current?: string;
}
export type ScanSession =
  | { phase: 'idle' }
  | { phase: 'running'; targets: StoryTarget[]; results: StoryResult[]; retrying: boolean; progress: ScanProgress }
  | {
      phase: 'finished';
      outcome: ScanState;
      targets: StoryTarget[];
      results: StoryResult[];
      error?: string;
      restartRequired?: boolean;
    };
export type RunningSession = Extract<ScanSession, { phase: 'running' }>;
export interface UnresolvedStory {
  storyId: string;
  result?: StoryResult;
}
export type ScanEvent =
  | { type: 'preparing' }
  | { type: 'started'; session: RunningSession; pendingStoryIds: string[] }
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'result'; result: StoryResult; progress: ScanProgress }
  | { type: 'finished'; outcome: ScanState; error?: string; unresolved: UnresolvedStory[] }
  | { type: 'cleared' };

export function createRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function incompleteTargets(targets: StoryTarget[], results: StoryResult[]): StoryTarget[] {
  const byId = new Map(results.map((result) => [result.storyId, result]));
  return targets.filter((target) => byId.get(target.id)?.status !== 'complete');
}

export function canRetry(session: ScanSession): boolean {
  return (
    session.phase === 'finished' &&
    !session.restartRequired &&
    incompleteTargets(session.targets, session.results).length > 0
  );
}

export function preparingSession(): RunningSession {
  return { phase: 'running', targets: [], results: [], retrying: false, progress: { completed: 0, total: 0 } };
}
