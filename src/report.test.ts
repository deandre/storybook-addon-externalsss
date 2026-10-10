import { describe, expect, it } from 'vitest';
import { buildReport } from './report';
import type { StoryResult } from './model';

describe('buildReport', () => {
  it('groups affected stories and omits resource query values and raw keys', () => {
    const targets = [
      { id: 'one', name: 'Example / One' },
      { id: 'two', name: 'Example / Two' },
    ];
    const finding = {
      key: 'url:https://api.example.test/data?token=private-value#fragment',
      name: 'https://api.example.test/data?…',
      url: 'https://api.example.test/data?token=private-value#fragment',
      labels: ['external', 'mocking'] as const,
      notes: ['Review this request for deterministic test data. It may already be mocked.'],
    };
    const results: StoryResult[] = targets.map((target) => ({
      storyId: target.id,
      status: 'complete',
      findings: [{ ...finding, labels: [...finding.labels] }],
      warnings: [],
    }));

    const report = buildReport(targets, results, 'complete', '2026-10-10T00:00:00.000Z');
    expect(report.summary).toMatchObject({ totalStories: 2, completeStories: 2, findings: 1 });
    expect(report.findings[0]).toMatchObject({
      resource: 'https://api.example.test/data?…',
      labels: ['external', 'mocking'],
      affectedStories: targets,
    });
    const exported = JSON.stringify(report);
    expect(exported).not.toContain('private-value');
    expect(exported).not.toContain('fragment');
    expect(exported).not.toContain('url:');
  });

  it('marks cancelled and unvisited stories as incomplete', () => {
    const targets = [
      { id: 'one', name: 'Example / One' },
      { id: 'two', name: 'Example / Two' },
      { id: 'three', name: 'Example / Three' },
    ];
    const results: StoryResult[] = [
      { storyId: 'one', status: 'complete', findings: [], warnings: [] },
      { storyId: 'two', status: 'cancelled', findings: [], warnings: [] },
    ];
    const report = buildReport(targets, results, 'cancelled', '2026-10-10T00:00:00.000Z');

    expect(report.scanStatus).toBe('cancelled');
    expect(report.summary).toMatchObject({ totalStories: 3, scannedStories: 1, completeStories: 1, incompleteStories: 2 });
    expect(report.stories.map((story) => story.status)).toEqual(['complete', 'cancelled', 'not-scanned']);
  });

  it('does not export a malformed resource URL verbatim', () => {
    const report = buildReport([{ id: 'one', name: 'One' }], [{
      storyId: 'one', status: 'complete', warnings: [], findings: [{
        key: 'url:broken?token=private-value', name: 'broken?token=private-value',
        url: 'broken?token=private-value', labels: ['failure'], notes: [],
      }],
    }], 'complete', '2026-10-10T00:00:00.000Z');
    expect(report.findings[0]?.resource).toBe('[unparseable resource URL]');
    expect(JSON.stringify(report)).not.toContain('private-value');
  });
});
