import { describe, expect, it } from 'vitest';
import {
  bridgeMessage,
  isBridgeEnvelope,
  isRemoteRunningSession,
  trustedOrigins,
  isScanEvent,
} from './bridge-protocol';
import { managerHead } from './preset';
import { buildReport } from './report';

const target = {
  id: 'button--default',
  name: 'Button / Default',
  previewHref: 'https://remote.test/catalog/iframe.html?id=button--default',
  managerHref: 'https://remote.test/catalog/?path=/story/button--default',
};
const session = {
  phase: 'running',
  retrying: false,
  progress: { completed: 0, total: 1, active: 0 },
  targets: [target],
  results: [{ storyId: target.id, status: 'complete', warnings: [], findings: [] }],
};

describe('composed bridge', () => {
  it('requires exact HTTP(S) origins with no wildcard, credentials, path, query or fragment', () => {
    expect(trustedOrigins(undefined)).toEqual([]);
    expect(trustedOrigins(['https://host.test', 'http://localhost:6006'])).toHaveLength(2);
    for (const origin of [
      '*',
      'https://*.host.test',
      'null',
      'https://host.test/',
      'https://host.test/path',
      'https://host.test?token=secret',
      'https://host.test#x',
      'https://user:pass@host.test',
      'file://local',
      'data:text/html,hi',
    ]) {
      expect(() => trustedOrigins([origin])).toThrow();
    }
    expect(() => trustedOrigins('https://host.test')).toThrow();
  });
  it('embeds deny-by-default configuration without re-registering entries', () => {
    expect(managerHead('<meta>')).toContain(
      '<meta><script id="externalsss-trusted-origins" type="application/json">[]</script>',
    );
    expect(managerHead('', { trustedManagerOrigins: ['https://host.test'] })).toContain('["https://host.test"]');
    expect(() => managerHead('', { trustedManagerOrigins: ['*'] })).toThrow();
  });
  it('rejects unrelated sessions and namespaces', () => {
    const message = bridgeMessage('one', 'attempt', 'start');
    expect(isBridgeEnvelope(message, 'one')).toBe(true);
    expect(isBridgeEnvelope(message, 'two')).toBe(false);
    expect(isBridgeEnvelope({ ...message, namespace: 'other' }, 'one')).toBe(false);
    expect(isBridgeEnvelope(null, 'one')).toBe(false);
  });
  it('validates source URLs, story identities, diagnostics and progress', () => {
    expect(isRemoteRunningSession(session, 'https://remote.test')).toBe(true);
    expect(isRemoteRunningSession(session, 'https://other.test')).toBe(false);
    expect(isRemoteRunningSession({ ...session, targets: [target, target] }, 'https://remote.test')).toBe(false);
    expect(
      isRemoteRunningSession(
        { ...session, targets: [{ ...target, managerHref: 'javascript:alert(1)' }] },
        'https://remote.test',
      ),
    ).toBe(false);
    expect(
      isRemoteRunningSession(
        { ...session, results: [{ ...session.results[0], storyId: 'unknown' }] },
        'https://remote.test',
      ),
    ).toBe(false);
    expect(
      isRemoteRunningSession(
        { ...session, results: [{ ...session.results[0], warnings: [42] }] },
        'https://remote.test',
      ),
    ).toBe(false);
    const running = { ...session, phase: 'running', retrying: false, progress: { completed: 0, total: 1, active: 0 } };
    expect(isRemoteRunningSession(running, 'https://remote.test')).toBe(true);
    expect(isRemoteRunningSession({ ...running, progress: { completed: 2, total: 1, active: 0 } }, 'https://remote.test')).toBe(
      false,
    );
    expect(
      isRemoteRunningSession(
        {
          ...session,
          results: [{ ...session.results[0], findings: [{ key: 'one', name: 'one', labels: ['unknown'], notes: [] }] }],
        },
        'https://remote.test',
      ),
    ).toBe(false);
  });
  it('records source provenance without query values, fragments or URL credentials', () => {
    const report = buildReport([target], [], 'cancelled', 'now', {
      refId: 'remote',
      title: 'Remote',
      url: 'https://user:secret@remote.test/catalog/?token=private#fragment',
    });
    expect(report.catalog).toEqual({ refId: 'remote', title: 'Remote', url: 'https://remote.test/catalog/' });
    expect(JSON.stringify(report)).not.toMatch(/secret|private|fragment/);
    expect(buildReport([target], [], 'cancelled', 'now')).not.toHaveProperty('catalog');
  });
});

describe('strict bridge enums', () => {
  it('rejects finished snapshots, coercible phases and result statuses', () => {
    expect(isRemoteRunningSession({ ...session, phase: 'finished', outcome: 'complete' }, 'https://remote.test')).toBe(
      false,
    );
    expect(isScanEvent({ type: 'finished', outcome: ['complete'], unresolved: [] }, 'https://remote.test')).toBe(false);
    expect(isScanEvent({ type: 'finished', outcome: 'complete', unresolved: [] }, 'https://remote.test')).toBe(true);
    expect(
      isRemoteRunningSession(
        { ...session, phase: ['running'], retrying: false, progress: { completed: 0, total: 1, active: 0 } },
        'https://remote.test',
      ),
    ).toBe(false);
    expect(
      isRemoteRunningSession(
        { ...session, results: [{ ...session.results[0], status: ['complete'] }] },
        'https://remote.test',
      ),
    ).toBe(false);
    expect(isRemoteRunningSession({ ...session, retrying: 'yes' }, 'https://remote.test')).toBe(false);
  });
});

describe('lifecycle payload validation', () => {
  it('rejects nonfinite, fractional and mistyped progress', () => {
    for (const progress of [
      { completed: NaN, total: 1 },
      { completed: 0, total: Infinity },
      { completed: 0.5, total: 1 },
      { completed: 0, total: -1 },
      { completed: '0', total: 1 },
      { completed: 0, total: 1, current: [] },
    ])
      expect(isScanEvent({ type: 'progress', progress: { active: 0, ...progress } }, 'https://remote.test')).toBe(false);
  });
  it('validates every discriminated payload without coercion', () => {
    for (const event of [
      { type: ['preparing'] },
      { type: 'unknown' },
      { type: 'finished', outcome: ['complete'], unresolved: [] },
      { type: 'finished', outcome: 'error', error: {}, unresolved: [] },
      {
        type: 'finished',
        outcome: 'cancelled',
        unresolved: [{ storyId: target.id, result: { ...session.results[0], storyId: 'other' } }],
      },
      {
        type: 'started',
        session: { ...session, phase: 'running', retrying: 'yes', progress: { completed: 0, total: 1, active: 0 } },
        pendingStoryIds: [target.id],
      },
    ])
      expect(isScanEvent(event, 'https://remote.test')).toBe(false);
  });
});

it('validates active slots against bounds and remaining work', () => {
  for (const active of [undefined, NaN, Infinity, -1, 1.5, '2', 5])
    expect(isScanEvent({ type: 'progress', progress: { completed: 0, total: 10, active } }, 'https://remote.test')).toBe(false);
  expect(isScanEvent({ type: 'progress', progress: { completed: 1, total: 2, active: 2 } }, 'https://remote.test')).toBe(false);
  expect(isScanEvent({ type: 'progress', progress: { completed: 1, total: 5, active: 4 } }, 'https://remote.test')).toBe(true);
});
