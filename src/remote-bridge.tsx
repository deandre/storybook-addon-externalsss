import React, { useEffect } from 'react';
import { useStorybookState, type API } from 'storybook/manager-api';
import { getCatalogScanController } from './use-catalog-scan';
import { trustedOrigins } from './bridge-protocol';
import { createBridgeServer } from './bridge-server';

function configuredOrigins(): string[] {
  try {
    return trustedOrigins(JSON.parse(document.getElementById('externalsss-trusted-origins')?.textContent ?? '[]'));
  } catch {
    return [];
  }
}
export function RemoteBridge({ api, bridgeId }: { api: API; bridgeId: string }) {
  const { internal_index: index } = useStorybookState();
  const entry = getCatalogScanController(api);
  entry.index = index;
  useEffect(() => {
    const server = createBridgeServer({
      bridgeId,
      controller: entry.controller,
      allowedOrigins: configuredOrigins(),
      parent: window.parent,
      hasIndex: () => Boolean(typeof api.getIndex === 'function' ? api.getIndex() : entry.index),
    });
    return server.dispose;
  }, [api, bridgeId, entry]);
  return <span hidden data-externalsss-bridge={bridgeId} />;
}
