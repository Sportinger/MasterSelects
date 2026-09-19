import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wireContextRecovery } from '../../src/engine/engineCore/contextRecoveryWiring';
import type { WebGPUContext } from '../../src/engine/core/WebGPUContext';
import { describeGPUInitializationFailure } from '../../src/engine/core/gpuInitializationFailure';

const store = vi.hoisted(() => ({ setEngineReady: vi.fn(), setEngineInitFailed: vi.fn() }));
vi.mock('../../src/stores/engineStore', () => ({ useEngineStore: { getState: () => store } }));
vi.mock('../../src/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ setGpuPowerPreference: vi.fn() }) } }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) } }));

beforeEach(() => vi.clearAllMocks());

function setup() {
  const callbacks: Record<string, (...args: any[]) => any> = {};
  const device = {};
  const context = {
    initialized: true,
    getDevice: () => device,
    onDeviceLost: (cb: typeof callbacks[string]) => { callbacks.lost = cb; },
    onDeviceRestored: (cb: typeof callbacks[string]) => { callbacks.restored = cb; },
    onRecoveryFailed: (cb: typeof callbacks[string]) => { callbacks.failed = cb; },
    onPowerPreferenceFallback: vi.fn(),
  };
  const handlers = {
    setRecovering: vi.fn(), handleDeviceLost: vi.fn(), handleDeviceRestored: vi.fn(async () => {}),
  };
  wireContextRecovery(context as unknown as WebGPUContext, handlers);
  return { context, handlers, callbacks };
}

describe('engine recovery UI state', () => {
  it('keeps the preview unavailable until restored resources are ready', async () => {
    const { handlers, callbacks } = setup();
    callbacks.lost('driver reset');
    expect(store.setEngineReady).toHaveBeenLastCalledWith(false);
    let finish!: () => void;
    handlers.handleDeviceRestored.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const restoring = callbacks.restored();
    expect(store.setEngineReady).not.toHaveBeenCalledWith(true);
    finish();
    await restoring;
    expect(store.setEngineReady).toHaveBeenLastCalledWith(true);
    expect(handlers.setRecovering).toHaveBeenLastCalledWith(false);
  });

  it('does not announce readiness after another loss during resource restoration', async () => {
    const { context, handlers, callbacks } = setup();
    let finish!: () => void;
    handlers.handleDeviceRestored.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const restoring = callbacks.restored();
    context.initialized = false;
    callbacks.lost('second driver reset');
    finish();
    await restoring;
    expect(store.setEngineReady).not.toHaveBeenCalledWith(true);
  });

  it('replaces the spinner with an accurate terminal timeout message', () => {
    const { callbacks, handlers } = setup();
    callbacks.failed('adapter_timeout');
    expect(handlers.setRecovering).toHaveBeenLastCalledWith(false);
    expect(store.setEngineReady).toHaveBeenLastCalledWith(false);
    expect(store.setEngineInitFailed).toHaveBeenLastCalledWith(true, expect.stringContaining('did not respond in time'));
    expect(describeGPUInitializationFailure('adapter_timeout')).not.toContain('compatible GPU');
    expect(describeGPUInitializationFailure('device_failed')).toContain('A GPU was found');
  });
});
