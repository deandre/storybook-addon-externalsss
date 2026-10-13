import React, { useEffect, useRef } from 'react';
import { useStorybookState, type API } from 'storybook/manager-api';
import { useCatalogScan } from './use-catalog-scan';
import { BRIDGE_VERSION, bridgeMessage, isBridgeEnvelope, trustedOrigins } from './bridge-protocol';

export function RemoteBridge({ api, bridgeId }: { api: API; bridgeId: string }) {
  const scan = useCatalogScan(api);
  const { internal_index: index } = useStorybookState();
  const current = useRef({ scan, index });
  current.current = { scan, index };
  const requests = useRef(new Set<string>());
  const busy = useRef(false);
  const recipient = useRef<{ origin: string; requestId: string }>();
  useEffect(() => {
    let allowed: string[] = [];
    try { allowed = trustedOrigins(JSON.parse(document.getElementById('externalsss-trusted-origins')?.textContent ?? '[]')); }
    catch { /* Invalid or absent configuration denies remote access. */ }
    const receive = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent || !allowed.includes(event.origin)
        || !isBridgeEnvelope(event.data, bridgeId)) return;
      const { type, requestId } = event.data;
      const reply = (kind: string, payload = {}) => window.parent.postMessage(bridgeMessage(bridgeId, String(requestId), kind, payload), event.origin);
      if (event.data.version !== BRIDGE_VERSION) { reply('error', { error: 'Incompatible Externalsss bridge version.' }); return; }
      if (type === 'hello') {
        if (typeof api.getIndex === 'function' ? api.getIndex() : current.current.index) reply('ready');
        return;
      }
      if (!['start', 'retry', 'cancel'].includes(String(type)) || typeof requestId !== 'string' || !requestId) return;
      if (type === 'cancel') {
        if (recipient.current?.requestId === requestId && recipient.current.origin === event.origin) current.current.scan.cancel();
        return;
      }
      if (busy.current || requests.current.has(requestId)) return;
      requests.current.add(requestId);
      const previous = current.current.scan.session;
      if (type === 'retry') {
        const complete = new Set(previous.phase === 'finished' ? previous.results.filter((result) => result.status === 'complete').map((result) => result.storyId) : []);
        if (previous.phase !== 'finished' || previous.targets.every((target) => complete.has(target.id))) {
          reply('error', { error: 'No incomplete remote scan is available to retry. Start a new scan.' }); return;
        }
      }
      recipient.current = { origin: event.origin, requestId };
      busy.current = true;
      void (type === 'start' ? current.current.scan.run() : current.current.scan.retry());
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); current.current.scan.cancel(); };
  }, [api, bridgeId]);
  useEffect(() => {
    if (!recipient.current || scan.session.phase === 'idle') return;
    if (scan.session.phase === 'finished') busy.current = false;
    window.parent.postMessage(bridgeMessage(bridgeId, recipient.current.requestId, 'session', { session: scan.session }), recipient.current.origin);
  }, [bridgeId, scan.session]);
  return <span hidden data-externalsss-bridge={bridgeId} />;
}
