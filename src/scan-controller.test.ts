import { describe, expect, it, vi } from 'vitest';
import { createScanController } from './scan-controller';
import type { StoryResult } from './model';
const targets = ['one', 'two'].map((id) => ({ id, name: id, previewHref: `https://test.test/iframe.html?id=${id}`, managerHref: 'https://test.test/' }));
const result = (storyId: string, status: StoryResult['status'] = 'complete'): StoryResult => ({ storyId, status, findings: [], warnings: [] });

describe('scan controller', () => {
  it('notifies subscribers and ignores duplicate starts', async () => {
    let finish!: (value: StoryResult) => void;
    const observe = vi.fn().mockImplementationOnce(() => new Promise<StoryResult>((resolve) => { finish = resolve; })).mockResolvedValue(result('two'));
    const controller = createScanController(() => targets, observe);
    const changed = vi.fn(); const unsubscribe = controller.subscribe(changed);
    const run = controller.run(); await controller.run();
    expect(observe).toHaveBeenCalledTimes(1);
    finish(result('one')); await run;
    expect(controller.getSnapshot()).toMatchObject({ phase: 'finished', outcome: 'complete', results: [result('one'), result('two')] });
    expect(changed).toHaveBeenCalled(); unsubscribe(); changed.mockClear(); controller.clear(); expect(changed).not.toHaveBeenCalled();
  });
  it('retains completed observations and captured targets when retrying', async () => {
    const getTargets = vi.fn(() => targets);
    const observe = vi.fn().mockResolvedValueOnce(result('one')).mockResolvedValueOnce(result('two', 'timeout')).mockResolvedValueOnce(result('two'));
    const controller = createScanController(getTargets, observe);
    await controller.run(); await controller.retry();
    expect(getTargets).toHaveBeenCalledTimes(1); expect(observe).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ results: [result('one'), result('two')] });
  });
  it('preserves cancellation and reports scanner errors', async () => {
    const controller = createScanController(() => targets, async (target, _, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(result(target.id, 'cancelled')))));
    const run = controller.run(); controller.cancel(); await run;
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'cancelled', results: [result('one', 'cancelled')] });
    const failed = createScanController(() => { throw new Error('index unavailable'); }, vi.fn());
    await failed.run(); expect(failed.getSnapshot()).toMatchObject({ outcome: 'error', error: 'index unavailable' });
  });
  it('discards late results after clear, including during a replacement run', async () => {
    const finishes: ((value: StoryResult) => void)[] = [];
    const controller = createScanController(() => targets.slice(0, 1), () => new Promise((resolve) => finishes.push(resolve)));
    const first = controller.run(); controller.clear(); expect(controller.getSnapshot()).toEqual({ phase: 'idle' });
    const second = controller.run(); finishes[0]!(result('one', 'timeout')); await first;
    expect(controller.getSnapshot().phase).toBe('running'); finishes[1]!(result('one')); await second;
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'complete', results: [result('one')] });
  });
});
