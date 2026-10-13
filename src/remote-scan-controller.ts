import { canRetry, createRunId, incompleteTargets, preparingSession, type ScanSession } from './scan';
import {
  BRIDGE_QUERY,
  BRIDGE_PATH,
  BRIDGE_VERSION,
  PANEL_ID,
  bridgeMessage,
  isBridgeEnvelope,
  isScanEvent,
  record,
} from './bridge-protocol';
import { initialBridgeRun, reduceBridgeEvent, type BridgeRun } from './bridge-reducer';

export interface Catalog {
  refId: string;
  title: string;
  url: string;
}
interface Connection {
  phase: 'connecting' | 'ready' | 'running';
  frame: HTMLIFrameElement;
  bridgeId: string;
  requestId: string;
  origin: string;
  run: BridgeRun;
  timer?: ReturnType<typeof setTimeout>;
  hello?: ReturnType<typeof setInterval>;
}
const INACTIVITY_ERROR = 'The remote Storybook stopped responding.';

function managerUrl(catalog: Catalog, bridgeId: string): URL {
  const url = new URL(catalog.url, window.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A composed catalog must use HTTP(S).');
  if (!url.pathname.endsWith('.html')) url.pathname = url.pathname.replace(/\/?$/, '/');
  for (const key of ['path', 'id', 'viewMode', 'refId', 'args', 'globals', 'addonPanel', BRIDGE_QUERY])
    url.searchParams.delete(key);
  url.hash = '';
  url.searchParams.set('path', BRIDGE_PATH);
  url.searchParams.set(BRIDGE_QUERY, bridgeId);
  url.searchParams.set('addonPanel', PANEL_ID);
  return url;
}
function bridgeFrame(catalog: Catalog) {
  const frame = document.createElement('iframe');
  frame.title = `Externalsss remote scan of ${catalog.title}`;
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  Object.assign(frame.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '1280px',
    height: '800px',
    opacity: '0',
    border: '0',
    pointerEvents: 'none',
  });
  return frame;
}
export function createRemoteScanController(catalog?: Catalog) {
  let session: ScanSession = { phase: 'idle' };
  let connection: Connection | undefined;
  const listeners = new Set<() => void>();
  const update = (next: ScanSession) => {
    session = next;
    listeners.forEach((listener) => listener());
  };
  const close = () => {
    if (!connection) return;
    clearTimeout(connection.timer);
    clearInterval(connection.hello);
    window.removeEventListener('message', receive);
    connection.frame.remove();
    connection = undefined;
  };
  const fail = (error: string) => {
    close();
    const previous = session.phase === 'idle' ? preparingSession() : session;
    update({
      phase: 'finished',
      outcome: 'error',
      targets: previous.targets,
      results: previous.results,
      error: `${error} Start a new scan to reconnect.`,
      restartRequired: true,
    });
  };
  const arm = (client: Connection, milliseconds: number, error: string) => {
    clearTimeout(client.timer);
    client.timer = setTimeout(() => {
      if (connection === client) fail(error);
    }, milliseconds);
  };
  const send = (client: Connection, command: 'hello' | 'start' | 'retry' | 'cancel') => {
    client.frame.contentWindow?.postMessage(
      bridgeMessage(client.bridgeId, command === 'hello' ? '' : client.requestId, command),
      client.origin,
    );
  };
  const startRequest = (client: Connection, command: 'start' | 'retry') => {
    client.requestId = createRunId();
    client.phase = 'running';
    client.run = initialBridgeRun(session);
    send(client, command);
    arm(client, 20000, INACTIVITY_ERROR);
  };
  const acceptEvent = (client: Connection, value: unknown) => {
    if (!isScanEvent(value, client.origin)) {
      fail('Invalid remote scan result received.');
      return;
    }
    try {
      client.run = reduceBridgeEvent(client.run, value);
    } catch {
      fail('Invalid remote scan result received.');
      return;
    }
    update(client.run.session);
    if (client.run.stage === 'finished') {
      client.phase = 'ready';
      clearTimeout(client.timer);
    } else arm(client, 20000, INACTIVITY_ERROR);
  };
  function receive(event: MessageEvent) {
    const client = connection;
    if (!client || event.source !== client.frame.contentWindow || event.origin !== client.origin) return;
    if (!isBridgeEnvelope(event.data, client.bridgeId) || client.phase === 'ready') return;
    const expectedId = client.phase === 'connecting' ? '' : client.requestId;
    if (event.data.requestId !== expectedId) return;
    if (event.data.version !== BRIDGE_VERSION) {
      fail('Incompatible Externalsss bridge version.');
      return;
    }
    handleMessage(client, event.data);
  }
  function handleMessage(client: Connection, message: unknown) {
    if (!record(message)) return;
    if (message.type === 'error') {
      fail(typeof message.error === 'string' ? message.error : 'Invalid remote scan result received.');
      return;
    }
    if (client.phase === 'connecting') {
      if (message.type !== 'ready') return;
      clearInterval(client.hello);
      startRequest(client, 'start');
      return;
    }
    if (message.type === 'event') acceptEvent(client, message.event);
    else fail('Invalid remote scan result received.');
  }
  const run = () => {
    if (!catalog || session.phase === 'running') return;
    close();
    update(preparingSession());
    try {
      const bridgeId = createRunId();
      const url = managerUrl(catalog, bridgeId);
      const frame = bridgeFrame(catalog);
      const client: Connection = {
        phase: 'connecting',
        frame,
        bridgeId,
        requestId: '',
        origin: url.origin,
        run: initialBridgeRun(),
      };
      connection = client;
      window.addEventListener('message', receive);
      client.hello = setInterval(() => send(client, 'hello'), 500);
      arm(
        client,
        30000,
        'Could not connect. Check that the remote Storybook installs Externalsss, trusts this manager origin, and permits embedding.',
      );
      frame.src = url.href;
      document.body.appendChild(frame);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Could not connect to the remote catalog.');
    }
  };
  const retry = () => {
    if (connection?.phase !== 'ready' || !canRetry(session) || session.phase !== 'finished') return;
    update({
      phase: 'running',
      targets: session.targets,
      results: session.results,
      retrying: true,
      progress: { completed: 0, total: incompleteTargets(session.targets, session.results).length, active: 0 },
    });
    startRequest(connection, 'retry');
  };
  const cancel = () => {
    const client = connection;
    if (!client) return;
    if (client.phase === 'running') send(client, 'cancel');
    if (client.phase === 'connecting') {
      close();
      update({ phase: 'finished', outcome: 'cancelled', targets: [], results: [] });
    }
  };
  return {
    getSnapshot: () => session,
    getConnectionPhase: () => connection?.phase ?? 'closed',
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run,
    retry,
    cancel,
    disconnect: () => {
      close();
      update({ phase: 'idle' });
    },
  };
}
