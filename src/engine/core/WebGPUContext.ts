// WebGPU device, adapter, and queue initialization

import { Logger } from '../../services/logger';
import { attachWebGPUDeviceDiagnostics, markExpectedWebGPUDeviceDestruction } from '../../services/runtimeDiagnostics';
import type { GPUInitializationFailure } from './gpuInitializationFailure';

const log = Logger.create('WebGPUContext');

// Cold GPU process startup can exceed two seconds. Keep the original request
// alive until this deadline; a pending request is not a rejected configuration.
const GPU_REQUEST_TIMEOUT_MS = 15_000;

class GPURequestTimeoutError extends Error {
  readonly phase: 'adapter' | 'device';
  constructor(message: string, phase: 'adapter' | 'device') {
    super(message);
    this.phase = phase;
  }
}
class GPUInitializationCancelledError extends Error {}

export type DeviceLostCallback = (reason: string) => void;
export type DeviceRestoredCallback = () => void | Promise<void>;
export type GPUPowerPreference = 'high-performance' | 'low-power';

interface GPUAdapterInfoLike {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

type GPUAdapterWithInfo = GPUAdapter & { info?: GPUAdapterInfoLike };
type GPUDeviceWithAdapterInfo = GPUDevice & { adapterInfo?: GPUAdapterInfoLike };
type GPURequestAdapterOptionsWithFeatureLevel = GPURequestAdapterOptions & {
  featureLevel: 'compatibility';
};

export class WebGPUContext {
  private device: GPUDevice | null = null;
  private adapter: GPUAdapter | null = null;
  private initPromise: Promise<boolean> | null = null;
  private isInitialized = false;
  private initializationFailure: GPUInitializationFailure | null = null;
  private recoveryFailedCallbacks = new Set<(failure: GPUInitializationFailure | null) => void>();
  private initializationGeneration = 0;
  private currentPowerPreference: GPUPowerPreference = 'high-performance';

  // Callbacks for device loss/restore events
  private deviceLostCallbacks: Set<DeviceLostCallback> = new Set();
  private deviceRestoredCallbacks: Set<DeviceRestoredCallback> = new Set();

  // Track if we're recovering from a device loss
  private isRecovering = false;

  // Track recovery attempts to prevent infinite loops
  private recoveryAttempts = 0;
  private static readonly MAX_RECOVERY_ATTEMPTS = 3;

  // Linux hybrid-GPU recovery: after an unexpected dGPU failure, try the
  // integrated/display GPU once and keep that choice for future initializations.
  private hasTriedLowPowerFallback = false;
  private powerPreferenceFallbackCallbacks: Set<(preference: GPUPowerPreference) => void> = new Set();

  async initialize(powerPreference?: GPUPowerPreference): Promise<boolean> {
    // Store the preference if provided
    if (powerPreference) {
      this.currentPowerPreference = powerPreference;
    }
    // Prevent multiple initializations with promise-based lock
    if (this.isInitialized && this.device) {
      log.debug('Already initialized, skipping');
      return true;
    }

    // If initialization is in progress, wait for it
    if (this.initPromise) {
      log.debug('Initialization in progress, waiting...');
      return this.initPromise;
    }

    this.initializationFailure = null;
    if (!navigator.gpu) {
      this.initializationFailure = 'unsupported';
      log.error('WebGPU not supported');
      return false;
    }

    const initialization = this.doInitialize();
    this.initPromise = initialization;
    try {
      return await initialization;
    } finally {
      // A failed attempt must not permanently hold the initialization lock.
      if (this.initPromise === initialization) this.initPromise = null;
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    label: string,
    disposeLateResult?: (result: T) => void,
  ): Promise<T> {
    const generation = this.initializationGeneration;
    return new Promise<T>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new GPURequestTimeoutError(`${label} timed out after ${GPU_REQUEST_TIMEOUT_MS}ms`, label.startsWith('requestAdapter') ? 'adapter' : 'device'));
      }, GPU_REQUEST_TIMEOUT_MS);
      promise.then(result => {
        clearTimeout(timer);
        if (expired || generation !== this.initializationGeneration) {
          disposeLateResult?.(result);
          reject(new GPUInitializationCancelledError('GPU initialization was superseded'));
          return;
        }
        resolve(result);
      }, error => {
        clearTimeout(timer);
        reject(generation === this.initializationGeneration
          ? error
          : new GPUInitializationCancelledError('GPU initialization was superseded'));
      });
    });
  }

  private shouldUseLowPowerFallback(): boolean {
    const navigatorWithUserAgentData = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform = navigatorWithUserAgentData.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
    return /linux/i.test(platform) && !/android/i.test(navigator.userAgent || '');
  }

  private isAndroidRuntime(): boolean {
    const navigatorWithUserAgentData = navigator as Navigator & {
      userAgentData?: { platform?: string };
    };
    const platform = navigatorWithUserAgentData.userAgentData?.platform || navigator.platform || '';
    return /android/i.test(`${platform} ${navigator.userAgent || ''}`);
  }

  private async requestAdapter(
    options: GPURequestAdapterOptions | GPURequestAdapterOptionsWithFeatureLevel | undefined,
    label: string,
  ): Promise<GPUAdapter | null> {
    try {
      const request = options ? navigator.gpu.requestAdapter(options) : navigator.gpu.requestAdapter();
      return await this.withTimeout(request, label);
    } catch (error) {
      // A rejected configuration can recover on another backend/preference.
      // A pending or superseded request must never start another GPU request.
      if (error instanceof GPURequestTimeoutError || error instanceof GPUInitializationCancelledError) throw error;
      log.warn(`${label} rejected; trying the remaining adapter configurations`, error);
      return null;
    }
  }

  private async doInitialize(): Promise<boolean> {
    try {
      const isAndroid = this.isAndroidRuntime();

      if (isAndroid) {
        // Android devices do not benefit from desktop-style GPU power selection.
        // More importantly, some Chrome/driver combinations leave a
        // powerPreference request pending and then serialize every later adapter
        // request behind it. Ask for the normal adapter first so devices which
        // previously worked keep their full WebGPU feature level.
        log.info('Android detected; requesting adapter without powerPreference');
        this.adapter = await this.requestAdapter(
          undefined,
          'requestAdapter (Android core)',
        );
      } else {
        // Try with power preference first, then fallback without it.
        // Safari on single-GPU Macs can fail with 'high-performance'.
        log.info(`Requesting adapter with powerPreference: ${this.currentPowerPreference}`);
        this.adapter = await this.requestAdapter(
          { powerPreference: this.currentPowerPreference },
          'requestAdapter (with powerPreference)',
        );
      }

      // Fallback 1: on Linux hybrid-GPU systems, the requested dGPU can be
      // unavailable/wedged while the compositor's display GPU still works.
      if (!this.adapter && this.currentPowerPreference === 'high-performance' && this.shouldUseLowPowerFallback()) {
        log.warn('high-performance adapter unavailable on Linux, trying low-power (integrated/display) GPU...');
        const lowPowerAdapter = await this.requestAdapter(
          { powerPreference: 'low-power' },
          'requestAdapter (low-power fallback)',
        );
        if (lowPowerAdapter) {
          this.adapter = lowPowerAdapter;
          this.currentPowerPreference = 'low-power';
          this.hasTriedLowPowerFallback = true;
          log.warn('Using integrated/display GPU (low-power) and persisting for future loads');
          this.notifyPowerPreferenceFallback('low-power');
        }
      }

      // Fallback 2: try without powerPreference on desktop browsers.
      if (!this.adapter && !isAndroid) {
        log.warn('First adapter request failed, retrying without powerPreference...');
        this.adapter = await this.requestAdapter(
          undefined,
          'requestAdapter (no preference)',
        );
      }

      // Chrome's WebGPU compatibility mode can use an OpenGL ES 3.1 backend on
      // Android hardware where the stricter core/Vulkan adapter is unavailable.
      // Older Chrome versions ignore the unknown dictionary member, so this is
      // also a safe final retry there.
      if (!this.adapter && isAndroid) {
        log.warn('Android core adapter unavailable, trying WebGPU compatibility mode...');
        const compatibilityOptions: GPURequestAdapterOptionsWithFeatureLevel = {
          featureLevel: 'compatibility',
        };
        this.adapter = await this.requestAdapter(
          compatibilityOptions,
          'requestAdapter (Android compatibility)',
        );
        if (this.adapter) {
          log.warn('Using WebGPU compatibility mode on Android');
        }
      }

      if (!this.adapter) {
        this.initializationFailure = 'adapter_unavailable';
        log.error('Failed to get GPU adapter (all attempts)');
        return false;
      }
      log.info('Adapter obtained');
      log.info('Adapter limits', {
        maxTextureDimension2D: this.adapter.limits.maxTextureDimension2D,
        maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: this.adapter.limits.maxBufferSize,
      });

      // Request device — try with limits, fallback without
      log.info('Requesting GPU device...');
      const requiredFeatures = this.buildRequiredFeatures(this.adapter);
      try {
        const requiredLimits = this.buildRequiredLimits(this.adapter);
        this.device = await this.withTimeout(
          this.adapter.requestDevice({
            requiredFeatures,
            requiredLimits,
          }),
          'requestDevice (with limits)',
          device => device.destroy(),
        );
      } catch (e) {
        if (e instanceof GPURequestTimeoutError || e instanceof GPUInitializationCancelledError) throw e;
        log.warn('Device request with limits failed, retrying without limits...', e);
        this.device = null;
      }

      // Fallback: no required limits
      if (!this.device) {
        log.warn('Retrying device request without requiredLimits...');
        try {
          this.device = await this.withTimeout(
            this.adapter.requestDevice({ requiredFeatures }),
            'requestDevice (no limits)',
            device => device.destroy(),
          );
        } catch (error) {
          if (error instanceof GPURequestTimeoutError || error instanceof GPUInitializationCancelledError) throw error;
          log.warn('Device request without limits failed', error);
          this.device = null;
        }
      }

      // A compatibility-defaulting adapter can advertise the core capability
      // but still reject it on a particular driver. Keep the final bare-device
      // fallback so preview remains available with compatibility limits.
      if (!this.device && requiredFeatures.length > 0) {
        log.warn('Retrying GPU device without optional core features...');
        this.device = await this.withTimeout(
          this.adapter.requestDevice(),
          'requestDevice (compatibility limits)',
          device => device.destroy(),
        );
      }

      if (!this.device) {
        this.initializationFailure = 'device_failed';
        log.error('Failed to create GPU device');
        return false;
      }
      log.info('GPU device created successfully');
      attachWebGPUDeviceDiagnostics(this.device, 'WebGPUContext');

      const initializedDevice = this.device;
      const generation = this.initializationGeneration;
      this.device.lost.then((info) => {
        if (this.device !== initializedDevice || generation !== this.initializationGeneration) return;
        const recoveryGeneration = ++this.initializationGeneration;
        log.error('Device lost', info.message);
        this.isInitialized = false;

        // Notify listeners about device loss BEFORE attempting recovery
        for (const callback of this.deviceLostCallbacks) {
          try {
            callback(info.message);
          } catch (e) {
            log.error('Error in device lost callback', e);
          }
        }

        // Loss listeners need the old device to release their caches. Once they
        // finish, never expose or reuse that lost device during a retry.
        this.device = null;
        this.adapter = null;
        this.initPromise = null;
        if (info.reason !== 'destroyed') {
          if (this.currentPowerPreference === 'high-performance' &&
              !this.hasTriedLowPowerFallback && this.shouldUseLowPowerFallback()) {
            this.hasTriedLowPowerFallback = true;
            this.currentPowerPreference = 'low-power';
            this.notifyPowerPreferenceFallback('low-power');
          }
          this.isRecovering = true;
          this.recoveryAttempts = 0;
          void this.recoverDevice(recoveryGeneration);
        } else {
          this.finishRecoveryFailure();
        }
      });

      // Log detailed GPU adapter info to help debug iGPU vs dGPU selection
      const adapterInfo =
        (this.adapter as GPUAdapterWithInfo).info ||
        (this.device as GPUDeviceWithAdapterInfo).adapterInfo;
      if (adapterInfo) {
        const isIntegrated = adapterInfo.description?.toLowerCase().includes('intel') ||
                            adapterInfo.description?.toLowerCase().includes('integrated') ||
                            adapterInfo.vendor?.toLowerCase().includes('intel');
        const gpuType = isIntegrated ? 'INTEGRATED' : 'DISCRETE';
        log.info(`${gpuType} GPU detected`);
        log.info('GPU Info', {
          vendor: adapterInfo.vendor || 'unknown',
          architecture: adapterInfo.architecture || 'unknown',
          device: adapterInfo.device || 'unknown',
          description: adapterInfo.description || 'unknown',
          powerPreference: this.currentPowerPreference,
        });
        if (isIntegrated && this.currentPowerPreference === 'high-performance') {
          log.warn('high-performance was requested but integrated GPU was selected! To fix: Open Windows Graphics Settings > Add Chrome/Edge > Options > High Performance');
        }
      }

      // Log preferred canvas format - critical for Linux/Vulkan debugging
      const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      log.info(`Preferred canvas format: ${preferredFormat}`);

      this.isInitialized = true;
      log.info('Context initialized successfully');
      return true;
    } catch (error) {
      if (error instanceof GPUInitializationCancelledError) return false;
      this.initializationFailure = error instanceof GPURequestTimeoutError
        ? (error.phase === 'adapter' ? 'adapter_timeout' : 'device_timeout')
        : 'initialization_failed';
      log.error('Failed to initialize WebGPU', error);
      return false;
    }
  }

  getInitializationFailure(): GPUInitializationFailure | null {
    return this.initializationFailure;
  }

  onRecoveryFailed(callback: (failure: GPUInitializationFailure | null) => void): void {
    this.recoveryFailedCallbacks.add(callback);
  }

  private finishRecoveryFailure(): void {
    this.isRecovering = false;
    for (const callback of this.recoveryFailedCallbacks) {
      try { callback(this.initializationFailure); }
      catch (error) { log.error('Error in recovery failure callback', error); }
    }
  }

  private async recoverDevice(generation: number): Promise<void> {
    while (this.recoveryAttempts < WebGPUContext.MAX_RECOVERY_ATTEMPTS) {
      await new Promise<void>(resolve => setTimeout(resolve, 100 * (this.recoveryAttempts + 1)));
      if (generation !== this.initializationGeneration) return;
      this.recoveryAttempts++;
      const success = await this.initialize();
      if (generation !== this.initializationGeneration) return;
      if (success) {
        try {
          for (const callback of this.deviceRestoredCallbacks) {
            await callback();
            if (generation !== this.initializationGeneration) return;
          }
          if (generation !== this.initializationGeneration) return;
          this.isRecovering = false;
          this.recoveryAttempts = 0;
          return;
        } catch (error) {
          if (generation !== this.initializationGeneration) return;
          this.initializationFailure = 'initialization_failed';
          log.error('Failed to restore engine resources', error);
          break;
        }
      }
      // An expired request is still running in the browser GPU process.
      // Do not queue more requests behind it; report a terminal, actionable error.
      if (this.initializationFailure === 'adapter_timeout' ||
          this.initializationFailure === 'device_timeout' ||
          this.initializationFailure === 'unsupported') break;
    }
    log.error('GPU recovery failed', { attempts: this.recoveryAttempts, failure: this.initializationFailure });
    this.finishRecoveryFailure();
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }

  getAdapter(): GPUAdapter | null {
    return this.adapter;
  }

  private buildRequiredLimits(adapter: GPUAdapter): GPUDeviceDescriptor['requiredLimits'] {
    return {
      maxTextureDimension2D: Math.min(4096, adapter.limits.maxTextureDimension2D),
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    };
  }

  private buildRequiredFeatures(adapter: GPUAdapter): GPUFeatureName[] {
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
    return features;
  }

  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get GPU info (vendor, device name, etc.)
   */
  getGPUInfo(): { vendor: string; device: string; description: string } | null {
    if (!this.adapter) return null;

    // adapter.info is available in Chrome 114+
    const info = (this.adapter as GPUAdapterWithInfo).info;
    if (info) {
      return {
        vendor: info.vendor || 'Unknown',
        device: info.device || '',
        description: info.description || '',
      };
    }
    return null;
  }

  // Get the preferred canvas format for this GPU
  getPreferredCanvasFormat(): GPUTextureFormat {
    return navigator.gpu.getPreferredCanvasFormat();
  }

  // Create and configure a canvas context
  configureCanvas(canvas: HTMLCanvasElement): GPUCanvasContext | null {
    if (!this.device) return null;

    const context = canvas.getContext('webgpu');
    if (context) {
      // Use the GPU's preferred format to avoid extra copies
      const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      context.configure({
        device: this.device,
        format: preferredFormat,
        alphaMode: 'opaque',
      });
      log.debug(`Canvas configured with preferred format: ${preferredFormat}`);
    }
    return context;
  }

  // Create a sampler with standard settings
  createSampler(): GPUSampler | null {
    if (!this.device) return null;
    return this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  // Create a uniform buffer
  createUniformBuffer(size: number): GPUBuffer | null {
    if (!this.device) return null;
    return this.device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // Create a single-pixel texture with a solid color
  createSolidColorTexture(r: number, g: number, b: number, a: number): GPUTexture | null {
    if (!this.device) return null;

    const texture = this.device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    this.device.queue.writeTexture(
      { texture },
      new Uint8Array([r, g, b, a]),
      { bytesPerRow: 4 },
      [1, 1]
    );

    return texture;
  }

  /**
   * Register a callback to be notified when the device is lost
   */
  onDeviceLost(callback: DeviceLostCallback): void {
    this.deviceLostCallbacks.add(callback);
  }

  /**
   * Remove a device lost callback
   */
  offDeviceLost(callback: DeviceLostCallback): void {
    this.deviceLostCallbacks.delete(callback);
  }

  /**
   * Register a callback to be notified when the device is restored after loss
   */
  onDeviceRestored(callback: DeviceRestoredCallback): void {
    this.deviceRestoredCallbacks.add(callback);
  }

  /**
   * Remove a device restored callback
   */
  offDeviceRestored(callback: DeviceRestoredCallback): void {
    this.deviceRestoredCallbacks.delete(callback);
  }

  /**
   * Register a callback fired when the context automatically falls back to a
   * different power preference after Linux GPU initialization/recovery issues.
   */
  onPowerPreferenceFallback(callback: (preference: GPUPowerPreference) => void): void {
    this.powerPreferenceFallbackCallbacks.add(callback);
  }

  /**
   * Remove a power preference fallback callback
   */
  offPowerPreferenceFallback(callback: (preference: GPUPowerPreference) => void): void {
    this.powerPreferenceFallbackCallbacks.delete(callback);
  }

  private notifyPowerPreferenceFallback(preference: GPUPowerPreference): void {
    for (const callback of this.powerPreferenceFallbackCallbacks) {
      try {
        callback(preference);
      } catch (e) {
        log.error('Error in power preference fallback callback', e);
      }
    }
  }

  /**
   * Check if the context is currently recovering from a device loss
   */
  get recovering(): boolean {
    return this.isRecovering;
  }

  /**
   * Get the current power preference
   */
  getPowerPreference(): GPUPowerPreference {
    return this.currentPowerPreference;
  }

  /**
   * Reinitialize with a new power preference
   * This destroys the current device and creates a new one
   */
  async reinitializeWithPreference(preference: GPUPowerPreference): Promise<boolean> {
    log.info(`Reinitializing with powerPreference: ${preference}`);

    // Skip if preference hasn't changed
    if (preference === this.currentPowerPreference && this.isInitialized) {
      log.debug('Power preference unchanged, skipping reinit');
      return true;
    }

    // Destroy current device and invalidate pending initialization/recovery.
    this.initializationGeneration++;
    markExpectedWebGPUDeviceDestruction(this.device);
    this.device?.destroy();
    this.device = null;
    this.adapter = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.hasTriedLowPowerFallback = false;
    this.isRecovering = false;
    this.recoveryAttempts = 0;

    // Store new preference
    this.currentPowerPreference = preference;

    // Reinitialize
    return this.initialize(preference);
  }

  destroy(): void {
    this.initializationGeneration++;
    markExpectedWebGPUDeviceDestruction(this.device);
    this.device?.destroy();
    this.device = null;
    this.adapter = null;
    this.isInitialized = false;
    this.initPromise = null;
    this.isRecovering = false;
    this.recoveryFailedCallbacks.clear();
    this.deviceLostCallbacks.clear();
    this.deviceRestoredCallbacks.clear();
    this.powerPreferenceFallbackCallbacks.clear();
  }
}
