import { describe, expect, it } from 'vitest';
import { initialBridgeRun, reduceBridgeEvent } from './bridge-reducer';
import type { ScanEvent, RunningSession } from './scan';
const targets = ['one', 'two'].map((id) => ({
  id,
  name: id,
  previewHref: 'https://remote.test/iframe.html',
  managerHref: 'https://remote.test/',
}));
const session: RunningSession = {
  phase: 'running',
  targets,
  results: [],
  retrying: false,
  progress: { completed: 0, total: 2, active: 0 },
};
const start: ScanEvent = { type: 'started', session, pendingStoryIds: ['one', 'two'] };
const result = { storyId: 'one', status: 'complete' as const, warnings: [], findings: [] };
describe('bridge lifecycle reducer', () => {
  it('reconstructs snapshots from incremental events and retains partial results', () => {
    let state = reduceBridgeEvent(initialBridgeRun(), start);
    state = reduceBridgeEvent(state, { type: 'progress', progress: { completed: 0, total: 2, active: 0, current: 'one' } });
    state = reduceBridgeEvent(state, { type: 'result', result, progress: { completed: 1, total: 2, active: 0 } });
    state = reduceBridgeEvent(state, { type: 'finished', outcome: 'cancelled', unresolved: [{ storyId: 'two' }] });
    expect(state.session).toMatchObject({ phase: 'finished', outcome: 'cancelled', results: [result] });
  });
  it('rejects unknown, duplicate results and invalid progress', () => {
    const state = reduceBridgeEvent(initialBridgeRun(), start);
    for (const event of [
      { type: 'result', result: { ...result, storyId: 'unknown' }, progress: { completed: 1, total: 2, active: 0 } },
      { type: 'progress', progress: { completed: 1, total: 2, active: 0 } },
      { type: 'progress', progress: { completed: 0, total: 3, active: 0 } },
      { type: 'finished', outcome: 'complete', unresolved: [{ storyId: 'one' }, { storyId: 'two' }] },
      start,
    ] as ScanEvent[])
      expect(() => reduceBridgeEvent(state, event)).toThrow(/Invalid remote/);
    const observed = reduceBridgeEvent(state, { type: 'result', result, progress: { completed: 1, total: 2, active: 0 } });
    expect(() =>
      reduceBridgeEvent(observed, { type: 'result', result, progress: { completed: 2, total: 2, active: 0 } }),
    ).toThrow();
  });
  it('validates start membership and permits discovery failure before start', () => {
    expect(() => reduceBridgeEvent(initialBridgeRun(), { ...start, pendingStoryIds: ['one', 'one'] })).toThrow();
    const failed = reduceBridgeEvent(initialBridgeRun(), {
      type: 'finished',
      outcome: 'error',
      error: 'index unavailable',
      unresolved: [],
    });
    expect(failed.session).toMatchObject({ phase: 'finished', outcome: 'error', targets: [] });
    expect(() => reduceBridgeEvent(failed, { type: 'progress', progress: { completed: 0, total: 0, active: 0 } })).toThrow();
  });
  it('keeps retained results during retry and replaces only pending stories', () => {
    const retry = { ...session, retrying: true, results: [result], progress: { completed: 0, total: 1, active: 0 } };
    let state = reduceBridgeEvent(initialBridgeRun(retry), {
      type: 'started',
      session: retry,
      pendingStoryIds: ['two'],
    });
    state = reduceBridgeEvent(state, {
      type: 'result',
      result: { ...result, storyId: 'two' },
      progress: { completed: 1, total: 1, active: 0 },
    });
    state = reduceBridgeEvent(state, { type: 'finished', outcome: 'complete', unresolved: [] });
    expect(state.session).toMatchObject({ results: [result, { ...result, storyId: 'two' }] });
  });
});

it('accepts reversed completion order and validates unresolved membership on cancellation', () => {
  let state = reduceBridgeEvent(initialBridgeRun(), start);
  state = reduceBridgeEvent(state, { type: 'result', result: { ...result, storyId: 'two' }, progress: { completed: 1, total: 2, active: 1 } });
  expect(() => reduceBridgeEvent(state, { type: 'finished', outcome: 'cancelled', unresolved: [{ storyId: 'two' }] })).toThrow();
  expect(reduceBridgeEvent(state, { type: 'finished', outcome: 'cancelled', unresolved: [{ storyId: 'one' }] }).session).toMatchObject({ results: [{ ...result, storyId: 'two' }] });
  state = reduceBridgeEvent(state, { type: 'result', result, progress: { completed: 2, total: 2, active: 0 } });
  expect(reduceBridgeEvent(state, { type: 'finished', outcome: 'complete', unresolved: [] }).session).toMatchObject({ results: [result, { ...result, storyId: 'two' }] });
});
