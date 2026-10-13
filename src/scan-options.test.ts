import { describe, expect, it, vi } from 'vitest';
import { createScanController } from './scan-controller';
import type { StoryResult } from './model';
import { managerHead } from './preset';
import { DEFAULT_SCAN_CONCURRENCY, scanConcurrency } from './scan-options';

describe('scan concurrency configuration', () => {
  it('embeds the default and all supported overrides', () => {
    expect(scanConcurrency()).toBe(DEFAULT_SCAN_CONCURRENCY);
    for (const value of [1, 2, 3, 4] as const)
      expect(managerHead('', { scanConcurrency: value })).toContain(`{"scanConcurrency":${value}}`);
  });
  it.each([0, 5, -1, 1.5, NaN, Infinity, '2', null, {}, []])('rejects invalid preset input %j', (value) => {
    expect(() => managerHead('', { scanConcurrency: value as 1 })).toThrow(/scanConcurrency/);
  });
});

it('uses the selected default for scheduling and preset metadata', async () => {
  const targets = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: String(i), previewHref: 'https://test.test/iframe.html', managerHref: 'https://test.test/' }));
  const observe = vi.fn((target: typeof targets[number], _: string, signal: AbortSignal) => new Promise<StoryResult>((resolve) => {
    signal.addEventListener('abort', () => resolve({ storyId: target.id, status: 'cancelled', findings: [], warnings: [] }), { once: true });
  }));
  const controller = createScanController(() => targets, observe);
  const run = controller.run();
  expect(observe).toHaveBeenCalledTimes(DEFAULT_SCAN_CONCURRENCY);
  expect(controller.getSnapshot()).toMatchObject({ progress: { active: DEFAULT_SCAN_CONCURRENCY } });
  expect(managerHead()).toContain(`{"scanConcurrency":${DEFAULT_SCAN_CONCURRENCY}}`);
  controller.cancel(); await run;
  expect(controller.getSnapshot()).toMatchObject({ outcome: 'cancelled' });
});
