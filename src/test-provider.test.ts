import { afterEach, describe, expect, it, vi } from 'vitest';
const stores = vi.hoisted(() => ({
  stopSelect: vi.fn(), stopRun: vi.fn(), stopClear: vi.fn(),
  select: vi.fn(), add: vi.fn(),
}));
vi.mock('storybook/manager-api', () => ({
  types: { experimental_TEST_PROVIDER: 'test-provider' },
  addons: { add: stores.add },
  experimental_getTestProviderStore: () => ({
    getState: vi.fn(), setState: vi.fn(),
    onRunAll: () => stores.stopRun, onClearAll: () => stores.stopClear,
  }),
  experimental_getStatusStore: () => ({
    set: vi.fn(), unset: vi.fn(), onSelect: (listener: () => void) => { stores.select(listener); return stores.stopSelect; },
  }),
}));
import { registerTestProvider } from './test-provider';
import { createScanController } from './scan-controller';
import type { API } from 'storybook/manager-api';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('test provider registration lifecycle', () => {
  it('disposes status selection and provider subscriptions exactly once', () => {
    vi.stubGlobal('CONFIG_TYPE', 'DEVELOPMENT');
    const open = vi.fn();
    const dispose = registerTestProvider({} as API, createScanController(() => [], vi.fn()), open);
    expect(stores.select).toHaveBeenCalledWith(open); expect(stores.add).toHaveBeenCalledOnce();
    dispose!(); dispose!();
    for (const stop of [stores.stopSelect, stores.stopRun, stores.stopClear]) expect(stop).toHaveBeenCalledOnce();
  });
  it('keeps static Storybooks on panel scanning without a provider', () => {
    vi.stubGlobal('CONFIG_TYPE', 'PRODUCTION');
    expect(registerTestProvider({} as API, createScanController(() => [], vi.fn()), vi.fn())).toBeUndefined();
    expect(stores.add).not.toHaveBeenCalled();
  });
});
