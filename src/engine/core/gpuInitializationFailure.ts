export type GPUInitializationFailure =
  | 'unsupported'
  | 'adapter_unavailable'
  | 'adapter_timeout'
  | 'device_timeout'
  | 'device_failed'
  | 'initialization_failed';

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
    default:
      return 'The preview renderer could not be initialized. Save your work if possible, then reload the editor.';
  }
}
