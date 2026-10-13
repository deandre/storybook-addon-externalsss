import { RUN_QUERY_PARAM } from './protocol';
import { replaceStoryResult } from './report';
import {
  canRetry,
  createRunId,
  incompleteTargets,
  preparingSession,
  type ScanEvent,
  type ScanSession,
  type RunningSession,
} from './scan';
import type { StoryTarget } from './scan';
import type { StoryResult } from './model';

interface Execution {
  abort: AbortController;
  runId: string;
  session: RunningSession;
  pending: StoryTarget[];
  awaiting: Set<string>;
}

export function createScanController(
  getTargets: (runId: string) => StoryTarget[],
  observe: (target: StoryTarget, runId: string, signal: AbortSignal) => Promise<StoryResult>,
) {
  let session: ScanSession = { phase: 'idle' };
  let execution: Execution | undefined;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: ScanEvent) => void>();
  const publish = (next: ScanSession, event: ScanEvent) => {
    session = next;
    // Events drive adapters synchronously; React subscribers read the already updated snapshot.
    eventListeners.forEach((listener) => listener(event));
    listeners.forEach((listener) => listener());
  };
  const progress = (current: Execution, name?: string) => {
    current.session = {
      ...current.session,
      progress: {
        completed: current.pending.length - current.awaiting.size,
        total: current.pending.length,
        current: name,
      },
    };
    publish(current.session, { type: 'progress', progress: current.session.progress });
  };
  const recordResult = (current: Execution, result: StoryResult) => {
    current.awaiting.delete(result.storyId);
    current.session = {
      ...current.session,
      results: replaceStoryResult(current.session.results, result),
      progress: { completed: current.pending.length - current.awaiting.size, total: current.pending.length },
    };
    publish(current.session, { type: 'result', result, progress: current.session.progress });
  };
  const finish = (current: Execution, outcome: 'complete' | 'cancelled' | 'error', error?: string) => {
    if (execution !== current) return;
    const { targets, results } = current.session;
    const byId = new Map(results.map((result) => [result.storyId, result]));
    const unresolved = [...current.awaiting].map((storyId) => ({ storyId, result: byId.get(storyId) }));
    execution = undefined;
    publish({ phase: 'finished', outcome, targets, results, error }, { type: 'finished', outcome, error, unresolved });
  };
  const prepare = (current: Execution) => {
    if (!current.session.retrying) {
      publish(current.session, { type: 'preparing' });
      if (execution !== current) return;
      current.session = { ...current.session, targets: getTargets(current.runId) };
    }
    current.pending = current.session.retrying
      ? incompleteTargets(current.session.targets, current.session.results)
      : current.session.targets;
    current.awaiting = new Set(current.pending.map((target) => target.id));
    current.session = { ...current.session, progress: { completed: 0, total: current.pending.length } };
    publish(current.session, { type: 'started', session: current.session, pendingStoryIds: [...current.awaiting] });
  };
  const execute = async (current: Execution) => {
    for (const target of current.pending) {
      if (execution !== current || current.abort.signal.aborted) break;
      progress(current, target.name);
      if (execution !== current) return;
      const preview = new URL(target.previewHref);
      preview.searchParams.set(RUN_QUERY_PARAM, current.runId);
      const result = await observe({ ...target, previewHref: preview.href }, current.runId, current.abort.signal);
      if (execution !== current) return;
      recordResult(current, result);
      if (result.status === 'cancelled') break;
    }
    finish(current, current.abort.signal.aborted ? 'cancelled' : 'complete');
  };
  const run = async (retrying = false) => {
    if (execution || (retrying && !canRetry(session))) return;
    const initial =
      retrying && session.phase === 'finished'
        ? { ...preparingSession(), targets: session.targets, results: session.results, retrying: true }
        : preparingSession();
    const current: Execution = {
      abort: new AbortController(),
      runId: createRunId(),
      session: initial,
      pending: [],
      awaiting: new Set(),
    };
    execution = current;
    try {
      prepare(current);
      if (execution === current) await execute(current);
    } catch (error) {
      finish(current, 'error', error instanceof Error ? error.message : 'The scan stopped unexpectedly.');
    }
  };
  return {
    getSnapshot: () => session,
    getPendingStoryIds: () => [...(execution?.awaiting ?? [])],
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onEvent: (listener: (event: ScanEvent) => void) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    run: () => run(),
    retry: () => run(true),
    cancel: () => execution?.abort.abort(),
    clear: () => {
      const previous = execution;
      execution = undefined;
      previous?.abort.abort();
      publish({ phase: 'idle' }, { type: 'cleared' });
    },
  };
}
export type ScanController = ReturnType<typeof createScanController>;
