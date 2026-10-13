import {
  BRIDGE_VERSION,
  bridgeMessage,
  isBridgeEnvelope,
  isBridgeCommand,
  type BridgeEnvelope,
  type BridgeCommand,
} from './bridge-protocol';
import { canRetry, type ScanEvent } from './scan';
import type { ScanController } from './scan-controller';

interface Recipient {
  origin: string;
  requestId: string;
}
export function createBridgeServer({
  bridgeId,
  controller,
  allowedOrigins,
  parent,
  hasIndex,
  host = window,
}: {
  bridgeId: string;
  controller: ScanController;
  allowedOrigins: string[];
  parent: Window;
  hasIndex: () => boolean;
  host?: Window;
}) {
  let recipient: Recipient | undefined;
  let disposed = false;
  const requests = new Set<string>();
  const error = (request: Recipient, message: string) =>
    parent.postMessage(bridgeMessage(bridgeId, request.requestId, 'error', { error: message }), request.origin);
  const relay = (event: ScanEvent) => {
    if (!recipient) return;
    parent.postMessage(bridgeMessage(bridgeId, recipient.requestId, 'event', { event }), recipient.origin);
    if (event.type === 'finished' || event.type === 'cleared') recipient = undefined;
  };
  const start = (message: BridgeEnvelope & { type: BridgeCommand }, request: Recipient) => {
    if (recipient || requests.has(request.requestId)) return;
    requests.add(request.requestId);
    if (message.type === 'retry' && !canRetry(controller.getSnapshot())) {
      error(request, 'No incomplete remote scan is available to retry. Start a new scan.');
      return;
    }
    if (controller.getSnapshot().phase === 'running') {
      error(request, 'A scan is already running.');
      return;
    }
    recipient = request;
    void (message.type === 'start' ? controller.run() : controller.retry());
  };
  const receive = (event: MessageEvent) => {
    if (parent === host || event.source !== parent || !allowedOrigins.includes(event.origin)) return;
    if (!isBridgeEnvelope(event.data, bridgeId)) return;
    const request = { origin: event.origin, requestId: event.data.requestId };
    if (event.data.version !== BRIDGE_VERSION) {
      error(request, 'Incompatible Externalsss bridge version.');
      return;
    }
    if (!isBridgeCommand(event.data)) return;
    handleCommand(event.data, request);
  };
  function handleCommand(message: BridgeEnvelope & { type: BridgeCommand }, request: Recipient) {
    if (message.type === 'hello') {
      if (hasIndex()) parent.postMessage(bridgeMessage(bridgeId, request.requestId, 'ready'), request.origin);
      return;
    }
    if (message.type === 'cancel') {
      if (recipient?.requestId === request.requestId && recipient.origin === request.origin) controller.cancel();
      return;
    }
    start(message, request);
  }
  const unsubscribe = controller.onEvent(relay);
  host.addEventListener('message', receive);
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      recipient = undefined;
      unsubscribe();
      host.removeEventListener('message', receive);
      controller.cancel();
    },
  };
}
