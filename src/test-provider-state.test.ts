import { describe, expect, it, vi } from 'vitest';
import { resourceStatus, connectTestProvider } from './test-provider-state';
import { createScanController } from './scan-controller';
import type { StoryResult } from './model';
const clean: StoryResult = { storyId: 'one', status: 'complete', findings: [], warnings: [] };
describe('resource statuses', () => {
  it('maps coverage and diagnostics without disclosing evidence', () => {
    expect(resourceStatus('one', clean).value).toBe('status-value:success');
    for (const status of ['timeout', 'unsupported'] as const) expect(resourceStatus('one', { ...clean, status }).value).toBe('status-value:warning');
    expect(resourceStatus('one', { ...clean, warnings: ['secret'] }).value).toBe('status-value:warning');
    expect(resourceStatus('one', { ...clean, status: 'cancelled' }).value).toBe('status-value:unknown');
    expect(resourceStatus('one').value).toBe('status-value:unknown');
    expect(resourceStatus('one', undefined, true).value).toBe('status-value:pending');
    expect(resourceStatus('one', { ...clean, status: 'render-error', error: 'secret' }).description).not.toContain('secret');
  });
  it('prioritizes failures over advisory findings', () => {
    const findings = [{ key: 'secret', name: 'secret', url: 'https://secret.test', labels: ['external', 'failure'] as const, notes: [] }];
    const status = resourceStatus('one', { ...clean, findings: findings.map((finding) => ({ ...finding, labels: [...finding.labels] })) });
    expect(status.value).toBe('status-value:error'); expect(JSON.stringify(status)).not.toContain('secret');
    expect(resourceStatus('one', { ...clean, findings: [{ ...findings[0]!, labels: ['mocking'] }] }).value).toBe('status-value:warning');
  });
  it('connects Run All and Clear and clears only the scoped store', async () => {
    const controller = createScanController(() => [], vi.fn(), { scanConcurrency: 1 });
    let run!: () => void; let clear!: () => void;
    const provider = { testProviderId: 'test', getState: vi.fn(), setState: vi.fn(), runWithState: vi.fn(), settingsChanged: vi.fn(), onRunAll: vi.fn((listener) => { run = listener; return vi.fn(); }), onClearAll: vi.fn((listener) => { clear = listener; return vi.fn(); }) };
    const statuses = { typeId: 'resources', getAll: vi.fn(), set: vi.fn(), unset: vi.fn(), onSelect: vi.fn(), onAllStatusChange: vi.fn() };
    const connection = connectTestProvider(controller, provider, statuses);
    run(); await Promise.resolve(); expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:succeeded');
    clear(); connection.clear(); expect(controller.getSnapshot()).toEqual({ phase: 'idle' }); expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:pending');
    connection.dispose();
  });
  it('keeps retry targets pending until replaced and reports scanner crashes', async () => {
    let finish!: (value: StoryResult) => void;
    const targets = ['one', 'two', 'three'].map((id) => ({ id, name: id, previewHref: 'https://test.test/iframe.html', managerHref: 'https://test.test/' }));
    const observe = vi.fn().mockResolvedValueOnce(clean).mockResolvedValueOnce({ ...clean, storyId: 'two', status: 'timeout' }).mockResolvedValueOnce({ ...clean, storyId: 'three', status: 'timeout' })
      .mockImplementation(() => new Promise<StoryResult>((resolve) => { finish = resolve; }));
    const controller = createScanController(() => targets, observe, { scanConcurrency: 1 });
    const provider = { testProviderId: 'test', getState: vi.fn(), setState: vi.fn(), runWithState: vi.fn(), settingsChanged: vi.fn(), onRunAll: vi.fn(() => vi.fn()), onClearAll: vi.fn(() => vi.fn()) };
    const statuses = { typeId: 'resources', getAll: vi.fn(), set: vi.fn(), unset: vi.fn(), onSelect: vi.fn(), onAllStatusChange: vi.fn() };
    connectTestProvider(controller, provider, statuses);
    await controller.run();
    const retry = controller.retry();
    expect(statuses.set.mock.lastCall?.[0].map((status: { value: string }) => status.value)).toEqual(['status-value:pending', 'status-value:pending']);
    finish({ ...clean, storyId: 'two' }); await Promise.resolve();
    expect(statuses.set.mock.lastCall?.[0].map((status: { value: string }) => status.value)).toEqual(['status-value:success']);
    controller.cancel(); finish({ ...clean, storyId: 'three', status: 'cancelled' }); await retry;
    expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:pending');
    observe.mockRejectedValueOnce(new Error('scanner failed'));
    await controller.run();
    expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:crashed');
  });

  it('skips progress-only writes and publishes just the newly observed story', async () => {
    const targets = ['one', 'two'].map((id) => ({ id, name: id, previewHref: 'https://test.test/iframe.html', managerHref: 'https://test.test/' }));
    const finishes: ((value: StoryResult) => void)[] = [];
    const controller = createScanController(() => targets, () => new Promise((resolve) => finishes.push(resolve)), { scanConcurrency: 1 });
    const provider = { testProviderId: 'test', getState: vi.fn(), setState: vi.fn(), runWithState: vi.fn(), settingsChanged: vi.fn(), onRunAll: vi.fn(() => vi.fn()), onClearAll: vi.fn(() => vi.fn()) };
    const statuses = { typeId: 'resources', getAll: vi.fn(), set: vi.fn(), unset: vi.fn(), onSelect: vi.fn(), onAllStatusChange: vi.fn() };
    connectTestProvider(controller, provider, statuses);
    const run = controller.run();
    expect(statuses.set).toHaveBeenCalledTimes(1);
    expect(statuses.set.mock.lastCall?.[0].map((status: { value: string }) => status.value)).toEqual(['status-value:pending', 'status-value:pending']);
    expect(provider.setState).toHaveBeenCalledTimes(1);
    finishes[0]!(clean); await vi.waitFor(() => expect(finishes).toHaveLength(2));
    expect(statuses.set).toHaveBeenCalledTimes(2);
    expect(statuses.set).toHaveBeenLastCalledWith([resourceStatus('one', clean)]);
    expect(provider.setState).toHaveBeenCalledTimes(1);
    controller.cancel(); finishes[1]!({ ...clean, storyId: 'two', status: 'cancelled' }); await run;
    expect(statuses.set).toHaveBeenCalledTimes(3);
    expect(statuses.set.mock.lastCall?.[0]).toEqual([resourceStatus('two', { ...clean, storyId: 'two', status: 'cancelled' })]);
    expect(provider.setState).toHaveBeenCalledTimes(2);
  });
  it('marks unvisited stories unknown at the end of an interrupted run', async () => {
    const targets = ['one', 'two'].map((id) => ({ id, name: id, previewHref: 'https://test.test/iframe.html', managerHref: 'https://test.test/' }));
    const controller = createScanController(() => targets, async () => { throw new Error('scanner failed'); }, { scanConcurrency: 1 });
    const provider = { testProviderId: 'test', getState: vi.fn(), setState: vi.fn(), runWithState: vi.fn(), settingsChanged: vi.fn(), onRunAll: vi.fn(() => vi.fn()), onClearAll: vi.fn(() => vi.fn()) };
    const statuses = { typeId: 'resources', getAll: vi.fn(), set: vi.fn(), unset: vi.fn(), onSelect: vi.fn(), onAllStatusChange: vi.fn() };
    connectTestProvider(controller, provider, statuses);
    await controller.run();
    expect(statuses.set).toHaveBeenCalledTimes(2);
    expect(statuses.set.mock.lastCall?.[0]).toEqual([resourceStatus('one'), resourceStatus('two')]);
    expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:crashed');
  });

});

describe('provider attachment', () => {
  function stores() {
    const stops = [vi.fn(), vi.fn()];
    const provider = { testProviderId: 'test', getState: vi.fn(), setState: vi.fn(), runWithState: vi.fn(), settingsChanged: vi.fn(), onRunAll: vi.fn(() => stops[0]!), onClearAll: vi.fn(() => stops[1]!) };
    const statuses = { typeId: 'resources', getAll: vi.fn(), set: vi.fn(), unset: vi.fn(), onSelect: vi.fn(), onAllStatusChange: vi.fn() };
    return { provider, statuses, stops };
  }
  it('hydrates a running scan, then writes only subsequent observations', async () => {
    const targets = ['one', 'two'].map((id) => ({ id, name: id, previewHref: 'https://test.test/iframe.html', managerHref: 'https://test.test/' }));
    let finish!: (result: StoryResult) => void;
    const controller = createScanController(() => targets, vi.fn().mockResolvedValueOnce(clean).mockImplementation(() => new Promise<StoryResult>((resolve) => { finish = resolve; })), { scanConcurrency: 1 });
    const run = controller.run(); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const { provider, statuses, stops } = stores();
    const connection = connectTestProvider(controller, provider, statuses);
    expect(statuses.set).toHaveBeenLastCalledWith([resourceStatus('one', clean), resourceStatus('two', undefined, true)]);
    expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:running');
    finish({ ...clean, storyId: 'two' }); await run;
    expect(statuses.set).toHaveBeenLastCalledWith([resourceStatus('two', { ...clean, storyId: 'two' })]);
    connection.dispose(); connection.dispose();
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
    statuses.set.mockClear(); statuses.unset.mockClear(); controller.clear(); expect(statuses.set).not.toHaveBeenCalled(); expect(statuses.unset).not.toHaveBeenCalled();
  });
  it('hydrates a finished scan including unvisited stories', async () => {
    const targets = ['one', 'two'].map((id) => ({ id, name: id, previewHref: 'https://test.test/iframe.html', managerHref: 'https://test.test/' }));
    const controller = createScanController(() => targets, async () => { throw new Error('failed'); }, { scanConcurrency: 1 });
    await controller.run();
    const { provider, statuses } = stores();
    const connection = connectTestProvider(controller, provider, statuses);
    expect(statuses.set).toHaveBeenCalledWith([resourceStatus('one'), resourceStatus('two')]);
    expect(provider.setState).toHaveBeenLastCalledWith('test-provider-state:crashed');
    connection.dispose();
  });
});
