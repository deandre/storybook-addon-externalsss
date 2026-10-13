import type { StoryTarget } from './scan';
import type { FindingLabel, StoryResult } from './model';
import type { summarizeScan, ScanState } from './report';
import { canRetry, type ScanSession, type RunningSession } from './scan';

export const palette = {
  failure: 'Load failure',
  external: 'External dependency',
  'font-timing': 'Font timing',
  mocking: 'Review for mocking',
} satisfies Record<FindingLabel, string>;
export type Filter = 'all' | FindingLabel | 'incomplete';
type Summary = ReturnType<typeof summarizeScan<StoryTarget>>;
export interface PanelData {
  summary: Summary;
  targetById: Map<string, StoryTarget>;
}
const emptyInputs: { targets: StoryTarget[]; results: StoryResult[]; includeUnvisited: boolean } = {
  targets: [],
  results: [],
  includeUnvisited: true,
};
export function panelInputs(session: ScanSession) {
  if (session.phase === 'idle') return emptyInputs;
  return {
    targets: session.targets,
    results: session.results,
    includeUnvisited: session.phase !== 'running' || session.retrying,
  };
}
interface Text {
  title: string;
  detail: string;
}
function runningStatus(session: RunningSession, remote: boolean): Text {
  const operation = session.retrying ? 'Retrying' : 'Scanning';
  return {
    title:
      session.progress.total === 0 && remote
        ? 'Connecting to catalog'
        : `${operation} ${Math.min(session.progress.completed + 1, session.progress.total)} of ${session.progress.total}`,
    detail: session.progress.current ?? '',
  };
}
function stoppedDetail(session: Extract<ScanSession, { phase: 'finished' }>) {
  if (session.restartRequired) return 'Results are partial. Start a new scan to reconnect.';
  return session.targets.length
    ? 'Results are partial. Retry incomplete stories or start a new scan.'
    : 'The scan could not start. Run it again to retry.';
}
function scanStatus(session: ScanSession, summary: Summary, remote: boolean): Text {
  if (session.phase === 'running') return runningStatus(session, remote);
  if (session.phase === 'idle')
    return { title: 'Ready to scan', detail: 'Check the selected catalog without changing the Canvas.' };
  if (session.outcome === 'cancelled')
    return {
      title: 'Scan cancelled',
      detail: `${summary.scannedStories} of ${session.targets.length} stories checked. Results are partial.`,
    };
  if (session.outcome === 'error') return { title: 'Scan stopped', detail: stoppedDetail(session) };
  const count = summary.incomplete.length;
  return {
    title: count ? 'Scan finished with gaps' : 'Scan complete',
    detail: `${summary.scannedStories} ${summary.scannedStories === 1 ? 'story' : 'stories'} checked${count ? ` · ${count} incomplete` : ''}.`,
  };
}
function emptyText(running: boolean, state: ScanState | 'idle', filter: Filter): Text {
  if (running) return { title: 'Scanning stories', detail: 'Findings appear here as stories finish.' };
  if (state === 'idle')
    return {
      title: 'Scan this catalog',
      detail: 'Check images, fonts, and requests across local stories. The visible Canvas stays in place.',
    };
  if (filter === 'incomplete')
    return { title: 'No incomplete stories', detail: 'Every story returned a complete observation.' };
  if (filter !== 'all')
    return {
      title: `No ${palette[filter].toLowerCase()} findings`,
      detail: 'Choose another filter to review the rest of the scan.',
    };
  if (state === 'complete')
    return {
      title: 'No findings in the observed scan window',
      detail: 'Run the scan again if the stories or their resources change.',
    };
  return { title: 'No findings recorded', detail: 'The scan stopped before it could finish. Run it again to retry.' };
}
function filteredGroups(groups: Summary['groups'], filter: Filter) {
  if (filter === 'all') return groups;
  if (filter === 'incomplete') return [];
  return groups.filter((group) => group.finding.labels.includes(filter));
}
function resultModel(summary: Summary, filter: Filter) {
  const unvisited = summary.incomplete.filter((item) => item.status === 'not-scanned');
  const observedIncomplete = summary.incomplete.filter((item) => item.status !== 'not-scanned');
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: summary.groups.length + observedIncomplete.length + (unvisited.length ? 1 : 0) },
    ...(Object.keys(palette) as FindingLabel[]).map((label) => ({
      id: label,
      label: palette[label],
      count: summary.labelCounts[label],
    })),
    { id: 'incomplete', label: 'Incomplete', count: summary.incomplete.length },
  ];
  const visibleGroups = filteredGroups(summary.groups, filter);
  const showIncomplete = filter === 'all' || filter === 'incomplete';
  return {
    filters,
    visibleGroups,
    showIncomplete,
    unvisited,
    observedIncomplete,
    hasVisibleResults: visibleGroups.length > 0 || (showIncomplete && summary.incomplete.length > 0),
  };
}
function actions(session: ScanSession, remoteReady: boolean) {
  const running = session.phase === 'running';
  return {
    runDisabled: running || !remoteReady,
    retryVisible: canRetry(session),
    cancelVisible: running,
    downloadVisible: session.phase === 'finished' && session.targets.length > 0,
  };
}
export function panelModel(
  session: ScanSession,
  filter: Filter,
  remote: boolean,
  remoteReady: boolean,
  data: PanelData,
) {
  const { targets, results } = panelInputs(session);
  const running = session.phase === 'running';
  const state = session.phase === 'finished' ? session.outcome : 'idle';
  const { summary, targetById } = data;
  return {
    targets,
    results,
    running,
    summary,
    actions: actions(session, remoteReady),
    targetById,
    ...resultModel(summary, filter),
    status: scanStatus(session, summary, remote),
    empty: emptyText(running, state, filter),
    runLabel: running ? 'Scanning…' : state === 'idle' ? 'Run scan' : 'Scan again',
    statusClass: statusClass(state, summary.incomplete.length, running),
    error: session.phase === 'finished' ? session.error : undefined,
    progress: session.phase === 'running' ? session.progress : undefined,
  };
}
function statusClass(state: ScanState | 'idle', incomplete: number, running: boolean) {
  if (state === 'error') return 'ext-status--error';
  return incomplete && !running ? 'ext-status--partial' : '';
}
export type PanelModel = ReturnType<typeof panelModel>;
