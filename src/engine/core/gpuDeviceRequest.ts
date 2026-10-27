// How the editor asks the browser for a GPU adapter and device: request
// deadlines, superseded requests, and the device descriptor fallbacks.
// WebGPUContext decides which adapter configurations to try and owns the
// resulting device; this module only performs one request at a time.

import { Logger } from '../../services/logger';
import { recordGpuAdapterAttempt } from '../../services/diagnostics/gpuStartupProbe';
import { DEFAULT_GPU_REQUEST_TIMEOUT_MS } from './androidAdapterMemory';

const log = Logger.create('WebGPUContext');

// Cold GPU process startup can exceed two seconds. Keep the original request
// alive until this deadline; a pending request is not a rejected configuration.
const GPU_REQUEST_TIMEOUT_MS = DEFAULT_GPU_REQUEST_TIMEOUT_MS;

export class GPURequestTimeoutError extends Error {
  readonly phase: 'adapter' | 'device';
  constructor(message: string, phase: 'adapter' | 'device') {
    super(message);
    this.phase = phase;
  }
}
/** A newer initialization (loss, destroy, preference change) replaced the one that sent this request. */
export class GPUInitializationCancelledError extends Error {}

export type GPURequestAdapterOptionsWithFeatureLevel = GPURequestAdapterOptions & {
  featureLevel: 'compatibility';
};
/** The context's initialization generation; a request belongs to the generation it started in. */
export type GPURequestGeneration = () => number;

const isTerminalRequestError = (error: unknown) =>
  error instanceof GPURequestTimeoutError || error instanceof GPUInitializationCancelledError;

/**
 * Resolves with the request's result, rejects with a timeout after the deadline,
 * and rejects as superseded when the generation moved on. A result that arrives
 * after either is disposed instead of being leaked.
 */
function withGpuRequestTimeout<T>(
  promise: Promise<T>,
  label: string,
  generation: GPURequestGeneration,
  disposeLateResult?: (result: T) => void,
  timeoutMs: number = GPU_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const startedIn = generation();
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new GPURequestTimeoutError(`${label} timed out after ${timeoutMs}ms`, label.startsWith('requestAdapter') ? 'adapter' : 'device'));
    }, timeoutMs);
    promise.then(result => {
      clearTimeout(timer);
      if (expired || startedIn !== generation()) {
        disposeLateResult?.(result);
        reject(new GPUInitializationCancelledError('GPU initialization was superseded'));
        return;
      }
      resolve(result);
    }, error => {
      clearTimeout(timer);
      reject(startedIn === generation()
        ? error
        : new GPUInitializationCancelledError('GPU initialization was superseded'));
    });
  });
}

/**
 * One adapter configuration; a rejected configuration returns null so the caller can try the next one.
 * `timeoutMs` shortens the deadline (Android devices whose adapter requests stalled before).
 */
export async function requestGpuAdapter(
  options: GPURequestAdapterOptions | GPURequestAdapterOptionsWithFeatureLevel | undefined,
  label: string,
  generation: GPURequestGeneration,
  timeoutMs: number = GPU_REQUEST_TIMEOUT_MS,
): Promise<GPUAdapter | null> {
  const startedAt = performance.now();
  try {
    const request = options ? navigator.gpu.requestAdapter(options) : navigator.gpu.requestAdapter();
    const adapter = await withGpuRequestTimeout(request, label, generation, undefined, timeoutMs);
    recordGpuAdapterAttempt(label, adapter ? 'ok' : 'null', performance.now() - startedAt);
    return adapter;
  } catch (error) {
    if (!(error instanceof GPUInitializationCancelledError)) {
      recordGpuAdapterAttempt(label, error instanceof GPURequestTimeoutError ? 'timeout'
        : `rejected:${error instanceof Error ? error.name : typeof error}`, performance.now() - startedAt);
    }
    // A rejected configuration can recover on another backend/preference.
    // A pending or superseded request must never start another GPU request.
    if (isTerminalRequestError(error)) throw error;
    log.warn(`${label} rejected; trying the remaining adapter configurations`, error);
    return null;
  }
}

function requiredDeviceLimits(adapter: GPUAdapter): GPUDeviceDescriptor['requiredLimits'] {
  return {
    maxTextureDimension2D: Math.min(4096, adapter.limits.maxTextureDimension2D),
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
  };
}

function requiredDeviceFeatures(adapter: GPUAdapter): GPUFeatureName[] {
  // Compatibility adapters stay on reduced validation limits unless this
  // feature is explicitly enabled. Those reduced limits are insufficient for
  // parts of the editor's effect stack on adapters that can actually expose
  // the full core profile.
  const coreFeature = 'core-features-and-limits' as GPUFeatureName;
  const features: GPUFeatureName[] = [];
  if (adapter.features?.has(coreFeature)) features.push(coreFeature);

  // Brush can train against the editor's existing device when subgroups are
  // enabled here. Reusing that device avoids a second adapter/device request,
  // which is particularly unstable on mobile WebKit GPU processes.
  const subgroupFeature = 'subgroups' as GPUFeatureName;
  if (adapter.features?.has(subgroupFeature)) features.push(subgroupFeature);
  if (adapter.features?.has('timestamp-query')) features.push('timestamp-query');
  // The path tracer's OIDN denoiser runs its network in FP16 when available.
  if (adapter.features?.has('shader-f16')) features.push('shader-f16');
  return features;
}

/**
 * The editor's device: full limits and optional features first, then without
 * limits, then a bare device. Null when every rejected-but-not-pending request
 * failed; timeouts and superseded requests throw.
 */
export async function requestEditorDevice(adapter: GPUAdapter, generation: GPURequestGeneration): Promise<GPUDevice | null> {
  log.info('Requesting GPU device...');
  const requiredFeatures = requiredDeviceFeatures(adapter);
  const dispose = (device: GPUDevice) => device.destroy();
  try {
    return await withGpuRequestTimeout(
      adapter.requestDevice({ requiredFeatures, requiredLimits: requiredDeviceLimits(adapter) }),
      'requestDevice (with limits)', generation, dispose,
    );
  } catch (error) {
    if (isTerminalRequestError(error)) throw error;
    log.warn('Device request with limits failed, retrying without limits...', error);
  }

  log.warn('Retrying device request without requiredLimits...');
  try {
    return await withGpuRequestTimeout(adapter.requestDevice({ requiredFeatures }), 'requestDevice (no limits)', generation, dispose);
  } catch (error) {
    if (isTerminalRequestError(error)) throw error;
    log.warn('Device request without limits failed', error);
  }

  // A compatibility-defaulting adapter can advertise the core capability
  // but still reject it on a particular driver. Keep the final bare-device
  // fallback so preview remains available with compatibility limits.
  if (requiredFeatures.length === 0) return null;
  log.warn('Retrying GPU device without optional core features...');
  return withGpuRequestTimeout(adapter.requestDevice(), 'requestDevice (compatibility limits)', generation, dispose);
}
