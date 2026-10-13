import React from 'react';
import * as manager from 'storybook/manager-api';
import type { ScanController } from './scan-controller';
import { useCatalogScan } from './use-catalog-scan';
import { canRetry } from './scan';

import { TEST_PROVIDER_ID, RESOURCE_STATUS_ID, connectTestProvider } from './test-provider-state';

export function registerTestProvider(api: manager.API, controller: ScanController, openResults: () => void) {
  if (
    (globalThis as { CONFIG_TYPE?: string }).CONFIG_TYPE !== 'DEVELOPMENT' ||
    !manager.types.experimental_TEST_PROVIDER ||
    typeof manager.experimental_getTestProviderStore !== 'function' ||
    typeof manager.experimental_getStatusStore !== 'function'
  )
    return;
  const provider = manager.experimental_getTestProviderStore(TEST_PROVIDER_ID);
  const statuses = manager.experimental_getStatusStore(RESOURCE_STATUS_ID);
  const connection = connectTestProvider(controller, provider, statuses);
  const stopSelect = statuses.onSelect(openResults);
  manager.addons.add(TEST_PROVIDER_ID, {
    type: manager.types.experimental_TEST_PROVIDER,
    clear: connection.clear,
    render: () => <ResourceTestProvider api={api} openResults={openResults} />,
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    connection.dispose();
    stopSelect();
  };
}

function ResourceTestProvider({ api, openResults }: { api: manager.API; openResults: () => void }) {
  const { session, run, retry, cancel } = useCatalogScan(api);
  const running = session.phase === 'running';
  const incomplete = canRetry(session);
  return (
    <section aria-label="Externalsss testing" style={{ padding: 12, display: 'grid', gap: 8 }}>
      <strong>Externalsss</strong>
      {session.phase === 'finished' && (
        <span role="status">
          {session.outcome === 'error'
            ? 'Scanner could not execute. View results for details.'
            : session.outcome === 'cancelled'
              ? 'Scan cancelled. Results are partial.'
              : 'Scan finished. View results for findings.'}
        </span>
      )}
      {running && (
        <span role="status">
          {session.progress.completed} of {session.progress.total} stories checked
        </span>
      )}
      <button
        type="button"
        disabled={running}
        onClick={() => {
          void run();
        }}
      >
        {session.phase === 'idle' ? 'Run scan' : 'Scan again'}
      </button>
      {running && (
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      )}
      {incomplete && (
        <button
          type="button"
          onClick={() => {
            void retry();
          }}
        >
          Retry incomplete
        </button>
      )}
      <button type="button" onClick={openResults}>
        View results
      </button>
    </section>
  );
}
