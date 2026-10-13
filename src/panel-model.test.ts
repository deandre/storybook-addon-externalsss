import { describe, expect, it, vi } from 'vitest';
import { panelInputs, panelModel, type Filter } from './panel-model';
import { summarizeScan } from './report';
import type { ScanSession } from './scan';
const targets = ['one', 'two'].map((id) => ({
  id,
  name: id,
  previewHref: 'https://test.test/iframe.html',
  managerHref: 'https://test.test/',
}));
const result = { storyId: 'one', status: 'complete' as const, warnings: [], findings: [] };
function renderPanel(session: ScanSession, filter: Filter, remote: boolean, remoteReady = true) {
  const { targets, results, includeUnvisited } = panelInputs(session);
  return panelModel(session, filter, remote, remoteReady, {
    summary: summarizeScan(targets, results, includeUnvisited),
    targetById: new Map(targets.map((target) => [target.id, target])),
  });
}
describe('panel presentation policy', () => {
  it('shows connection status and disables unavailable catalogs', () => {
    const session: ScanSession = {
      phase: 'running',
      targets: [],
      results: [],
      retrying: false,
      progress: { completed: 0, total: 0 },
    };
    expect(renderPanel(session, 'all', true).status.title).toBe('Connecting to catalog');
    expect(renderPanel({ phase: 'idle' }, 'all', true, false).actions.runDisabled).toBe(true);
  });
  it('preserves partial reporting, retry policy and filter empty states', () => {
    const session: ScanSession = { phase: 'finished', outcome: 'cancelled', targets, results: [result] };
    const partial = renderPanel(session, 'all', false);
    expect(partial.status.detail).toBe('1 of 2 stories checked. Results are partial.');
    expect(partial.actions).toMatchObject({ retryVisible: true, downloadVisible: true });
    expect(partial.unvisited).toHaveLength(1);
    expect(renderPanel({ ...session, restartRequired: true }, 'all', true).actions.retryVisible).toBe(false);
    expect(renderPanel(session, 'external', false).empty.title).toBe('No external dependency findings');
  });
  it('shows unvisited stories during retries but not fresh scans', () => {
    const session: ScanSession = {
      phase: 'running',
      targets,
      results: [result],
      retrying: false,
      progress: { completed: 1, total: 2 },
    };
    expect(renderPanel(session, 'incomplete', false).unvisited).toHaveLength(0);
    expect(renderPanel({ ...session, retrying: true }, 'incomplete', false).unvisited).toHaveLength(1);
  });
});

describe('cached panel data', () => {
  it('reuses grouped findings and target lookups across progress and filter changes', () => {
    const readFindings = vi.fn(() => [{ key: 'asset', name: 'Asset', labels: ['external' as const], notes: [] }]);
    const observed = {
      ...result,
      get findings() {
        return readFindings();
      },
    };
    const session: ScanSession = {
      phase: 'running',
      targets,
      results: [observed],
      retrying: false,
      progress: { completed: 1, total: 2 },
    };
    const initial = renderPanel(session, 'all', false);
    const cached = { summary: initial.summary, targetById: initial.targetById };
    readFindings.mockClear();
    const next = { ...session, progress: { ...session.progress, current: 'two' } };
    for (const filter of ['all', 'external', 'incomplete'] as const) {
      const model = panelModel(next, filter, false, true, cached);
      expect(model.summary).toBe(initial.summary);
      expect(model.targetById).toBe(initial.targetById);
      expect(model.status.detail).toBe('two');
      expect(model.showIncomplete).toBe(filter !== 'external');
    }
    expect(readFindings).not.toHaveBeenCalled();
  });
  it('keeps cache inputs stable during progress and exposes result and coverage changes', () => {
    const session: ScanSession = {
      phase: 'running',
      targets,
      results: [result],
      retrying: false,
      progress: { completed: 1, total: 2 },
    };
    const inputs = panelInputs(session);
    const progressInputs = panelInputs({ ...session, progress: { ...session.progress, current: 'two' } });
    expect(progressInputs.targets).toBe(inputs.targets);
    expect(progressInputs.results).toBe(inputs.results);
    expect(progressInputs.includeUnvisited).toBe(inputs.includeUnvisited);
    expect(panelInputs({ phase: 'idle' })).toBe(panelInputs({ phase: 'idle' }));
    const finished: ScanSession = { phase: 'finished', outcome: 'cancelled', targets, results: session.results };
    expect(panelInputs(finished).includeUnvisited).toBe(true);
    expect(panelInputs(session).includeUnvisited).toBe(false);
    expect(renderPanel(finished, 'all', false).unvisited).toHaveLength(1);
    const replacement = {
      ...session,
      results: [result, { ...result, storyId: 'two' }],
      progress: { completed: 2, total: 2 },
    };
    expect(panelInputs(replacement).results).not.toBe(inputs.results);
    expect(renderPanel(replacement, 'all', false).summary.completeStories).toBe(2);
  });
});
