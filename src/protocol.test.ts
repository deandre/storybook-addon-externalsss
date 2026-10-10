import { describe, expect, it } from 'vitest';
import { MESSAGE_NAMESPACE, MESSAGE_VERSION, isScanMessage, isScanMessageCandidate } from './protocol';

const valid = () => ({
  namespace: MESSAGE_NAMESPACE,
  version: MESSAGE_VERSION,
  type: 'result',
  runId: 'run',
  storyId: 'story',
  status: 'complete',
  observation: {
    resources: [{ url: 'https://example.test/data', initiatorType: 'fetch', startTime: 1 }],
    images: [{ url: 'https://example.test/image', complete: true, naturalWidth: 100 }],
    elementErrors: [{ url: 'https://example.test/missing', tag: 'IMG' }],
    fonts: [{ family: 'Example', weight: '400', style: 'normal', atRender: 'loaded', after: 'loaded' }],
    warnings: [],
  },
});

describe('scan message validation', () => {
  it('accepts a complete preview result', () => {
    expect(isScanMessage(valid())).toBe(true);
  });

  it('recognizes a matching result with invalid fields so the scan can mark it incomplete', () => {
    for (const value of [
      { ...valid(), version: 2 },
      { ...valid(), status: 'cancelled' },
      { ...valid(), observation: { ...valid().observation, resources: [{ url: 42, initiatorType: 'fetch', startTime: 1 }] } },
      { ...valid(), observation: { ...valid().observation, warnings: [42] } },
      { ...valid(), error: { message: 'bad' } },
    ]) {
      expect(isScanMessageCandidate(value, 'run', 'story')).toBe(true);
      expect(isScanMessage(value)).toBe(false);
    }
  });

  it('ignores unrelated messages', () => {
    expect(isScanMessageCandidate({ ...valid(), runId: 'other' }, 'run', 'story')).toBe(false);
    expect(isScanMessageCandidate({ ...valid(), namespace: 'other' }, 'run', 'story')).toBe(false);
  });
});
