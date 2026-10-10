import { useMemo, useState } from 'react';
import { addons, types, type API } from 'storybook/manager-api';
import { AddonPanel } from 'storybook/internal/components';
import { useTheme, type StorybookTheme } from 'storybook/theming';
import type { FindingLabel, StoryResult } from './model';
import { panelStyles } from './panel-styles';
import { buildReport, summarizeScan } from './report';
import { useCatalogScan } from './use-catalog-scan';

const ADDON_ID = 'storybook-addon-externalsss';
const PANEL_ID = `${ADDON_ID}/panel`;

const palette = {
  failure: 'Load failure',
  external: 'External dependency',
  'font-timing': 'Font timing',
  mocking: 'Review for mocking',
} satisfies Record<FindingLabel, string>;

const advice: Record<FindingLabel, { text: string; url: string }> = {
  failure: { text: 'Check the asset URL and load behavior.', url: 'https://www.chromatic.com/docs/resource-loading/' },
  external: { text: 'Consider a local asset or a stable, controlled source.', url: 'https://www.chromatic.com/docs/resource-loading/' },
  'font-timing': { text: 'Make the font available before visual capture.', url: 'https://www.chromatic.com/docs/font-loading/' },
  mocking: { text: 'Review whether this response needs a stable mock.', url: 'https://www.chromatic.com/docs/mock-network-requests/' },
};

type Filter = 'all' | FindingLabel | 'incomplete';

const statusNames: Record<Exclude<StoryResult['status'], 'complete'> | 'not-scanned', string> = {
  'render-error': 'Render error',
  timeout: 'Timed out',
  unsupported: 'Coverage limited',
  cancelled: 'Cancelled',
  'not-scanned': 'Not scanned',
};

function statusName(status: StoryResult['status'] | 'not-scanned'): string {
  return status === 'complete' ? 'Complete' : statusNames[status];
}

function themeVariables(theme: StorybookTheme): React.CSSProperties {
  const dark = theme.base === 'dark';
  return {
    '--ext-bg': theme.appBg,
    '--ext-surface': theme.appContentBg,
    '--ext-hover': theme.appHoverBg,
    '--ext-border': theme.appBorderColor,
    '--ext-text': theme.textColor,
    '--ext-muted': theme.textMutedColor,
    '--ext-font': theme.fontBase,
    '--ext-code-font': theme.fontCode,
    '--ext-primary': dark ? '#78bbff' : '#075eaf',
    '--ext-primary-hover': dark ? '#a4d2ff' : '#084f91',
    '--ext-primary-text': dark ? '#101923' : '#ffffff',
    '--ext-focus': dark ? '#a4d2ff' : '#075eaf',
    '--ext-link': dark ? '#a4d2ff' : '#075eaf',
    '--ext-failure': dark ? '#ff9d93' : '#a82219',
    '--ext-external': dark ? '#f2c46f' : '#825100',
    '--ext-font-timing': dark ? '#c9aeff' : '#674098',
    '--ext-mocking': dark ? '#8ed3ff' : '#075f8e',
    '--ext-warning': dark ? '#f2c46f' : '#825100',
    '--ext-selection': dark ? '#315578' : '#c9e4ff',
  } as React.CSSProperties;
}

function ExternalsssPanel({ api, active }: { api: API; active: boolean }) {
  const theme = useTheme() as StorybookTheme;
  const { session, run, cancel } = useCatalogScan(api);
  const [filter, setFilter] = useState<Filter>('all');
  const targets = session.phase === 'idle' ? [] : session.targets;
  const results = session.phase === 'idle' ? [] : session.results;
  const running = session.phase === 'running';
  const runState = session.phase === 'finished' ? session.outcome : 'idle';
  const error = session.phase === 'finished' ? session.error : undefined;
  const summary = useMemo(() => summarizeScan(targets, results, !running), [targets, results, running]);
  const { groups, incomplete, scannedStories: completedCount } = summary;
  const targetById = useMemo(() => new Map(targets.map((target) => [target.id, target])), [targets]);
  const unvisited = incomplete.filter((item) => item.status === 'not-scanned');
  const observedIncomplete = incomplete.filter((item) => item.status !== 'not-scanned');
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: groups.length + observedIncomplete.length + (unvisited.length ? 1 : 0) },
    ...(Object.keys(palette) as FindingLabel[]).map((label) => ({ id: label, label: palette[label], count: summary.labelCounts[label] })),
    { id: 'incomplete', label: 'Incomplete', count: incomplete.length },
  ];
  const visibleGroups = filter === 'all' ? groups : filter === 'incomplete' ? [] : groups.filter((group) => group.finding.labels.includes(filter));
  const showIncomplete = filter === 'all' || filter === 'incomplete';
  const hasVisibleResults = visibleGroups.length > 0 || (showIncomplete && incomplete.length > 0);
  const status = running
    ? { title: `Scanning ${Math.min(completedCount + 1, targets.length)} of ${targets.length}`, detail: targets[completedCount]?.name ?? '' }
    : runState === 'cancelled'
      ? { title: 'Scan cancelled', detail: `${completedCount} of ${targets.length} stories checked. Results are partial.` }
      : runState === 'error'
        ? { title: 'Scan stopped', detail: targets.length ? 'Results are partial. Run the scan again to retry.' : 'The scan could not start. Run it again to retry.' }
        : runState === 'complete'
          ? { title: incomplete.length ? 'Scan finished with gaps' : 'Scan complete', detail: `${completedCount} ${completedCount === 1 ? 'story' : 'stories'} checked${incomplete.length ? ` · ${incomplete.length} incomplete` : ''}.` }
          : { title: 'Ready to scan', detail: 'Check every local story without changing the Canvas.' };

  const downloadReport = () => {
    if (session.phase !== 'finished' || targets.length === 0) return;
    const generatedAt = new Date().toISOString();
    const report = buildReport(targets, results, session.outcome, generatedAt);
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `externalsss-report-${generatedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!active) return null;
  return (
    <div className="externalsss" style={themeVariables(theme)}>
      <style>{panelStyles}</style>
      <header className="ext-header">
        <div className="ext-heading">
          <h2>Externalsss</h2>
          <p>Resource stability audit</p>
        </div>
        <div className="ext-actions">
          <button type="button" className="ext-button ext-button--primary" onClick={() => { setFilter('all'); void run(); }} disabled={running}>{running ? 'Scanning…' : runState === 'idle' ? 'Run scan' : 'Scan again'}</button>
          {running && <button type="button" className="ext-button" onClick={cancel}>Cancel</button>}
          {!running && runState !== 'idle' && targets.length > 0 && <button type="button" className="ext-button" onClick={downloadReport}>Download JSON</button>}
        </div>
      </header>
      <div className={`ext-status ${runState === 'error' ? 'ext-status--error' : incomplete.length && !running ? 'ext-status--partial' : ''}`} role="status" aria-live="polite">
        <strong>{status.title}</strong>
        <span className="ext-status-detail" title={status.detail}>{status.detail}</span>
        {running && targets.length > 0 && <div className="ext-progress" role="progressbar" aria-label="Stories checked" aria-valuemin={0} aria-valuemax={targets.length} aria-valuenow={completedCount}><span style={{ transform: `scaleX(${completedCount / targets.length})` }} /></div>}
      </div>
      {error && <p role="alert" className="ext-error">{error}</p>}
      {targets.length > 0 && <div className="ext-toolbar" role="group" aria-label="Finding counts">
        <div className="ext-filters">
          {filters.map((option) => <button key={option.id} type="button" className="ext-filter" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}<strong>{option.count}</strong></button>)}
        </div>
        <select className="ext-filter-select" aria-label="Filter findings" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          {filters.map((option) => <option key={option.id} value={option.id}>{option.label} ({option.count})</option>)}
        </select>
      </div>}
      <div className="ext-results">
        {showIncomplete && incomplete.length > 0 && <section aria-label="Incomplete stories">
          {unvisited.length > 0 && <details className="ext-row">
            <summary>
              <span className="ext-mark ext-mark--incomplete" aria-hidden="true" />
              <span className="ext-resource">{unvisited.length} {unvisited.length === 1 ? 'story' : 'stories'} not scanned</span>
              <span className="ext-row-tags"><span className="ext-tag ext-tag--incomplete">Scan stopped</span></span>
              <span className="ext-story-count">Details</span>
            </summary>
            <div className="ext-detail">
              <p>The scan stopped before these stories were reached.</p>
              <ul>{unvisited.map(({ target }) => <li key={target.id}><a href={target.managerHref}>{target.name}</a></li>)}</ul>
            </div>
          </details>}
          {observedIncomplete.map(({ target, result, status: storyStatus }) => <details className="ext-row" key={target.id}>
            <summary>
              <span className="ext-mark ext-mark--incomplete" aria-hidden="true" />
              <span className="ext-resource" title={target.name}><span className="ext-narrow-label">{statusName(storyStatus)} · </span>{target.name}</span>
              <span className="ext-row-tags"><span className="ext-tag ext-tag--incomplete">{statusName(storyStatus)}</span></span>
              <span className="ext-story-count">Details</span>
            </summary>
            <div className="ext-detail">
              <p>{result?.error ?? 'The observation did not complete.'}</p>
              {result?.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              <a href={target.managerHref}>Open story</a>
            </div>
          </details>)}
        </section>}
        {filter !== 'incomplete' && visibleGroups.length > 0 && <section aria-label="Findings">
          {visibleGroups.map(({ finding, storyIds }) => {
            const primaryLabel = (['failure', 'font-timing', 'external', 'mocking'] as FindingLabel[]).find((label) => finding.labels.includes(label)) ?? 'mocking';
            return <details className="ext-row" key={finding.key}>
              <summary>
                <span className={`ext-mark ext-mark--${primaryLabel}`} aria-hidden="true" />
                <span className="ext-resource" title={finding.name}><span className="ext-narrow-label">{palette[primaryLabel]} · </span>{finding.name}</span>
                <span className="ext-row-tags">{finding.labels.map((label) => <span className={`ext-tag ext-tag--${label}`} key={label}>{palette[label]}</span>)}</span>
                <span className="ext-story-count">{storyIds.length} {storyIds.length === 1 ? 'story' : 'stories'}</span>
              </summary>
              <div className="ext-detail">
                {finding.url && <p className="ext-full-url">Full URL: <code>{finding.url}</code></p>}
                <div className="ext-detail-grid">
                  <div>
                    <h3>Observation and next step</h3>
                    <ul>
                      {finding.notes.map((note) => <li key={note}>{note}</li>)}
                      {finding.labels.map((label) => <li key={label}>{advice[label].text} <a href={advice[label].url} target="_blank" rel="noreferrer">Guidance</a></li>)}
                    </ul>
                  </div>
                  <div>
                    <h3>Affected stories</h3>
                    <ul>{storyIds.map((id) => <li key={id}><a href={targetById.get(id)?.managerHref}>{targetById.get(id)?.name ?? id}</a></li>)}</ul>
                  </div>
                </div>
              </div>
            </details>;
          })}
        </section>}
        {!hasVisibleResults && <div className="ext-empty">
          {running ? <><strong>Scanning stories</strong>Findings appear here as stories finish.</> :
            runState === 'idle' ? <><strong>Scan this catalog</strong>Check images, fonts, and requests across local stories. The visible Canvas stays in place.</> :
              filter === 'incomplete' ? <><strong>No incomplete stories</strong>Every story returned a complete observation.</> :
                filter !== 'all' ? <><strong>No {palette[filter].toLowerCase()} findings</strong>Choose another filter to review the rest of the scan.</> :
                  runState === 'complete' ? <><strong>No findings in the observed scan window</strong>Run the scan again if the stories or their resources change.</> :
                    <><strong>No findings recorded</strong>The scan stopped before it could finish. Run it again to retry.</>}
        </div>}
      </div>
    </div>
  );
}

addons.register(ADDON_ID, (api) => {
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Externalsss',
    render: ({ active }) => <AddonPanel active={Boolean(active)} hasScrollbar={false}><ExternalsssPanel api={api} active={Boolean(active)} /></AddonPanel>,
  });
});
