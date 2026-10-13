import type * as manager from 'storybook/manager-api';
import type { FindingLabel, StoryResult } from './model';
import type { ScanController } from './scan-controller';
import type { ScanEvent, ScanSession } from './scan';

export const TEST_PROVIDER_ID = 'storybook-addon-externalsss/test-provider';
export const RESOURCE_STATUS_ID = 'storybook-addon-externalsss/resources';
type StatusValue = 'unknown' | 'pending' | 'error' | 'warning' | 'success';
const titles: Record<StatusValue, string> = {
  success: 'No findings in scan window',
  error: 'Resource scan error',
  warning: 'Resource scan needs review',
  unknown: 'Resource scan incomplete',
  pending: 'Resource scan incomplete',
};
function countLabels(result?: StoryResult): Record<FindingLabel, number> {
  const counts = { failure: 0, external: 0, 'font-timing': 0, mocking: 0 };
  for (const finding of result?.findings ?? []) for (const label of finding.labels) counts[label] += 1;
  return counts;
}
function statusValue(result: StoryResult | undefined, failures: number, pending: boolean): StatusValue {
  if (!result) return pending ? 'pending' : 'unknown';
  if (result.status === 'cancelled') return 'unknown';
  if (result.status === 'render-error' || failures > 0) return 'error';
  if (result.status !== 'complete' || result.findings.length > 0 || result.warnings.length > 0) return 'warning';
  return 'success';
}
function coverage(result: StoryResult | undefined, pending: boolean) {
  if (!result) return pending ? 'Awaiting observation' : 'Not scanned';
  return result.status === 'complete' ? 'Complete observation' : 'Incomplete observation';
}
export function resourceStatus(storyId: string, result?: StoryResult, pending = false) {
  const counts = countLabels(result);
  const value = statusValue(result, counts.failure, pending);
  return {
    storyId,
    typeId: RESOURCE_STATUS_ID,
    value: `status-value:${value}` as const,
    title: titles[value],
    description: `${coverage(result, pending)}. Load failures: ${counts.failure}; external dependencies: ${counts.external}; font timing: ${counts['font-timing']}; review for mocking: ${counts.mocking}.`,
  };
}
function providerState(
  session: ScanSession,
): ReturnType<ReturnType<typeof manager.experimental_getTestProviderStore>['getState']> {
  if (session.phase === 'running') return 'test-provider-state:running';
  if (session.phase === 'idle') return 'test-provider-state:pending';
  const outcomes = {
    error: 'test-provider-state:crashed',
    cancelled: 'test-provider-state:pending',
    complete: 'test-provider-state:succeeded',
  } as const;
  return outcomes[session.outcome];
}
export function connectTestProvider(
  controller: ScanController,
  provider: ReturnType<typeof manager.experimental_getTestProviderStore>,
  statuses: ReturnType<typeof manager.experimental_getStatusStore>,
) {
  let lastState: ReturnType<typeof provider.getState> | undefined;
  const setState = () => {
    const next = providerState(controller.getSnapshot());
    if (next !== lastState) {
      provider.setState(next);
      lastState = next;
    }
  };
  const write = (values: ReturnType<typeof resourceStatus>[]) => {
    if (values.length) statuses.set(values);
  };
  const receive = (event: ScanEvent) => {
    switch (event.type) {
      case 'preparing':
      case 'cleared':
        statuses.unset();
        break;
      case 'started':
        write(event.pendingStoryIds.map((id) => resourceStatus(id, undefined, true)));
        break;
      case 'result':
        write([resourceStatus(event.result.storyId, event.result)]);
        break;
      case 'finished':
        write(event.unresolved.map(({ storyId, result }) => resourceStatus(storyId, result)));
        break;
      case 'progress':
        return;
    }
    setState();
  };
  const hydrate = () => {
    const session = controller.getSnapshot();
    if (session.phase === 'idle') return;
    const byId = new Map(session.results.map((result) => [result.storyId, result]));
    const pending = new Set(controller.getPendingStoryIds());
    write(
      session.targets.map((target) =>
        pending.has(target.id)
          ? resourceStatus(target.id, undefined, true)
          : resourceStatus(target.id, byId.get(target.id)),
      ),
    );
    setState();
  };
  hydrate();
  const clear = () => controller.clear();
  const unsubscribe = controller.onEvent(receive);
  const stopRun = provider.onRunAll(() => {
    void controller.run();
  });
  const stopClear = provider.onClearAll(clear);
  let disposed = false;
  return {
    clear,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      stopRun();
      stopClear();
    },
  };
}
