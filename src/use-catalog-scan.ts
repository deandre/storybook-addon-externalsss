import { useSyncExternalStore } from 'react';
import { useStorybookState, type API } from 'storybook/manager-api';
import { createScanController, type ScanController } from './scan-controller';
import { configuredScanConcurrency } from './scan-options';
import { scanStory } from './scan-story';
import { getStoryTargets } from './storybook-compat';
export { createRunId, type ScanSession } from './scan';
export type { StoryTarget } from './storybook-compat';

const controllers = new WeakMap<API, { controller: ScanController; index?: ReturnType<API['getIndex']> }>();
export function getCatalogScanController(api: API) {
  let entry = controllers.get(api);
  if (!entry) {
    const controller = createScanController((runId) => getStoryTargets(api, runId, { index: controllers.get(api)?.index }), scanStory, { scanConcurrency: configuredScanConcurrency() });
    entry = { controller };
    controllers.set(api, entry);
  }
  return entry;
}
export function useCatalogScan(api: API) {
  const { internal_index: index } = useStorybookState();
  const entry = getCatalogScanController(api);
  entry.index = index;
  const session = useSyncExternalStore(entry.controller.subscribe, entry.controller.getSnapshot);
  return { ...entry.controller, session };
}
