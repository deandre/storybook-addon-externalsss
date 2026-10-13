import React, { useEffect, useMemo, useState } from 'react';
import { addons, types, useAddonState, useStorybookState, type API } from 'storybook/manager-api';
import { AddonPanel } from 'storybook/internal/components';
import { useTheme, type StorybookTheme } from 'storybook/theming';
import { getCatalogScanController, useCatalogScan } from './use-catalog-scan';
import { useRemoteScan, type Catalog } from './use-remote-scan';
import { getComposedCatalogs } from './storybook-compat';
import { RemoteBridge } from './remote-bridge';
import { BRIDGE_QUERY, BRIDGE_PATH, PANEL_ID } from './bridge-protocol';
import { registerTestProvider } from './test-provider';
import { panelInputs, panelModel, type Filter } from './panel-model';
import { summarizeScan } from './report';
import { PanelView } from './panel-view';
import { downloadReport } from './download-report';

const ADDON_ID = 'storybook-addon-externalsss';
function ExternalsssPanel({ api, active }: { api: API; active: boolean }) {
  const theme = useTheme() as StorybookTheme;
  const { refs } = useStorybookState();
  const [refId, setRefId] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const catalogs = getComposedCatalogs(refs);
  const selected = catalogs.find((item) => item.refId === refId);
  const catalog: Catalog | undefined = selected?.url ? { refId, title: selected.title, url: selected.url } : undefined;
  const local = useCatalogScan(api);
  const remote = useRemoteScan(catalog);
  const scan = refId ? remote : local;
  const [request] = useAddonState<number>(`${ADDON_ID}/results-request`, 0);
  useEffect(() => {
    if (request) {
      setRefId('');
      setFilter('all');
    }
  }, [request]);
  const remoteReady = !refId || selected?.status === 'ready';
  const { targets, results, includeUnvisited } = panelInputs(scan.session);
  const summary = useMemo(
    () => summarizeScan(targets, results, includeUnvisited),
    [targets, results, includeUnvisited],
  );
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
  const model = useMemo(
    () => panelModel(scan.session, filter, Boolean(refId), remoteReady, { summary, targetById }),
    [scan.session, filter, refId, remoteReady, summary, targetById],
  );
  const chooseCatalog = (id: string) => {
    setRefId(id);
    setFilter('all');
  };
  const run = () => {
    setFilter('all');
    void scan.run();
  };
  const retry = () => {
    setFilter('all');
    void scan.retry();
  };
  if (!active) return null;
  return (
    <PanelView
      theme={theme}
      model={model}
      filter={filter}
      refId={refId}
      catalogs={catalogs}
      onCatalog={chooseCatalog}
      onFilter={setFilter}
      onRun={run}
      onRetry={retry}
      onCancel={scan.cancel}
      onDownload={() => downloadReport(scan.session, catalog)}
    />
  );
}

addons.register(ADDON_ID, (api) => {
  const bridgeId = new URLSearchParams(window.location.search).get(BRIDGE_QUERY);
  if (bridgeId) {
    addons.add(`${ADDON_ID}/bridge`, {
      type: types.experimental_PAGE,
      title: 'Externalsss',
      url: BRIDGE_PATH,
      render: () => <RemoteBridge api={api} bridgeId={bridgeId} />,
    });
    queueMicrotask(() => api.setSelectedPanel(PANEL_ID));
  }
  if (!bridgeId)
    registerTestProvider(api, getCatalogScanController(api).controller, () => {
      void api.setAddonState<number>(`${ADDON_ID}/results-request`, (previous = 0) => previous + 1);
      api.setSelectedPanel(PANEL_ID);
      api.togglePanel(true);
    });
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Externalsss',
    render: ({ active }) =>
      bridgeId ? null : (
        <AddonPanel active={Boolean(active)} hasScrollbar={false}>
          <ExternalsssPanel api={api} active={Boolean(active)} />
        </AddonPanel>
      ),
  });
});
