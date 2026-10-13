import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createRemoteScanController, type Catalog } from './remote-scan-controller';
export type { Catalog } from './remote-scan-controller';

export function useRemoteScan(catalog?: Catalog) {
  const controller = useMemo(() => createRemoteScanController(catalog), [catalog?.refId, catalog?.url]);
  useEffect(() => () => controller.disconnect(), [controller]);
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { session, run: controller.run, retry: controller.retry, cancel: controller.cancel };
}
