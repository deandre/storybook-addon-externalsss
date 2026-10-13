import { useEffect, useRef, useState } from 'react';
import { createRunId, type ScanSession } from './use-catalog-scan';
import { BRIDGE_QUERY, BRIDGE_PATH, BRIDGE_VERSION, PANEL_ID, bridgeMessage, isBridgeEnvelope, isRemoteSession } from './bridge-protocol';

export interface Catalog {
  refId: string;
  title: string;
  url: string;
}

interface Connection {
  frame: HTMLIFrameElement;
  bridgeId: string;
  requestId: string;
  origin: string;
  ready: boolean;
  running: boolean;
  timer?: ReturnType<typeof setTimeout>;
  hello?: ReturnType<typeof setInterval>;
  receive: (event: MessageEvent) => void;
}

export function useRemoteScan(catalog?: Catalog) {
  const [session, setSession] = useState<ScanSession>({ phase: 'idle' });
  const latest = useRef(session);
  latest.current = session;
  const connection = useRef<Connection>();
  const update = (next: ScanSession) => { latest.current = next; setSession(next); };
  const close = () => {
    const client = connection.current;
    if (!client) return;
    clearTimeout(client.timer);
    clearInterval(client.hello);
    window.removeEventListener('message', client.receive);
    client.frame.remove();
    connection.current = undefined;
  };
  useEffect(() => { close(); update({ phase: 'idle' }); return close; }, [catalog?.refId, catalog?.url]);
  const fail = (error: string) => {
    close();
    const previous = latest.current;
    update({ phase: 'finished', outcome: 'error', targets: previous.phase === 'idle' ? [] : previous.targets,
      results: previous.phase === 'idle' ? [] : previous.results, error: `${error} Start a new scan to reconnect.`, restartRequired: true });
  };
  const arm = (client: Connection, milliseconds: number, error: string) => {
    clearTimeout(client.timer);
    client.timer = setTimeout(() => fail(error), milliseconds);
  };
  const begin = (retrying: boolean) => {
    if (!catalog || latest.current.phase === 'running') return;
    if (retrying) {
      const client = connection.current;
      if (!client?.ready || latest.current.phase !== 'finished') return;
      client.requestId = createRunId();
      client.running = true;
      update({ phase: 'running', targets: latest.current.targets, results: latest.current.results, retrying: true,
        progress: { completed: 0, total: latest.current.targets.filter((target) => latest.current.phase !== 'idle'
          && latest.current.results.find((result) => result.storyId === target.id)?.status !== 'complete').length } });
      client.frame.contentWindow?.postMessage(bridgeMessage(client.bridgeId, client.requestId, 'retry'), client.origin);
      arm(client, 20000, 'The remote Storybook stopped responding.');
      return;
    }
    close();
    update({ phase: 'running', targets: [], results: [], retrying: false, progress: { completed: 0, total: 0 } });
    try {
      const url = new URL(catalog.url, window.location.href);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('A composed catalog must use HTTP(S).');
      if (!url.pathname.endsWith('.html')) url.pathname = url.pathname.replace(/\/?$/, '/');
      for (const key of ['path', 'id', 'viewMode', 'refId', 'args', 'globals', 'addonPanel', BRIDGE_QUERY]) url.searchParams.delete(key);
      url.hash = '';
      const bridgeId = createRunId();
      url.searchParams.set('path', BRIDGE_PATH);
      url.searchParams.set(BRIDGE_QUERY, bridgeId);
      url.searchParams.set('addonPanel', PANEL_ID);
      const frame = document.createElement('iframe');
      frame.title = `Externalsss remote scan of ${catalog.title}`;
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      Object.assign(frame.style, { position: 'fixed', left: '0', top: '0', width: '1280px', height: '800px', opacity: '0', border: '0', pointerEvents: 'none' });
      const client: Connection = { frame, bridgeId, requestId: createRunId(), origin: url.origin, ready: false, running: true,
        receive: (event) => {
          if (connection.current !== client || event.source !== frame.contentWindow || event.origin !== client.origin
            || !isBridgeEnvelope(event.data, bridgeId)) return;
          const message = event.data;
          if (client.ready && !client.running) return;
          if (message.requestId !== (client.ready ? client.requestId : '')) return;
          if (message.version !== BRIDGE_VERSION) { fail('Incompatible Externalsss bridge version.'); return; }
          if (message.type === 'ready' && !client.ready && message.requestId === '') {
            client.ready = true;
            clearInterval(client.hello);
            frame.contentWindow?.postMessage(bridgeMessage(bridgeId, client.requestId, 'start'), client.origin);
            arm(client, 20000, 'The remote Storybook stopped responding.');
          } else if (message.type === 'error' && (message.requestId === client.requestId || !client.ready && message.requestId === '')) {
            fail(typeof message.error === 'string' ? message.error : 'The remote scan failed.');
          } else if (client.ready && client.running && message.type === 'session' && message.requestId === client.requestId) {
            if (!isRemoteSession(message.session, client.origin)) { fail('Invalid remote scan result received.'); return; }
            update(message.session);
            if (message.session.phase === 'finished') { client.running = false; clearTimeout(client.timer); }
            else arm(client, 20000, 'The remote Storybook stopped responding.');
          }
        } };
      connection.current = client;
      window.addEventListener('message', client.receive);
      client.hello = setInterval(() => frame.contentWindow?.postMessage(bridgeMessage(bridgeId, '', 'hello'), client.origin), 500);
      arm(client, 30000, 'Could not connect. Check that the remote Storybook installs Externalsss, trusts this manager origin, and permits embedding.');
      frame.src = url.href;
      document.body.appendChild(frame);
    } catch (error) { fail(error instanceof Error ? error.message : 'Could not connect to the remote catalog.'); }
  };
  const cancel = () => {
    const client = connection.current;
    if (!client) return;
    if (client.ready) client.frame.contentWindow?.postMessage(bridgeMessage(client.bridgeId, client.requestId, 'cancel'), client.origin);
    else { close(); update({ phase: 'finished', outcome: 'cancelled', targets: [], results: [] }); }
  };
  return { session, run: () => begin(false), retry: () => begin(true), cancel };
}
