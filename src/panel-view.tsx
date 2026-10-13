import React from 'react';
import type { StorybookTheme } from 'storybook/theming';
import type { FindingLabel, StoryResult } from './model';
import type { PanelModel, Filter } from './panel-model';
import { palette } from './panel-model';
import type { getComposedCatalogs } from './storybook-compat';
import { panelStyles } from './panel-styles';

const darkColors = {
  '--ext-primary': '#78bbff',
  '--ext-primary-hover': '#a4d2ff',
  '--ext-primary-text': '#101923',
  '--ext-focus': '#a4d2ff',
  '--ext-link': '#a4d2ff',
  '--ext-failure': '#ff9d93',
  '--ext-external': '#f2c46f',
  '--ext-font-timing': '#c9aeff',
  '--ext-mocking': '#8ed3ff',
  '--ext-warning': '#f2c46f',
  '--ext-selection': '#315578',
};
const lightColors = {
  '--ext-primary': '#075eaf',
  '--ext-primary-hover': '#084f91',
  '--ext-primary-text': '#ffffff',
  '--ext-focus': '#075eaf',
  '--ext-link': '#075eaf',
  '--ext-failure': '#a82219',
  '--ext-external': '#825100',
  '--ext-font-timing': '#674098',
  '--ext-mocking': '#075f8e',
  '--ext-warning': '#825100',
  '--ext-selection': '#c9e4ff',
};
const advice: Record<FindingLabel, { text: string; url: string }> = {
  failure: { text: 'Check the asset URL and load behavior.', url: 'https://www.chromatic.com/docs/resource-loading/' },
  external: {
    text: 'Consider a local asset or a stable, controlled source.',
    url: 'https://www.chromatic.com/docs/resource-loading/',
  },
  'font-timing': {
    text: 'Make the font available before visual capture.',
    url: 'https://www.chromatic.com/docs/font-loading/',
  },
  mocking: {
    text: 'Review whether this response needs a stable mock.',
    url: 'https://www.chromatic.com/docs/mock-network-requests/',
  },
};

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
    ...(dark ? darkColors : lightColors),
  } as React.CSSProperties;
}

export function IncompleteStories({ model, remote }: { model: PanelModel; remote: boolean }) {
  const { unvisited, observedIncomplete } = model;
  return (
    <section aria-label="Incomplete stories">
      {unvisited.length > 0 && (
        <details className="ext-row">
          <summary>
            <span className="ext-mark ext-mark--incomplete" aria-hidden="true" />
            <span className="ext-resource">
              {unvisited.length} {unvisited.length === 1 ? 'story' : 'stories'} not scanned
            </span>
            <span className="ext-row-tags">
              <span className="ext-tag ext-tag--incomplete">Scan stopped</span>
            </span>
            <span className="ext-story-count">Details</span>
          </summary>
          <div className="ext-detail">
            <p>The scan stopped before these stories were reached.</p>
            <ul>
              {unvisited.map(({ target }) => (
                <li key={target.id}>
                  <a
                    href={target.managerHref}
                    target={remote ? '_blank' : undefined}
                    rel={remote ? 'noreferrer' : undefined}
                  >
                    {target.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      {observedIncomplete.map(({ target, result, status: storyStatus }) => (
        <details className="ext-row" key={target.id}>
          <summary>
            <span className="ext-mark ext-mark--incomplete" aria-hidden="true" />
            <span className="ext-resource" title={target.name}>
              <span className="ext-narrow-label">{statusName(storyStatus)} · </span>
              {target.name}
            </span>
            <span className="ext-row-tags">
              <span className="ext-tag ext-tag--incomplete">{statusName(storyStatus)}</span>
            </span>
            <span className="ext-story-count">Details</span>
          </summary>
          <div className="ext-detail">
            <p>{result?.error ?? 'The observation did not complete.'}</p>
            {result?.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            <a href={target.managerHref} target={remote ? '_blank' : undefined} rel={remote ? 'noreferrer' : undefined}>
              Open story
            </a>
          </div>
        </details>
      ))}
    </section>
  );
}
export function Findings({ model, remote }: { model: PanelModel; remote: boolean }) {
  const { visibleGroups, targetById } = model;
  return (
    <section aria-label="Findings">
      {visibleGroups.map(({ finding, storyIds }) => {
        const primaryLabel =
          (['failure', 'font-timing', 'external', 'mocking'] as FindingLabel[]).find((label) =>
            finding.labels.includes(label),
          ) ?? 'mocking';
        return (
          <details className="ext-row" key={finding.key}>
            <summary>
              <span className={`ext-mark ext-mark--${primaryLabel}`} aria-hidden="true" />
              <span className="ext-resource" title={finding.name}>
                <span className="ext-narrow-label">{palette[primaryLabel]} · </span>
                {finding.name}
              </span>
              <span className="ext-row-tags">
                {finding.labels.map((label) => (
                  <span className={`ext-tag ext-tag--${label}`} key={label}>
                    {palette[label]}
                  </span>
                ))}
              </span>
              <span className="ext-story-count">
                {storyIds.length} {storyIds.length === 1 ? 'story' : 'stories'}
              </span>
            </summary>
            <div className="ext-detail">
              {finding.url && (
                <p className="ext-full-url">
                  Full URL: <code>{finding.url}</code>
                </p>
              )}
              <div className="ext-detail-grid">
                <div>
                  <h3>Observation and next step</h3>
                  <ul>
                    {finding.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                    {finding.labels.map((label) => (
                      <li key={label}>
                        {advice[label].text}{' '}
                        <a href={advice[label].url} target="_blank" rel="noreferrer">
                          Guidance
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Affected stories</h3>
                  <ul>
                    {storyIds.map((id) => (
                      <li key={id}>
                        <a
                          href={targetById.get(id)?.managerHref}
                          target={remote ? '_blank' : undefined}
                          rel={remote ? 'noreferrer' : undefined}
                        >
                          {targetById.get(id)?.name ?? id}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </details>
        );
      })}
    </section>
  );
}
interface ViewProps {
  theme: StorybookTheme;
  model: PanelModel;
  filter: Filter;
  refId: string;
  catalogs: ReturnType<typeof getComposedCatalogs>;
  onCatalog: (id: string) => void;
  onFilter: (filter: Filter) => void;
  onRun: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onDownload: () => void;
}
function CatalogSelector({
  model,
  catalogs,
  refId,
  onCatalog,
}: Pick<ViewProps, 'model' | 'catalogs' | 'refId' | 'onCatalog'>) {
  if (!catalogs.length) return null;
  return (
    <label className="ext-toolbar">
      Catalog
      <select
        className="ext-filter-select"
        style={{ display: 'block' }}
        aria-label="Catalog"
        value={refId}
        disabled={model.running}
        onChange={(event) => onCatalog(event.target.value)}
      >
        <option value="">Local</option>
        {catalogs.map((item) => (
          <option key={item.refId} value={item.refId} disabled={item.status !== 'ready'}>
            {item.title}
            {item.status !== 'ready' ? ` (${item.status})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
function Toolbar({
  model,
  onRun,
  onRetry,
  onCancel,
  onDownload,
}: Pick<ViewProps, 'model' | 'onRun' | 'onRetry' | 'onCancel' | 'onDownload'>) {
  return (
    <header className="ext-header">
      <div className="ext-heading">
        <h2>Externalsss</h2>
        <p>Resource stability audit</p>
      </div>
      <div className="ext-actions">
        <button
          type="button"
          className="ext-button ext-button--primary"
          onClick={onRun}
          disabled={model.actions.runDisabled}
        >
          {model.runLabel}
        </button>
        {model.actions.retryVisible && (
          <button type="button" className="ext-button" onClick={onRetry}>
            Retry incomplete
          </button>
        )}
        {model.actions.cancelVisible && (
          <button type="button" className="ext-button" onClick={onCancel}>
            Cancel
          </button>
        )}
        {model.actions.downloadVisible && (
          <button type="button" className="ext-button" onClick={onDownload}>
            Download JSON
          </button>
        )}
      </div>
    </header>
  );
}
function ScanStatus({ model }: { model: PanelModel }) {
  const { progress } = model;
  return (
    <div className={`ext-status ${model.statusClass}`} role="status" aria-live="polite">
      <strong>{model.status.title}</strong>
      <span className="ext-status-detail" title={model.status.detail}>
        {model.status.detail}
      </span>
      {progress && progress.total > 0 && (
        <div
          className="ext-progress"
          role="progressbar"
          aria-label="Stories checked"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.completed}
        >
          <span style={{ transform: `scaleX(${progress.completed / progress.total})` }} />
        </div>
      )}
    </div>
  );
}
function Filters({ model, filter, onFilter }: Pick<ViewProps, 'model' | 'filter' | 'onFilter'>) {
  if (!model.targets.length) return null;
  return (
    <div className="ext-toolbar" role="group" aria-label="Finding counts">
      <div className="ext-filters">
        {model.filters.map((option) => (
          <button
            key={option.id}
            type="button"
            className="ext-filter"
            aria-pressed={filter === option.id}
            onClick={() => onFilter(option.id)}
          >
            {option.label}
            <strong>{option.count}</strong>
          </button>
        ))}
      </div>
      <select
        className="ext-filter-select"
        aria-label="Filter findings"
        value={filter}
        onChange={(event) => onFilter(event.target.value as Filter)}
      >
        {model.filters.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </div>
  );
}
export function PanelView(props: ViewProps) {
  const { model, refId, theme } = props;
  return (
    <div className="externalsss" style={themeVariables(theme)}>
      <style>{panelStyles}</style>
      <CatalogSelector {...props} />
      <Toolbar {...props} />
      <ScanStatus model={model} />
      {model.error && (
        <p role="alert" className="ext-error">
          {model.error}
        </p>
      )}
      <Filters {...props} />
      <div className="ext-results">
        {model.showIncomplete && model.summary.incomplete.length > 0 && (
          <IncompleteStories model={model} remote={Boolean(refId)} />
        )}
        {model.visibleGroups.length > 0 && <Findings model={model} remote={Boolean(refId)} />}
        {!model.hasVisibleResults && (
          <div className="ext-empty">
            <strong>{model.empty.title}</strong>
            {model.empty.detail}
          </div>
        )}
      </div>
    </div>
  );
}
