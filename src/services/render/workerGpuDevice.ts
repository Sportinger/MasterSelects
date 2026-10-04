export type WorkerGpuDeviceAcquireStatus =
  | 'acquired'
  | 'navigator-gpu-unavailable'
  | 'adapter-request-failed'
  | 'adapter-unavailable'
  | 'device-request-unavailable'
  | 'device-request-failed'
  | 'device-unavailable';

export type WorkerGpuCanvasFormatSource = 'navigator-preferred' | 'default';

export interface WorkerGpuNavigatorGpu {
  readonly requestAdapter?: (options?: GPURequestAdapterOptions) => Promise<GPUAdapter | null>;
  readonly getPreferredCanvasFormat?: () => GPUTextureFormat;
}

export interface WorkerGpuPreferredCanvasFormat {
  readonly format: GPUTextureFormat;
  readonly source: WorkerGpuCanvasFormatSource;
  readonly error: string | null;
}

export interface WorkerGpuAdapterInfo {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
}

export interface WorkerGpuDeviceDiagnostics {
  readonly status: WorkerGpuDeviceAcquireStatus;
  readonly navigatorGpuAvailable: boolean;
  readonly adapterRequested: boolean;
  readonly adapterAcquired: boolean;
  readonly deviceRequested: boolean;
  readonly deviceAcquired: boolean;
  readonly preferredCanvasFormat: GPUTextureFormat;
  readonly preferredCanvasFormatSource: WorkerGpuCanvasFormatSource;
  readonly adapterInfo: WorkerGpuAdapterInfo | null;
  readonly adapterFeatures: readonly string[];
  readonly adapterLimits: Readonly<Record<string, number>>;
  readonly deviceFeatures: readonly string[];
  readonly deviceLimits: Readonly<Record<string, number>>;
  readonly error: string | null;
}

export interface WorkerGpuDeviceOwner {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly diagnostics: WorkerGpuDeviceDiagnostics;
}

export interface WorkerGpuDeviceAcquireResult {
  readonly ok: boolean;
  readonly owner: WorkerGpuDeviceOwner | null;
  readonly diagnostics: WorkerGpuDeviceDiagnostics;
}

export interface WorkerGpuDeviceAcquireOptions {
  readonly gpu?: WorkerGpuNavigatorGpu | null;
  readonly requestAdapterOptions?: GPURequestAdapterOptions;
  readonly deviceDescriptor?: GPUDeviceDescriptor;
}

type WorkerGpuScope = typeof globalThis & {
  navigator?: Navigator & {
    gpu?: WorkerGpuNavigatorGpu;
  };
};

const DEFAULT_CANVAS_FORMAT: GPUTextureFormat = 'bgra8unorm';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function featuresToArray(features: GPUSupportedFeatures | undefined): readonly string[] {
  if (!features) return [];
  try {
    return Array.from(features as Iterable<unknown>, String).toSorted();
  } catch {
    return [];
  }
}

function limitsToRecord(limits: GPUSupportedLimits | undefined): Readonly<Record<string, number>> {
  if (!limits) return {};
  const result: Record<string, number> = {};
  // WebIDL exposes limits as enumerable prototype getters, not own properties.
  for (const key in limits) {
    const value = (limits as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function defaultDeviceDescriptor(adapter: GPUAdapter): GPUDeviceDescriptor {
  const requiredLimits: Record<string, number> = {};
  for (const key of ['maxStorageBufferBindingSize', 'maxBufferSize'] as const) {
    const value = adapter.limits?.[key];
    if (Number.isFinite(value) && value > 0) requiredLimits[key] = value;
  }
  return {
    requiredFeatures: (['timestamp-query', 'shader-f16'] as GPUFeatureName[]).filter(feature => adapter.features?.has(feature)),
    requiredLimits,
  };
}

function copyAdapterInfo(adapter: GPUAdapter): WorkerGpuAdapterInfo | null {
  const info = (adapter as { readonly info?: unknown }).info;
  if (!info || typeof info !== 'object') return null;
  const source = info as Record<string, unknown>;
  const adapterInfo: WorkerGpuAdapterInfo = {
    vendor: typeof source.vendor === 'string' ? source.vendor : undefined,
    architecture: typeof source.architecture === 'string' ? source.architecture : undefined,
    device: typeof source.device === 'string' ? source.device : undefined,
    description: typeof source.description === 'string' ? source.description : undefined,
  };
  return Object.values(adapterInfo).some(Boolean) ? adapterInfo : null;
}

function createDiagnostics(input: {
  readonly status: WorkerGpuDeviceAcquireStatus;
  readonly preferred: WorkerGpuPreferredCanvasFormat;
  readonly navigatorGpuAvailable: boolean;
  readonly adapterRequested: boolean;
  readonly adapter: GPUAdapter | null;
  readonly deviceRequested: boolean;
  readonly device: GPUDevice | null;
  readonly error: string | null;
}): WorkerGpuDeviceDiagnostics {
  return {
    status: input.status,
    navigatorGpuAvailable: input.navigatorGpuAvailable,
    adapterRequested: input.adapterRequested,
    adapterAcquired: !!input.adapter,
    deviceRequested: input.deviceRequested,
    deviceAcquired: !!input.device,
    preferredCanvasFormat: input.preferred.format,
    preferredCanvasFormatSource: input.preferred.source,
    adapterInfo: input.adapter ? copyAdapterInfo(input.adapter) : null,
    adapterFeatures: featuresToArray(input.adapter?.features),
    adapterLimits: limitsToRecord(input.adapter?.limits),
    deviceFeatures: featuresToArray(input.device?.features),
    deviceLimits: limitsToRecord(input.device?.limits),
    error: input.error ?? input.preferred.error,
  };
}

export function getWorkerNavigatorGpu(scope: WorkerGpuScope = globalThis as WorkerGpuScope): WorkerGpuNavigatorGpu | null {
  return scope.navigator?.gpu ?? null;
}

export function getWorkerGpuPreferredCanvasFormat(
  gpu: WorkerGpuNavigatorGpu | null = getWorkerNavigatorGpu(),
): WorkerGpuPreferredCanvasFormat {
  if (typeof gpu?.getPreferredCanvasFormat !== 'function') {
    return {
      format: DEFAULT_CANVAS_FORMAT,
      source: 'default',
      error: null,
    };
  }

  try {
    return {
      format: gpu.getPreferredCanvasFormat(),
      source: 'navigator-preferred',
      error: null,
    };
  } catch (error) {
    return {
      format: DEFAULT_CANVAS_FORMAT,
      source: 'default',
      error: errorMessage(error),
    };
  }
}

export async function acquireWorkerGpuDevice(
  options: WorkerGpuDeviceAcquireOptions = {},
): Promise<WorkerGpuDeviceAcquireResult> {
  const gpu = options.gpu ?? getWorkerNavigatorGpu();
  const preferred = getWorkerGpuPreferredCanvasFormat(gpu);
  const requestAdapter = gpu?.requestAdapter;

  if (typeof requestAdapter !== 'function') {
    const diagnostics = createDiagnostics({
      status: 'navigator-gpu-unavailable',
      preferred,
      navigatorGpuAvailable: false,
      adapterRequested: false,
      adapter: null,
      deviceRequested: false,
      device: null,
      error: null,
    });
    return { ok: false, owner: null, diagnostics };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await requestAdapter.call(gpu, options.requestAdapterOptions);
  } catch (error) {
    const diagnostics = createDiagnostics({
      status: 'adapter-request-failed',
      preferred,
      navigatorGpuAvailable: true,
      adapterRequested: true,
      adapter: null,
      deviceRequested: false,
      device: null,
      error: errorMessage(error),
    });
    return { ok: false, owner: null, diagnostics };
  }

  if (!adapter) {
    const diagnostics = createDiagnostics({
      status: 'adapter-unavailable',
      preferred,
      navigatorGpuAvailable: true,
      adapterRequested: true,
      adapter: null,
      deviceRequested: false,
      device: null,
      error: null,
    });
    return { ok: false, owner: null, diagnostics };
  }

  const requestDevice = (adapter as { readonly requestDevice?: GPUAdapter['requestDevice'] }).requestDevice;
  if (typeof requestDevice !== 'function') {
    const diagnostics = createDiagnostics({
      status: 'device-request-unavailable',
      preferred,
      navigatorGpuAvailable: true,
      adapterRequested: true,
      adapter,
      deviceRequested: false,
      device: null,
      error: null,
    });
    return { ok: false, owner: null, diagnostics };
  }

  let device: GPUDevice | null = null;
  try {
    device = await requestDevice.call(adapter, options.deviceDescriptor ?? defaultDeviceDescriptor(adapter));
  } catch (error) {
    const diagnostics = createDiagnostics({
      status: 'device-request-failed',
      preferred,
      navigatorGpuAvailable: true,
      adapterRequested: true,
      adapter,
      deviceRequested: true,
      device: null,
      error: errorMessage(error),
    });
    return { ok: false, owner: null, diagnostics };
  }

  if (!device) {
    const diagnostics = createDiagnostics({
      status: 'device-unavailable',
      preferred,
      navigatorGpuAvailable: true,
      adapterRequested: true,
      adapter,
      deviceRequested: true,
      device: null,
      error: null,
    });
    return { ok: false, owner: null, diagnostics };
  }

  const diagnostics = createDiagnostics({
    status: 'acquired',
    preferred,
    navigatorGpuAvailable: true,
    adapterRequested: true,
    adapter,
    deviceRequested: true,
    device,
    error: null,
  });
  return {
    ok: true,
    owner: {
      adapter,
      device,
      diagnostics,
    },
    diagnostics,
  };
}

export function destroyWorkerGpuDeviceOwner(owner: WorkerGpuDeviceOwner | null): void {
  try {
    owner?.device.destroy();
  } catch {
    // Device destruction is best effort during worker teardown.
  }
}
