import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteScanController } from './remote-scan-controller';
import { bridgeMessage } from './bridge-protocol';
import type { ScanEvent, RunningSession } from './scan';

const origin = 'https://remote.test';
const catalog = { refId: 'remote', title: 'Remote', url: `${origin}/catalog/` };
const target = {
  id: 'one',
  name: 'One',
  previewHref: `${origin}/catalog/iframe.html`,
  managerHref: `${origin}/catalog/`,
};
const running: RunningSession = {
  phase: 'running',
  targets: [target],
  results: [],
  retrying: false,
  progress: { completed: 0, total: 1, active: 0 },
};
let receive: (event: MessageEvent) => void;
let frame: {
  src: string;
  style: object;
  setAttribute: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  contentWindow: { postMessage: ReturnType<typeof vi.fn> };
};
let removeListener: ReturnType<typeof vi.fn>;
function bridgeId() {
  return new URL(frame.src).searchParams.get('externalsssBridge')!;
}
function deliver(data: unknown, source: unknown = frame.contentWindow, from = origin) {
  receive({ data, source, origin: from } as MessageEvent);
}
function connect() {
  const controller = createRemoteScanController(catalog);
  controller.run();
  deliver(bridgeMessage(bridgeId(), '', 'ready'));
  const message = frame.contentWindow.postMessage.mock.lastCall![0];
  return { controller, requestId: message.requestId as string };
}
function event(requestId: string, value: ScanEvent) {
  deliver(bridgeMessage(bridgeId(), requestId, 'event', { event: value }));
}
beforeEach(() => {
  vi.useFakeTimers();
  frame = { src: '', style: {}, setAttribute: vi.fn(), remove: vi.fn(), contentWindow: { postMessage: vi.fn() } };
  removeListener = vi.fn();
  vi.stubGlobal('window', {
    location: { href: 'https://host.test/' },
    addEventListener: vi.fn((_type, fn) => {
      receive = fn;
    }),
    removeEventListener: removeListener,
  });
  vi.stubGlobal('document', { createElement: () => frame, body: { appendChild: vi.fn() } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('remote transport lifecycle', () => {
  it('times out connection and releases every resource', () => {
    const controller = createRemoteScanController(catalog);
    controller.run();
    expect(controller.getConnectionPhase()).toBe('connecting');
    vi.advanceTimersByTime(30000);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'finished', outcome: 'error', restartRequired: true });
    expect(controller.getConnectionPhase()).toBe('closed');
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    controller.disconnect();
    controller.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('authenticates sender and origin, rejects v1, and ignores stale requests', () => {
    const controller = createRemoteScanController(catalog);
    controller.run();
    const ready = bridgeMessage(bridgeId(), '', 'ready');
    deliver(ready, {}, origin);
    deliver(ready, frame.contentWindow, 'https://other.test');
    expect(controller.getConnectionPhase()).toBe('connecting');
    deliver({ ...ready, requestId: 'stale', version: 1 });
    expect(controller.getConnectionPhase()).toBe('connecting');
    deliver({ ...ready, version: 1 });
    expect(controller.getSnapshot()).toMatchObject({ error: expect.stringContaining('Incompatible') });
  });
  it('retains partial results after inactivity', () => {
    const { controller, requestId } = connect();
    const targets = [target, { ...target, id: 'two' }];
    event(requestId, {
      type: 'started',
      session: { ...running, targets, progress: { completed: 0, total: 2, active: 0 } },
      pendingStoryIds: ['one', 'two'],
    });
    event(requestId, {
      type: 'result',
      result: { storyId: 'one', status: 'complete', warnings: [], findings: [] },
      progress: { completed: 1, total: 2, active: 0 },
    });
    vi.advanceTimersByTime(20000);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'finished',
      outcome: 'error',
      results: [{ storyId: 'one' }],
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('finishes, ignores late messages, and retries on the retained connection', () => {
    const { controller, requestId } = connect();
    event(requestId, { type: 'started', session: running, pendingStoryIds: ['one'] });
    event(requestId, {
      type: 'result',
      result: { storyId: 'one', status: 'timeout', warnings: [], findings: [] },
      progress: { completed: 1, total: 1, active: 0 },
    });
    event(requestId, { type: 'finished', outcome: 'complete', unresolved: [] });
    expect(controller.getConnectionPhase()).toBe('ready');
    deliver({ ...bridgeMessage(bridgeId(), requestId, 'error', { error: 'late' }), version: 1 });
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'complete' });
    controller.retry();
    const retry = frame.contentWindow.postMessage.mock.lastCall![0];
    expect(retry.type).toBe('retry');
    expect(retry.requestId).not.toBe(requestId);
    deliver(bridgeMessage(bridgeId(), requestId, 'error', { error: 'stale' }));
    expect(controller.getSnapshot().phase).toBe('running');
    controller.cancel();
    expect(frame.contentWindow.postMessage.mock.lastCall![0].type).toBe('cancel');
    controller.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects malformed events and out-of-order results', () => {
    const { controller, requestId } = connect();
    deliver({
      ...bridgeMessage(bridgeId(), requestId, 'ready'),
      type: 'event',
      event: { type: 'started', session: { ...running, phase: ['running'] } },
    });
    expect(controller.getSnapshot()).toMatchObject({
      outcome: 'error',
      error: expect.stringContaining('Invalid remote'),
    });
  });
  it('cancels during handshake and ignores late callbacks after disconnection', () => {
    const controller = createRemoteScanController(catalog);
    controller.run();
    controller.cancel();
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'cancelled' });
    const lateReady = bridgeMessage(bridgeId(), '', 'ready');
    controller.disconnect();
    deliver(lateReady);
    expect(controller.getSnapshot()).toEqual({ phase: 'idle' });
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    expect(frame.remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('supports effect cleanup and reattachment without disabling the controller', () => {
  const controller = createRemoteScanController(catalog);
  controller.disconnect();
  controller.run();
  expect(controller.getConnectionPhase()).toBe('connecting');
  controller.disconnect();
  expect(controller.getSnapshot()).toEqual({ phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
  controller.run();
  expect(controller.getConnectionPhase()).toBe('connecting');
  controller.disconnect();
});
