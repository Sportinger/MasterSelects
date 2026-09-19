// WebGPUContext lifecycle wiring for WebGPUEngine (extracted, packet 345).
// Registers the device-lost / device-restored / power-preference-fallback
// callbacks in exactly the order and shape the engine constructor used inline.

import { Logger } from '../../services/logger';
import { useEngineStore } from '../../stores/engineStore';
import { describeGPUInitializationFailure } from '../core/gpuInitializationFailure';
import { useSettingsStore } from '../../stores/settingsStore';
import type { WebGPUContext } from '../core/WebGPUContext';

const log = Logger.create('WebGPUEngine');

export interface ContextRecoveryHandlers {
  setRecovering(recovering: boolean): void;
  handleDeviceLost(): void;
  handleDeviceRestored(): Promise<void>;
}

export function wireContextRecovery(context: WebGPUContext, handlers: ContextRecoveryHandlers): void {
  // Device recovery handlers
  context.onDeviceLost((reason) => {
    log.warn('Device lost', { reason });
    handlers.setRecovering(true);
    useEngineStore.getState().setEngineReady(false);
    useEngineStore.getState().setEngineInitFailed(false);
    handlers.handleDeviceLost();
  });

  context.onDeviceRestored(async () => {
    log.info('Device restored');
    const restoredDevice = context.getDevice();
    await handlers.handleDeviceRestored();
    if (!context.initialized || context.getDevice() !== restoredDevice) return;
    handlers.setRecovering(false);
    useEngineStore.getState().setEngineReady(true);
    useEngineStore.getState().setEngineInitFailed(false);
  });

  context.onRecoveryFailed((failure) => {
    handlers.setRecovering(false);
    useEngineStore.getState().setEngineReady(false);
    useEngineStore.getState().setEngineInitFailed(true, describeGPUInitializationFailure(failure));
  });

  context.onPowerPreferenceFallback((preference) => {
    try {
      useSettingsStore.getState().setGpuPowerPreference(preference);
      log.info('Persisted GPU power preference fallback', { preference });
    } catch (e) {
      log.error('Failed to persist GPU power preference fallback', e);
    }
  });
}
