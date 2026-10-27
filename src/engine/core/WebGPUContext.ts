// WebGPU device, adapter, and queue initialization

import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import { SoftwareOutputCanvas } from './SoftwareOutputCanvas';
import { Logger } from '../../services/logger';
import { attachWebGPUDeviceDiagnostics, markExpectedWebGPUDeviceDestruction, markWebGPUDeviceLossOwnerReported } from '../../services/runtimeDiagnostics';
import { recordGpuAdapter, recordGpuStartupFailure } from '../../services/diagnostics/gpuStartupProbe';
import type { GPUInitializationFailure } from './gpuInitializationFailure';
import { GPUInitializationCancelledError, GPURequestTimeoutError, requestEditorDevice, requestGpuAdapter, type GPURequestAdapterOptionsWithFeatureLevel } from './gpuDeviceRequest';
import { browserIdentity, planAndroidAdapterRequests, readAndroidAdapterMemory, recordAndroidAdapterOutcome } from './androidAdapterMemory';
import { DeviceLossPolicy, REPEATED_LOSS_WINDOW_MS, whenPageVisible } from './deviceLossPolicy';
import { guardGpuDevice } from './gpuPipelineGuard';

const log = Logger.create('WebGPUContext');

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

export class WebGPUContext {
  private readonly softwareCanvases = new WeakMap<HTMLCanvasElement, SoftwareOutputCanvas>();
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
  private readonly lossPolicy = new DeviceLossPolicy();
  private incidentLossMessage: string | null = null; // loss that started the current incident

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
      recordGpuStartupFailure('unsupported');
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

  private async doInitialize(): Promise<boolean> {
    try {
      const isAndroid = this.isAndroidRuntime();

      if (isAndroid) {
        // Android devices do not benefit from desktop-style GPU power selection.
        // More importantly, some Chrome/driver combinations leave a
        // powerPreference request pending and then serialize every later adapter
        // request behind it. The request order (core or compatibility first) comes
        // from how the previous start went on this device.
        this.adapter = await this.requestAndroidAdapter();
      } else {
        // Try with power preference first, then fallback without it.
        // Safari on single-GPU Macs can fail with 'high-performance'.
        log.info(`Requesting adapter with powerPreference: ${this.currentPowerPreference}`);
        this.adapter = await requestGpuAdapter(
          { powerPreference: this.currentPowerPreference },
          'requestAdapter (with powerPreference)',
          () => this.initializationGeneration,
        );
      }

      // Fallback 1: on Linux hybrid-GPU systems, the requested dGPU can be
      // unavailable/wedged while the compositor's display GPU still works.
      if (!this.adapter && this.currentPowerPreference === 'high-performance' && this.shouldUseLowPowerFallback()) {
        log.warn('high-performance adapter unavailable on Linux, trying low-power (integrated/display) GPU...');
        const lowPowerAdapter = await requestGpuAdapter(
          { powerPreference: 'low-power' },
          'requestAdapter (low-power fallback)',
          () => this.initializationGeneration,
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
        this.adapter = await requestGpuAdapter(
          undefined,
          'requestAdapter (no preference)',
          () => this.initializationGeneration,
        );
      }

      if (!this.adapter) {
        this.initializationFailure = 'adapter_unavailable';
        recordGpuStartupFailure('adapter_unavailable');
        this.logInitFailure('Failed to get GPU adapter (all attempts)');
        return false;
      }
      log.info('Adapter obtained');
      recordGpuAdapter(this.adapter);
      log.info('Adapter limits', {
        maxTextureDimension2D: this.adapter.limits.maxTextureDimension2D,
        maxStorageBufferBindingSize: this.adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: this.adapter.limits.maxBufferSize,
      });

      this.device = await requestEditorDevice(this.adapter, () => this.initializationGeneration);

      if (!this.device) {
        this.initializationFailure = 'device_failed';
        recordGpuStartupFailure('device_failed');
        this.logInitFailure('Failed to create GPU device');
        return false;
      }
      log.info('GPU device created successfully');
      attachWebGPUDeviceDiagnostics(this.device, 'WebGPUContext');
      guardGpuDevice(this.device, 'editor');

      const initializedDevice = this.device;
      const generation = this.initializationGeneration;
      this.device.lost.then((info) => {
        if (this.device !== initializedDevice || generation !== this.initializationGeneration) return;
        this.handleDeviceLost(info);
      });
      // The loss handler above reports real losses once; keep the generic
      // runtime diagnostic from filing a second error for the same event.
      markWebGPUDeviceLossOwnerReported(this.device);

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
      recordGpuStartupFailure(this.initializationFailure);
      this.logInitFailure('Failed to initialize WebGPU', error);
      return false;
    }
  }

  /**
   * Android adapter selection. The normal (core) adapter keeps the full feature level; Chrome's
   * compatibility mode can use an OpenGL ES 3.1 backend where the stricter core/Vulkan adapter is
   * unavailable (older Chrome ignores the unknown member, so it is also a safe plain retry).
   * A request that stalls past its deadline ends this start (a pending request must never be
   * followed by another one), but it is remembered per device: the next start asks for the other
   * path first, or fails fast when both stalled before (androidAdapterMemory.ts).
   */
  private async requestAndroidAdapter(): Promise<GPUAdapter | null> {
    const browser = browserIdentity(navigator.userAgent || '');
    const memory = readAndroidAdapterMemory();
    const plan = planAndroidAdapterRequests(memory, browser);
    if (plan.reason === 'default' || plan.reason === 'core-worked') {
      log.info('Android detected; requesting adapter without powerPreference');
    } else {
      log.warn('Android adapter order chosen from the previous start on this device', {
        order: plan.order.join(' > '), timeoutMs: plan.timeoutMs, reason: plan.reason, memory,
      });
    }
    for (const [index, path] of plan.order.entries()) {
      if (index > 0) log.warn(`Android ${plan.order[0]} adapter unavailable, trying ${path === 'compatibility' ? 'WebGPU compatibility mode' : 'the core adapter'}...`);
      const options: GPURequestAdapterOptionsWithFeatureLevel | undefined = path === 'compatibility'
        ? { featureLevel: 'compatibility' }
        : undefined;
      let adapter: GPUAdapter | null;
      try {
        adapter = await requestGpuAdapter(
          options,
          path === 'core' ? 'requestAdapter (Android core)' : 'requestAdapter (Android compatibility)',
          () => this.initializationGeneration,
          plan.timeoutMs,
        );
      } catch (error) {
        if (error instanceof GPURequestTimeoutError) {
          const stored = recordAndroidAdapterOutcome(path, 'timeout', browser);
          log.warn(`Android ${path} adapter request stalled for ${plan.timeoutMs} ms; remembered for the next start`, {
            stored: stored !== null, next: stored ? planAndroidAdapterRequests(stored, browser) : null,
          });
        }
        throw error;
      }
      if (adapter) {
        recordAndroidAdapterOutcome(path, 'ok', browser);
        if (path === 'compatibility') log.warn('Using WebGPU compatibility mode on Android');
        return adapter;
      }
    }
    return null;
  }

  /** During loss recovery a failed attempt is a warning; recoverDevice files the incident's error. */
  private logInitFailure(message: string, error?: unknown): void {
    if (!this.isRecovering) log.error(message, error);
    else log.warn(`${message}; recovery attempt ${this.recoveryAttempts}`, error);
  }

  /** The editor's current device was lost without the editor destroying it. */
  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    const recoveryGeneration = ++this.initializationGeneration;
    const decision = this.lossPolicy.classify();
    const details = { reason: info.reason, message: info.message, kind: decision.kind };
    this.incidentLossMessage = info.message;
    if (decision.kind === 'repeated') {
      // Recovery stops for good: this incident files exactly one error, folding in a still-held first loss.
      const heldLoss = this.lossPolicy.takeHeldReport();
      log.error('GPU device lost repeatedly; recovery stopped', { ...details, occurrence: decision.occurrence,
        windowMs: REPEATED_LOSS_WINDOW_MS, ...(heldLoss !== null && heldLoss !== info.message ? { firstLoss: heldLoss } : {}) });
    } else if (decision.report === 'error') {
      this.lossPolicy.holdReport(info.message);
      log.warn('Device lost; recovering before reporting', details);
    } else if (decision.kind === 'background') log.warn('Device lost while the page was hidden or unloading; restoring when visible', details);
    else log.warn('Device lost again', { ...details, occurrence: decision.occurrence });
    this.isInitialized = false;

    // Notify listeners about device loss BEFORE attempting recovery
    for (const callback of this.deviceLostCallbacks) {
      try { callback(info.message); } catch (e) { log.error('Error in device lost callback', e); }
    }

    // Loss listeners need the old device to release their caches. Once they
    // finish, never expose or reuse that lost device during a retry.
    this.device = null;
    this.adapter = null;
    this.initPromise = null;
    if (decision.recover === 'stop') {
      this.initializationFailure = 'device_lost_repeatedly';
      this.finishRecoveryFailure();
      return;
    }
    if (info.reason !== 'destroyed' && this.currentPowerPreference === 'high-performance' &&
        !this.hasTriedLowPowerFallback && this.shouldUseLowPowerFallback()) {
      this.hasTriedLowPowerFallback = true;
      this.currentPowerPreference = 'low-power';
      this.notifyPowerPreferenceFallback('low-power');
    }
    // destroy()/reinitialize swap the device out first, so a 'destroyed' loss
    // here came from the browser and is recovered like any other loss.
    this.isRecovering = true;
    this.recoveryAttempts = 0;
    if (decision.recover === 'now') void this.recoverDevice(recoveryGeneration);
    else whenPageVisible(() => {
      if (recoveryGeneration === this.initializationGeneration) void this.recoverDevice(recoveryGeneration);
    });
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
          this.reportHeldLoss();
          this.incidentLossMessage = null;
          return;
        } catch (error) {
          if (generation !== this.initializationGeneration) return;
          this.initializationFailure = 'initialization_failed';
          log.warn('Failed to restore engine resources', error);
          break;
        }
      }
      // An expired request is still running in the browser GPU process.
      // Do not queue more requests behind it; report a terminal, actionable error.
      if (this.initializationFailure === 'adapter_timeout' ||
          this.initializationFailure === 'device_timeout' ||
          this.initializationFailure === 'unsupported') break;
    }
    // The one error of this incident; it carries the loss that started it,
    // also when an earlier incident already filed that first loss.
    const lostDevice = this.lossPolicy.takeHeldReport() ?? this.incidentLossMessage;
    log.error('GPU recovery failed', {
      attempts: this.recoveryAttempts,
      failure: this.initializationFailure,
      ...(lostDevice !== null ? { lostDevice } : {}),
    });
    this.finishRecoveryFailure();
  }

  /** A held first-loss report becomes the incident's error once recovery ends without giving up. */
  private reportHeldLoss(): void {
    const message = this.lossPolicy.takeHeldReport();
    if (message !== null) log.error('Device lost', message);
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }

  getAdapter(): GPUAdapter | null {
    return this.adapter;
  }

  get initialized(): boolean {
    return this.isInitialized;
  }

  /** Get GPU info (vendor, device name, etc.) */
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

    if (prefersSoftwareTimelineCanvas()) {
      let context = this.softwareCanvases.get(canvas);
      if (!context) { context = new SoftwareOutputCanvas(canvas); this.softwareCanvases.set(canvas, context); }
      context.configure({ device: this.device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
      log.debug('Canvas uses GPU rendering with software presentation on Linux');
      return context;
    }
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

  /** Register a callback to be notified when the device is lost */
  onDeviceLost(callback: DeviceLostCallback): void {
    this.deviceLostCallbacks.add(callback);
  }

  /** Remove a device lost callback */
  offDeviceLost(callback: DeviceLostCallback): void {
    this.deviceLostCallbacks.delete(callback);
  }

  /** Register a callback to be notified when the device is restored after loss */
  onDeviceRestored(callback: DeviceRestoredCallback): void {
    this.deviceRestoredCallbacks.add(callback);
  }

  /** Remove a device restored callback */
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

  /** Remove a power preference fallback callback */
  offPowerPreferenceFallback(callback: (preference: GPUPowerPreference) => void): void {
    this.powerPreferenceFallbackCallbacks.delete(callback);
  }

  private notifyPowerPreferenceFallback(preference: GPUPowerPreference): void {
    for (const callback of this.powerPreferenceFallbackCallbacks) {
      try { callback(preference); } catch (e) { log.error('Error in power preference fallback callback', e); }
    }
  }

  /** Check if the context is currently recovering from a device loss */
  get recovering(): boolean {
    return this.isRecovering;
  }

  /** Get the current power preference */
  getPowerPreference(): GPUPowerPreference {
    return this.currentPowerPreference;
  }

  /** Reinitialize with a new power preference: destroys the current device and creates a new one. */
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
