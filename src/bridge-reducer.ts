import type { ScanEvent, ScanProgress, ScanSession } from './scan';
import { incompleteTargets, preparingSession } from './scan';
import { orderedStoryResults } from './report';

export interface BridgeRun {
  stage: 'preparing' | 'running' | 'finished';
  session: ScanSession;
  pending: string[];
  received: Set<string>;
}
export function initialBridgeRun(session: ScanSession = preparingSession()): BridgeRun {
  return { stage: 'preparing', session, pending: [], received: new Set() };
}
function invalid(): never {
  throw new Error('Invalid remote scan result received.');
}
function started(state: BridgeRun, event: Extract<ScanEvent, { type: 'started' }>): BridgeRun {
  if (state.stage !== 'preparing') invalid();
  const { session, pendingStoryIds } = event;
  if (state.session.phase !== 'running' || session.retrying !== state.session.retrying) invalid();
  validatePending(session, pendingStoryIds);
  return { stage: 'running', session, pending: pendingStoryIds, received: new Set() };
}
function validatePending(session: Extract<ScanSession, { phase: 'running' }>, pendingStoryIds: string[]) {
  const expected = session.retrying ? incompleteTargets(session.targets, session.results) : session.targets;
  if (
    expected.length !== pendingStoryIds.length ||
    expected.some((target, index) => target.id !== pendingStoryIds[index])
  )
    invalid();
  if (session.progress.completed !== 0 || session.progress.total !== expected.length || session.progress.active !== 0) invalid();
  if (!session.retrying && session.results.length !== 0) invalid();
}
function checkProgress(state: BridgeRun, progress: ScanProgress, completed: number) {
  if (progress.total !== state.pending.length || progress.completed !== completed) invalid();
}
function result(state: BridgeRun, event: Extract<ScanEvent, { type: 'result' }>): BridgeRun {
  if (state.stage !== 'running' || state.session.phase !== 'running') invalid();
  if (!state.pending.includes(event.result.storyId) || state.received.has(event.result.storyId)) invalid();
  checkProgress(state, event.progress, state.session.progress.completed + 1);
  const session = {
    ...state.session,
    results: orderedStoryResults(state.session.targets, state.session.results, event.result),
    progress: event.progress,
  };
  return { ...state, session, received: new Set([...state.received, event.result.storyId]) };
}
function finished(state: BridgeRun, event: Extract<ScanEvent, { type: 'finished' }>): BridgeRun {
  if (state.stage === 'finished' || state.session.phase !== 'running') invalid();
  const expected = state.pending.filter((id) => !state.received.has(id));
  if (
    expected.length !== event.unresolved.length ||
    expected.some((id, index) => id !== event.unresolved[index]?.storyId)
  )
    invalid();
  if (event.outcome === 'complete' && expected.length > 0) invalid();
  const { targets, results } = state.session;
  return {
    ...state,
    stage: 'finished',
    session: { phase: 'finished', targets, results, outcome: event.outcome, error: event.error },
  };
}
export function reduceBridgeEvent(state: BridgeRun, event: ScanEvent): BridgeRun {
  switch (event.type) {
    case 'preparing':
      if (state.stage !== 'preparing') invalid();
      return initialBridgeRun();
    case 'started':
      return started(state, event);
    case 'result':
      return result(state, event);
    case 'finished':
      return finished(state, event);
    case 'progress': {
      if (state.stage !== 'running' || state.session.phase !== 'running') invalid();
      checkProgress(state, event.progress, state.session.progress.completed);
      return { ...state, session: { ...state.session, progress: event.progress } };
    }
    case 'cleared':
      return invalid();
  }
}
