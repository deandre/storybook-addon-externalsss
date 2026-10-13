import { describe, expect, it, vi } from 'vitest';
import { createScanController } from './scan-controller';
import type { StoryResult } from './model';
const targets = ['one', 'two'].map((id) => ({ id, name: id, previewHref: `https://test.test/iframe.html?id=${id}`, managerHref: 'https://test.test/' }));
const result = (storyId: string, status: StoryResult['status'] = 'complete'): StoryResult => ({ storyId, status, findings: [], warnings: [] });

describe('scan controller', () => {
  it('notifies subscribers and ignores duplicate starts', async () => {
    let finish!: (value: StoryResult) => void;
    const observe = vi.fn().mockImplementationOnce(() => new Promise<StoryResult>((resolve) => { finish = resolve; })).mockResolvedValue(result('two'));
    const controller = createScanController(() => targets, observe, { scanConcurrency: 1 });
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
    const controller = createScanController(getTargets, observe, { scanConcurrency: 1 });
    await controller.run(); await controller.retry();
    expect(getTargets).toHaveBeenCalledTimes(1); expect(observe).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ results: [result('one'), result('two')] });
  });
  it('preserves cancellation and reports scanner errors', async () => {
    const controller = createScanController(() => targets, async (target, _, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(result(target.id, 'cancelled')))), { scanConcurrency: 1 });
    const run = controller.run(); controller.cancel(); await run;
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'cancelled', results: [result('one', 'cancelled')] });
    const failed = createScanController(() => { throw new Error('index unavailable'); }, vi.fn(), { scanConcurrency: 1 });
    await failed.run(); expect(failed.getSnapshot()).toMatchObject({ outcome: 'error', error: 'index unavailable' });
  });
  it('discards late results after clear, including during a replacement run', async () => {
    const finishes: ((value: StoryResult) => void)[] = [];
    const controller = createScanController(() => targets.slice(0, 1), () => new Promise((resolve) => finishes.push(resolve)), { scanConcurrency: 1 });
    const first = controller.run(); controller.clear(); expect(controller.getSnapshot()).toEqual({ phase: 'idle' });
    const second = controller.run(); finishes[0]!(result('one', 'timeout')); await first;
    expect(controller.getSnapshot().phase).toBe('running'); finishes[1]!(result('one')); await second;
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'complete', results: [result('one')] });
  });
});

describe('scan lifecycle events', () => {
  it('publishes snapshots before events, emits deltas, and no-ops a complete retry', async () => {
    const controller = createScanController(() => targets, async (target) => result(target.id), { scanConcurrency: 1 });
    const events: import('./scan').ScanEvent[] = [];
    controller.onEvent((event) => {
      events.push(event);
      if (event.type === 'result') expect(controller.getSnapshot()).toMatchObject({ results: expect.arrayContaining([event.result]) });
    });
    await controller.run();
    expect(events.map((event) => event.type)).toEqual(['preparing', 'started', 'progress', 'result', 'progress', 'result', 'finished']);
    const count = events.length;
    await controller.retry(); expect(events).toHaveLength(count);
    expect(events.filter((event) => event.type === 'result').every((event) => !('session' in event))).toBe(true);
  });
  it('stops when cleared synchronously by a subscriber during preparation or progress', async () => {
    for (const phase of ['preparing', 'progress']) {
      const observe = vi.fn();
      const controller = createScanController(() => targets, observe, { scanConcurrency: 1 });
      controller.onEvent((event) => { if (event.type === phase) controller.clear(); });
      await controller.run();
      expect(observe).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toEqual({ phase: 'idle' });
    }
  });
});

describe('bounded parallel execution', () => {
  const catalog = Array.from({ length: 6 }, (_, i) => ({ ...targets[0]!, id: String(i), name: String(i) }));
  it.each([1, 2, 3, 4] as const)('limits active observations to %i and immediately refills slots', async (limit) => {
    let active = 0; let peak = 0;
    const finishes = new Map<string, () => void>();
    const observe = vi.fn((target: typeof catalog[number]) => new Promise<StoryResult>((resolve) => {
      active++; peak = Math.max(peak, active);
      finishes.set(target.id, () => { active--; resolve(result(target.id)); });
    }));
    const controller = createScanController(() => catalog, observe, { scanConcurrency: limit });
    const run = controller.run(); await controller.run();
    expect(observe).toHaveBeenCalledTimes(limit);
    expect(controller.getSnapshot()).toMatchObject({ progress: { active: limit, completed: 0, current: limit === 1 ? '0' : undefined } });
    // Finish a later target first; its slot refills without waiting for the first target.
    finishes.get(String(limit - 1))!();
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(limit + 1));
    expect(controller.getSnapshot()).toMatchObject({ progress: { active: limit, completed: 1 } });
    const done = new Set([String(limit - 1)]);
    while (done.size < catalog.length) {
      for (const [id, finish] of finishes) if (!done.has(id)) { done.add(id); finish(); }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await run;
    expect(peak).toBe(limit); expect(active).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'complete', results: catalog.map(({ id }) => result(id)) });
  });
  it('aborts all active observations, leaves queued stories unvisited, and retries only gaps', async () => {
    const calls: string[] = []; const finishes = new Map<string, (r: StoryResult) => void>();
    const controller = createScanController(() => catalog, (target, _, signal) => new Promise((resolve) => {
      calls.push(target.id); finishes.set(target.id, resolve);
      signal.addEventListener('abort', () => resolve(result(target.id, 'cancelled')), { once: true });
    }), { scanConcurrency: 2 });
    const run = controller.run(); finishes.get('1')!(result('1'));
    await vi.waitFor(() => expect(calls).toEqual(['0', '1', '2']));
    controller.cancel(); await run;
    expect(calls).toEqual(['0', '1', '2']);
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'cancelled', results: [result('0', 'cancelled'), result('1'), result('2', 'cancelled')] });
    const retry = controller.retry();
    expect(calls.slice(3)).toEqual(['0', '2']);
    const done = new Set(['1']);
    while (done.size < catalog.length) {
      for (const id of calls.slice(3)) if (!done.has(id)) { done.add(id); finishes.get(id)!(result(id)); }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await retry;
    expect(controller.getSnapshot()).toMatchObject({ results: catalog.map(({ id }) => result(id)) });
  });
  it('drains sibling cleanup on failure and retains the original error', async () => {
    let cleaned = false;
    const controller = createScanController(() => catalog, (target, _, signal) => {
      if (target.id === '0') return Promise.reject(new Error('first error'));
      return new Promise((resolve) => signal.addEventListener('abort', () => {
        setTimeout(() => { cleaned = true; resolve(result(target.id, 'cancelled')); }, 5);
      }));
    }, { scanConcurrency: 2 });
    await controller.run(); expect(cleaned).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ outcome: 'error', error: 'first error', results: [result('1', 'cancelled')] });
  });
  it('handles empty catalogs and cancellation before iframe creation', async () => {
    const observe = vi.fn(); const empty = createScanController(() => [], observe, { scanConcurrency: 4 });
    await empty.run(); expect(empty.getSnapshot()).toMatchObject({ outcome: 'complete', results: [] });
    for (const eventType of ['started', 'progress'] as const) {
      const controller = createScanController(() => catalog, observe, { scanConcurrency: 4 });
      controller.onEvent((event) => { if (event.type === eventType) controller.cancel(); });
      await controller.run(); expect(controller.getSnapshot()).toMatchObject({ outcome: 'cancelled', results: [] });
    }
    expect(observe).not.toHaveBeenCalled();
  });
  it('ignores every late parallel result after clear and replacement', async () => {
    const finishes: ((r: StoryResult) => void)[] = [];
    const controller = createScanController(() => targets, () => new Promise((resolve) => finishes.push(resolve)), { scanConcurrency: 2 });
    const old = controller.run(); controller.clear(); const current = controller.run();
    finishes[0]!(result('one', 'timeout')); finishes[1]!(result('two', 'timeout')); await old;
    expect(controller.getSnapshot()).toMatchObject({ phase: 'running', results: [] });
    finishes[3]!(result('two')); finishes[2]!(result('one')); await current;
    expect(controller.getSnapshot()).toMatchObject({ results: [result('one'), result('two')] });
  });
});
