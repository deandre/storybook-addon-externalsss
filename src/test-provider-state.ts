import type * as manager from 'storybook/manager-api';
import type { StoryResult } from './model';
import type { ScanController } from './scan-controller';

export const TEST_PROVIDER_ID = 'storybook-addon-externalsss/test-provider';
export const RESOURCE_STATUS_ID = 'storybook-addon-externalsss/resources';

export function resourceStatus(storyId: string, result?: StoryResult, pending = false) {
  const counts = { failure: 0, external: 0, 'font-timing': 0, mocking: 0 };
  for (const finding of result?.findings ?? []) for (const label of finding.labels) counts[label] += 1;
  const value = result?.status === 'cancelled' ? 'unknown'
    : result && (result.status === 'render-error' || counts.failure > 0) ? 'error'
    : result && (result.status !== 'complete' || result.findings.length > 0 || result.warnings.length > 0) ? 'warning'
    : result ? 'success' : pending ? 'pending' : 'unknown';
  const coverage = result?.status === 'complete' ? 'Complete observation' : result ? 'Incomplete observation' : pending ? 'Awaiting observation' : 'Not scanned';
  return {
    storyId, typeId: RESOURCE_STATUS_ID, value: `status-value:${value}` as const,
    title: value === 'success' ? 'No findings in scan window' : value === 'error' ? 'Resource scan error' : value === 'warning' ? 'Resource scan needs review' : 'Resource scan incomplete',
    description: `${coverage}. Load failures: ${counts.failure}; external dependencies: ${counts.external}; font timing: ${counts['font-timing']}; review for mocking: ${counts.mocking}.`,
  };
}

export function connectTestProvider(
  controller: ScanController,
  provider: ReturnType<typeof manager.experimental_getTestProviderStore>,
  statuses: ReturnType<typeof manager.experimental_getStatusStore>,
) {
  let previous = controller.getSnapshot();
  let indexedResults: StoryResult[] | undefined;
  let resultById = new Map<string, StoryResult>();
  let awaiting = new Set<string>();
  let providerState: ReturnType<typeof provider.getState> | undefined;
  const setProviderState = (next: ReturnType<typeof provider.getState>) => {
    if (next !== providerState) { provider.setState(next); providerState = next; }
  };
  const update = () => {
    const session = controller.getSnapshot();
    if (session.phase === 'idle') {
      statuses.unset();
      indexedResults = undefined;
      resultById.clear();
      awaiting.clear();
      setProviderState('test-provider-state:pending');
    } else {
      const starting = session.phase === 'running' && (previous.phase !== 'running' || previous.targets !== session.targets);
      const resultsChanged = indexedResults !== session.results;
      const previousResults = resultById;
      if (resultsChanged) {
        resultById = new Map(session.results.map((result) => [result.storyId, result]));
        indexedResults = session.results;
      }
      const changedStatuses: ReturnType<typeof resourceStatus>[] = [];
      if (starting) {
        if (!session.retrying && previous.phase !== 'running') statuses.unset();
        awaiting = new Set(session.targets.filter((target) => !session.retrying || resultById.get(target.id)?.status !== 'complete').map((target) => target.id));
        for (const storyId of awaiting) changedStatuses.push(resourceStatus(storyId, undefined, true));
      } else if (resultsChanged) {
        for (const result of session.results) {
          if (previousResults.get(result.storyId) === result) continue;
          awaiting.delete(result.storyId);
          changedStatuses.push(resourceStatus(result.storyId, result));
        }
      }
      if (session.phase === 'finished' && previous.phase !== 'finished') {
        for (const storyId of awaiting) changedStatuses.push(resourceStatus(storyId, resultById.get(storyId)));
        awaiting.clear();
      }
      if (changedStatuses.length > 0) statuses.set(changedStatuses);
      setProviderState(session.phase === 'running' ? 'test-provider-state:running'
        : session.outcome === 'error' ? 'test-provider-state:crashed'
          : session.outcome === 'cancelled' ? 'test-provider-state:pending' : 'test-provider-state:succeeded');
    }
    previous = session;
  };
  const clear = () => controller.clear();
  const unsubscribe = controller.subscribe(update);
  const stopRun = provider.onRunAll(() => { void controller.run(); });
  const stopClear = provider.onClearAll(clear);
  return { clear, dispose: () => { unsubscribe(); stopRun(); stopClear(); } };
}
