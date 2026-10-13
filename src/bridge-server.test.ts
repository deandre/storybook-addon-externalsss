import { describe, expect, it, vi } from 'vitest';
import { createBridgeServer } from './bridge-server';
import { createScanController } from './scan-controller';
import { bridgeMessage } from './bridge-protocol';
const target = {
  id: 'one',
  name: 'One',
  previewHref: 'https://remote.test/iframe.html',
  managerHref: 'https://remote.test/',
};
const result = { storyId: 'one', status: 'complete' as const, warnings: [], findings: [] };
function setup() {
  let receive!: (event: MessageEvent) => void;
  const parent = { postMessage: vi.fn() };
  const host = {
    addEventListener: vi.fn((_type, fn) => {
      receive = fn;
    }),
    removeEventListener: vi.fn(),
  };
  const observe = vi.fn().mockResolvedValue(result);
  const controller = createScanController(() => [target], observe);
  const server = createBridgeServer({
    bridgeId: 'bridge',
    controller,
    allowedOrigins: ['https://host.test'],
    parent: parent as unknown as Window,
    host: host as unknown as Window,
    hasIndex: () => true,
  });
  const send = (
    type: 'hello' | 'start' | 'retry' | 'cancel',
    requestId = 'request',
    source: unknown = parent,
    origin = 'https://host.test',
    version = 3,
  ) => receive({ data: { ...bridgeMessage('bridge', requestId, type), version }, source, origin } as MessageEvent);
  return { send, server, controller, observe, parent, host };
}
describe('remote bridge command server', () => {
  it.each([1, 2])('denies wrong senders/origins and explicitly rejects protocol v%i', (version) => {
    const s = setup();
    s.send('start', 'request', {});
    s.send('hello', '', s.parent, 'https://other.test');
    expect(s.parent.postMessage).not.toHaveBeenCalled();
    expect(s.observe).not.toHaveBeenCalled();
    s.send('hello', '', s.parent, 'https://host.test', version);
    expect(s.parent.postMessage.mock.lastCall?.[0]).toMatchObject({
      version: 3,
      type: 'error',
      error: expect.stringContaining('Incompatible'),
    });
    s.send('hello', '');
    expect(s.parent.postMessage.mock.lastCall?.[0]).toMatchObject({ type: 'ready' });
    s.server.dispose();
  });
  it('relays delta events, prevents duplicate commands, and rejects unavailable retry', async () => {
    const s = setup();
    s.send('start');
    s.send('start');
    await vi.waitFor(() => expect(s.controller.getSnapshot().phase).toBe('finished'));
    expect(s.observe).toHaveBeenCalledOnce();
    const messages = s.parent.postMessage.mock.calls.map(([message]) => message);
    expect(messages.every((message) => message.type === 'event')).toBe(true);
    expect(messages.map((message) => message.event.type)).toEqual([
      'preparing',
      'started',
      'progress',
      'result',
      'finished',
    ]);
    expect(messages.find((message) => message.event.type === 'result').event).not.toHaveProperty('session');
    s.send('start');
    expect(s.observe).toHaveBeenCalledOnce();
    s.send('retry', 'retry');
    expect(s.parent.postMessage.mock.lastCall?.[0]).toMatchObject({
      type: 'error',
      error: expect.stringContaining('No incomplete'),
    });
    s.server.dispose();
    s.server.dispose();
    expect(s.host.removeEventListener).toHaveBeenCalledOnce();
  });
  it('cancels only the active recipient request and disposes subscriptions', async () => {
    const s = setup();
    s.observe.mockImplementationOnce(
      (_target, _run, signal: AbortSignal) =>
        new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ...result, status: 'cancelled' }))),
    );
    s.send('start');
    s.send('cancel', 'other');
    expect(s.controller.getSnapshot().phase).toBe('running');
    s.send('cancel');
    await vi.waitFor(() => expect(s.controller.getSnapshot().phase).toBe('finished'));
    expect(s.controller.getSnapshot()).toMatchObject({ outcome: 'cancelled' });
    s.server.dispose();
    s.parent.postMessage.mockClear();
    s.controller.clear();
    expect(s.parent.postMessage).not.toHaveBeenCalled();
  });
});
