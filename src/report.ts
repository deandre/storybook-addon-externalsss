import type { ScanState } from './scan';
import { redactUrl, type Finding, type FindingLabel, type StoryResult } from './model';

export interface ReportTarget {
  id: string;
  name: string;
}

export interface GroupedFinding {
  finding: Finding;
  storyIds: string[];
}

export type { ScanState } from './scan';

export interface IncompleteStory<T extends ReportTarget> {
  target: T;
  result?: StoryResult;
  status: StoryResult['status'] | 'not-scanned';
}

export function orderedStoryResults(targets: ReportTarget[], results: StoryResult[], replacement?: StoryResult): StoryResult[] {
  const byId = new Map(results.map((result) => [result.storyId, result]));
  if (replacement) byId.set(replacement.storyId, replacement);
  return targets.flatMap((target) => {
    const result = byId.get(target.id);
    return result ? [result] : [];
  });
}

export function groupFindings(results: StoryResult[]): GroupedFinding[] {
  const grouped = new Map<string, { finding: Finding; storyIds: Set<string> }>();
  for (const result of results) {
    for (const finding of result.findings) {
      const existing = grouped.get(finding.key);
      if (existing) {
        existing.storyIds.add(result.storyId);
        for (const label of finding.labels) if (!existing.finding.labels.includes(label)) existing.finding.labels.push(label);
        for (const note of finding.notes) if (!existing.finding.notes.includes(note)) existing.finding.notes.push(note);
      } else {
        grouped.set(finding.key, { finding: { ...finding, labels: [...finding.labels], notes: [...finding.notes] }, storyIds: new Set([result.storyId]) });
      }
    }
  }
  return [...grouped.values()]
    .map(({ finding, storyIds }) => ({ finding: { ...finding, labels: [...finding.labels].sort(), notes: [...finding.notes].sort() }, storyIds: [...storyIds] }))
    .sort((a, b) => Number(b.finding.labels.includes('failure')) - Number(a.finding.labels.includes('failure')) || a.finding.name.localeCompare(b.finding.name) || a.finding.key.localeCompare(b.finding.key));
}

function safeResourceName(finding: Finding): string {
  if (!finding.url) return finding.name;
  try {
    new URL(finding.url);
    return redactUrl(finding.url);
  } catch {
    return '[unparseable resource URL]';
  }
}

export function summarizeScan<T extends ReportTarget>(targets: T[], results: StoryResult[], includeUnvisited = true) {
  const groups = groupFindings(orderedStoryResults(targets, results));
  const resultById = new Map(results.map((result) => [result.storyId, result]));
  const labelCounts: Record<FindingLabel, number> = {
    failure: 0, external: 0, 'font-timing': 0, mocking: 0,
  };
  for (const group of groups) for (const label of group.finding.labels) labelCounts[label] += 1;
  const incomplete: IncompleteStory<T>[] = targets.flatMap((target) => {
    const result = resultById.get(target.id);
    if (result?.status === 'complete' || (!result && !includeUnvisited)) return [];
    return [{ target, result, status: result?.status ?? 'not-scanned' }];
  });
  return {
    groups,
    labelCounts,
    incomplete,
    totalStories: targets.length,
    scannedStories: results.filter((result) => result.status !== 'cancelled').length,
    completeStories: results.filter((result) => result.status === 'complete').length,
    incompleteStories: targets.length - results.filter((result) => result.status === 'complete').length,
    findings: groups.length,
  };
}

export function buildReport(targets: ReportTarget[], results: StoryResult[], state: ScanState, generatedAt: string, catalog?: { refId: string; title: string; url: string }) {
  const resultById = new Map(results.map((result) => [result.storyId, result]));
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const { groups, incomplete: _incomplete, ...summary } = summarizeScan(targets, results);

  return {
    schemaVersion: 1,
    generatedAt,
    ...(catalog ? { catalog: { ...catalog, url: new URL(catalog.url).origin + new URL(catalog.url).pathname } } : {}),
    scanStatus: state,
    summary,
    stories: targets.map((target) => {
      const result = resultById.get(target.id);
      return {
        id: target.id,
        name: target.name,
        status: result?.status ?? 'not-scanned',
        ...(result ? { warnings: result.warnings } : {}),
        ...(result?.error !== undefined ? { error: result.error } : {}),
      };
    }),
    findings: groups.map(({ finding, storyIds }) => ({
      resource: safeResourceName(finding),
      labels: finding.labels,
      notes: finding.notes,
      affectedStories: storyIds.map((id) => ({ id, name: targetById.get(id)?.name ?? id })),
    })),
  };
}
