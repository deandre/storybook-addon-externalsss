import { RUN_QUERY_PARAM } from './protocol';
import { orderedStoryResults } from './report';
import { scanConcurrency, type ScanConcurrency } from './scan-options';
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
  active: Map<string, string>;
  concurrency: ScanConcurrency;
}

export function createScanController(
  getTargets: (runId: string) => StoryTarget[],
  observe: (target: StoryTarget, runId: string, signal: AbortSignal) => Promise<StoryResult>,
  options: { scanConcurrency?: ScanConcurrency } = {},
) {
  const concurrency = scanConcurrency(options.scanConcurrency);
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
  const runProgress = (current: Execution) => ({
    completed: current.pending.length - current.awaiting.size,
    total: current.pending.length,
    active: current.active.size,
    current: current.active.size === 1 ? current.active.values().next().value : undefined,
  });
  const progress = (current: Execution) => {
    current.session = { ...current.session, progress: runProgress(current) };
    publish(current.session, { type: 'progress', progress: current.session.progress });
  };
  const recordResult = (current: Execution, result: StoryResult) => {
    current.awaiting.delete(result.storyId);
    current.session = {
      ...current.session,
      results: orderedStoryResults(current.session.targets, current.session.results, result),
      progress: runProgress(current),
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
    current.session = { ...current.session, progress: { completed: 0, total: current.pending.length, active: 0 } };
    publish(current.session, { type: 'started', session: current.session, pendingStoryIds: [...current.awaiting] });
  };
  const observeTarget = async (current: Execution, target: StoryTarget) => {
    current.active.set(target.id, target.name);
    try {
      progress(current);
      if (execution !== current || current.abort.signal.aborted) return;
      const preview = new URL(target.previewHref);
      preview.searchParams.set(RUN_QUERY_PARAM, current.runId);
      const result = await observe({ ...target, previewHref: preview.href }, current.runId, current.abort.signal);
      current.active.delete(target.id);
      if (execution !== current) return;
      if (result.storyId !== target.id) throw new Error('Unexpected story scan result.');
      recordResult(current, result);
      if (result.status === 'cancelled') current.abort.abort();
    } finally {
      current.active.delete(target.id);
    }
  };
  const execute = async (current: Execution) => {
    let next = 0;
    let failure: string | undefined;
    const worker = async () => {
      while (execution === current && !current.abort.signal.aborted && next < current.pending.length) {
        const target = current.pending[next++]!;
        try {
          await observeTarget(current, target);
        } catch (error) {
          failure ??= error instanceof Error ? error.message : 'The scan stopped unexpectedly.';
          current.abort.abort();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(current.concurrency, current.pending.length) }, worker));
    if (failure !== undefined) finish(current, 'error', failure);
    else finish(current, current.abort.signal.aborted ? 'cancelled' : 'complete');
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
      active: new Map(),
      concurrency,
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
