export type GPUInitializationFailure =
  | 'unsupported'
  | 'adapter_unavailable'
  | 'adapter_timeout'
  | 'device_timeout'
  | 'device_failed'
  | 'initialization_failed'
  | 'device_lost_repeatedly';

/** Product copy for a known failure, never inferred from navigator.gpu alone. */
export function describeGPUInitializationFailure(failure: GPUInitializationFailure | null): string {
  switch (failure) {
    case 'unsupported':
      return 'WebGPU is unavailable in this browser environment.';
    case 'adapter_unavailable':
      return 'The browser could not provide a compatible GPU. Check hardware acceleration and your graphics driver.';
    case 'adapter_timeout':
      return 'The graphics driver did not respond in time while selecting a GPU. Save your work if possible, then restart the browser and try again.';
    case 'device_timeout':
      return 'The graphics driver did not respond in time while starting the GPU. Save your work if possible, then restart the browser and try again.';
    case 'device_failed':
      return 'A GPU was found, but the browser could not start it. Check your graphics driver and restart the browser.';
    case 'device_lost_repeatedly':
      return 'The graphics driver reset the GPU several times in a row, so the preview stopped retrying. Save your work, then reload the editor; if it happens again, update the graphics driver or remove the most recently added GPU-heavy effect.';
    default:
      return 'The preview renderer could not be initialized. Save your work if possible, then reload the editor.';
  }
}

/**
 * Product copy when recovery after a device loss gives up. The GPU worked
 * earlier in this session, so setup advice would mislead; a reload restores it.
 */
export function describeGPURecoveryFailure(failure: GPUInitializationFailure | null): string {
  switch (failure) {
    case 'adapter_timeout':
    case 'device_timeout':
    case 'device_lost_repeatedly':
      return describeGPUInitializationFailure(failure);
    default:
      return 'The GPU stopped responding and the browser did not provide a new one, so the preview is paused. Save your work, then reload the editor to restore the GPU; if it stays unavailable, restart the browser.';
  }
}
