export type RenderPresentationStrategy =
  | 'worker-webgpu-present'
  | 'worker-webgpu-main-present'
  | 'worker-cpu-present'
  | 'main-host-dev';

export interface RenderCapabilityFacts {
  readonly workerNavigatorGpu: boolean;
  readonly workerWebGpuDevice: boolean;
  readonly offscreenCanvasTransfer: boolean;
  readonly offscreenCanvasWebGpuContext: boolean;
  readonly workerCanvasPresentation: boolean;
  readonly videoFrameTransfer: boolean;
  readonly imageBitmapTransfer: boolean;
  readonly webCodecs: boolean;
  readonly webCodecsWorker: boolean;
  readonly copyExternalImageToTexture: boolean;
  readonly audioContext: boolean;
}

export interface RenderCapabilityProbeResult {
  readonly timestamp: number;
  readonly browserEngine: 'chromium' | 'firefox' | 'webkit' | 'unknown';
  readonly os: 'windows' | 'linux' | 'macos' | 'unknown';
  readonly gpuAdapter: {
    readonly name?: string;
    readonly vendor?: string;
    readonly architecture?: string;
    readonly device?: string;
    readonly description?: string;
    readonly source?: 'webgpu-adapter' | 'webgl-debug-renderer';
  } | null;
  readonly facts: RenderCapabilityFacts;
  readonly selectedStrategy: RenderPresentationStrategy;
  readonly selectionReason: string;
}

type NavigatorWithUAData = Navigator & {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    platform?: string;
  };
  gpu?: {
    requestAdapter?: () => Promise<{
      info?: {
        vendor?: string;
        architecture?: string;
        device?: string;
        description?: string;
      };
      requestDevice?: () => Promise<unknown>;
    } | null>;
  };
};

type WebGpuAdapterLike = {
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  requestDevice?: () => Promise<unknown>;
} | null;

const EMPTY_FACTS: RenderCapabilityFacts = {
  workerNavigatorGpu: false,
  workerWebGpuDevice: false,
  offscreenCanvasTransfer: false,
  offscreenCanvasWebGpuContext: false,
  workerCanvasPresentation: false,
  videoFrameTransfer: false,
  imageBitmapTransfer: false,
  webCodecs: false,
  webCodecsWorker: false,
  copyExternalImageToTexture: false,
  audioContext: false,
};

let lastProbe: RenderCapabilityProbeResult | null = null;

const MAIN_GPU_ADAPTER_TIMEOUT_MS = 2000;

const WORKER_PROBE_FALLBACK = {
  workerNavigatorGpu: false,
  workerWebGpuDevice: false,
  offscreenCanvasWebGpuContext: false,
  workerCanvasPresentation: false,
  webCodecsWorker: false,
};

export function selectRenderPresentationStrategy(facts: RenderCapabilityFacts): {
  strategy: RenderPresentationStrategy;
  reason: string;
} {
  if (
    facts.workerNavigatorGpu &&
    facts.workerWebGpuDevice &&
    facts.offscreenCanvasTransfer &&
    facts.offscreenCanvasWebGpuContext &&
    facts.workerCanvasPresentation &&
    facts.videoFrameTransfer &&
    facts.copyExternalImageToTexture
  ) {
    return {
      strategy: 'worker-webgpu-present',
      reason: 'worker WebGPU, worker presentation, transferable frames, and GPU frame import are available',
    };
  }

  if (
    facts.workerNavigatorGpu &&
    facts.workerWebGpuDevice &&
    facts.offscreenCanvasTransfer &&
    facts.videoFrameTransfer &&
    facts.imageBitmapTransfer &&
    facts.copyExternalImageToTexture
  ) {
    return {
      strategy: 'worker-webgpu-main-present',
      reason: 'worker WebGPU is available, but direct worker presentation is incomplete',
    };
  }

  if (facts.offscreenCanvasTransfer && facts.imageBitmapTransfer) {
    return {
      strategy: 'worker-cpu-present',
      reason: 'worker transferable canvas/bitmap path is available without worker WebGPU presentation',
    };
  }

  return {
    strategy: 'main-host-dev',
    reason: 'worker renderer capabilities are incomplete; keep the temporary main host path during migration',
  };
}

export function getLastRenderCapabilityProbe(): RenderCapabilityProbeResult | null {
  return lastProbe;
}

export function clearRenderCapabilityProbeForTests(): void {
  lastProbe = null;
}

function detectBrowserEngine(nav: NavigatorWithUAData | undefined): RenderCapabilityProbeResult['browserEngine'] {
  const brands = nav?.userAgentData?.brands?.map((brand) => brand.brand.toLowerCase()).join(' ') ?? '';
  const ua = nav?.userAgent.toLowerCase() ?? '';
  if (brands.includes('chromium') || brands.includes('google chrome') || ua.includes('chrome')) {
    return 'chromium';
  }
  if (ua.includes('firefox')) {
    return 'firefox';
  }
  if (ua.includes('safari') || brands.includes('safari')) {
    return 'webkit';
  }
  return 'unknown';
}

function detectOperatingSystem(nav: NavigatorWithUAData | undefined): RenderCapabilityProbeResult['os'] {
  const platform = `${nav?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('linux')) return 'linux';
  if (platform.includes('mac')) return 'macos';
  return 'unknown';
}

function canTransferVideoFrame(): boolean {
  if (typeof VideoFrame === 'undefined') return false;
  let frame: VideoFrame | null = null;
  let clone: VideoFrame | null = null;
  try {
    let source: CanvasImageSource | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      source = new OffscreenCanvas(1, 1) as unknown as CanvasImageSource;
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      source = canvas;
    }
    if (!source) return false;
    frame = new VideoFrame(source, { timestamp: 0 });
    clone = structuredClone(frame, { transfer: [frame] });
    clone.close();
    clone = null;
    frame = null;
    return true;
  } catch {
    return false;
  } finally {
    try {
      clone?.close();
    } catch {
      // Ignore cleanup errors from already-detached probes.
    }
    try {
      frame?.close();
    } catch {
      // Ignore cleanup errors from already-detached probes.
    }
  }
}

function gpuAdapterHasDetails(adapterInfo: RenderCapabilityProbeResult['gpuAdapter']): boolean {
  return Boolean(
    adapterInfo?.name
    || adapterInfo?.vendor
    || adapterInfo?.architecture
    || adapterInfo?.device
    || adapterInfo?.description,
  );
}

function readWebGlDebugAdapterInfo(): RenderCapabilityProbeResult['gpuAdapter'] {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return null;
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as {
      readonly UNMASKED_VENDOR_WEBGL: number;
      readonly UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const vendor = debugInfo
      ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? '')
      : String(context.getParameter(context.VENDOR) ?? '');
    const renderer = debugInfo
      ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(context.getParameter(context.RENDERER) ?? '');
    const description = [vendor, renderer].filter(Boolean).join(' ');
    return description
      ? { vendor, description, source: 'webgl-debug-renderer' }
      : null;
  } catch {
    return null;
  }
}

function requestGpuAdapterWithTimeout(
  requestAdapter: () => Promise<WebGpuAdapterLike>,
  timeoutMs = MAIN_GPU_ADAPTER_TIMEOUT_MS,
): Promise<WebGpuAdapterLike> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (adapter: WebGpuAdapterLike) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(adapter);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      requestAdapter().then(finish, () => finish(null));
    } catch {
      finish(null);
    }
  });
}

async function canTransferImageBitmap(): Promise<boolean> {
  if (typeof createImageBitmap !== 'function' || typeof ImageData === 'undefined') return false;
  let bitmap: ImageBitmap | null = null;
  let clone: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new ImageData(1, 1));
    clone = structuredClone(bitmap, { transfer: [bitmap] });
    clone.close();
    clone = null;
    bitmap = null;
    return true;
  } catch {
    return false;
  } finally {
    try {
      clone?.close();
    } catch {
      // Ignore cleanup errors from already-detached probes.
    }
    try {
      bitmap?.close();
    } catch {
      // Ignore cleanup errors from already-detached probes.
    }
  }
}

async function probeWorkerCapabilities(timeoutMs = 1000): Promise<typeof WORKER_PROBE_FALLBACK> {
  if (
    typeof Worker === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return WORKER_PROBE_FALLBACK;
  }

  const workerSource = `
    self.onmessage = async () => {
      const facts = {
        workerNavigatorGpu: false,
        workerWebGpuDevice: false,
        offscreenCanvasWebGpuContext: false,
        workerCanvasPresentation: false,
        webCodecsWorker: typeof VideoDecoder !== 'undefined',
      };
      try {
        facts.workerNavigatorGpu = Boolean(self.navigator && self.navigator.gpu);
        if (facts.workerNavigatorGpu) {
          const adapter = await self.navigator.gpu.requestAdapter();
          if (adapter && typeof adapter.requestDevice === 'function') {
            const device = await adapter.requestDevice();
            facts.workerWebGpuDevice = Boolean(device);
            if (device && typeof device.destroy === 'function') {
              device.destroy();
            }
          }
        }
      } catch {}
      try {
        if (typeof OffscreenCanvas !== 'undefined') {
          const canvas = new OffscreenCanvas(1, 1);
          const context = canvas.getContext('webgpu');
          facts.offscreenCanvasWebGpuContext = Boolean(context);
        }
      } catch {}
      self.postMessage(facts);
    };
  `;

  const url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch {
      URL.revokeObjectURL(url);
      resolve(WORKER_PROBE_FALLBACK);
      return;
    }
    const finish = (facts: typeof WORKER_PROBE_FALLBACK) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(facts);
    };
    const timer = setTimeout(() => finish(WORKER_PROBE_FALLBACK), timeoutMs);
    worker.onmessage = (event: MessageEvent<typeof WORKER_PROBE_FALLBACK>) => {
      finish({
        ...WORKER_PROBE_FALLBACK,
        ...event.data,
        // Direct worker presentation is a visible-pixel gate, not something this
        // API probe can infer from an offscreen WebGPU context.
        workerCanvasPresentation: false,
      });
    };
    worker.onerror = () => finish(WORKER_PROBE_FALLBACK);
    worker.postMessage(null);
  });
}

async function requestGpuAdapterInfo(nav: NavigatorWithUAData | undefined): Promise<{
  adapterInfo: RenderCapabilityProbeResult['gpuAdapter'];
  mainGpuAvailable: boolean;
  mainGpuDevice: boolean;
}> {
  const gpu = nav?.gpu;
  const requestAdapter = gpu?.requestAdapter;
  if (typeof requestAdapter !== 'function') {
    return {
      adapterInfo: readWebGlDebugAdapterInfo(),
      mainGpuAvailable: false,
      mainGpuDevice: false,
    };
  }

  try {
    const adapter = await requestGpuAdapterWithTimeout(() => requestAdapter.call(gpu));
    if (!adapter) {
      return {
        adapterInfo: readWebGlDebugAdapterInfo(),
        mainGpuAvailable: true,
        mainGpuDevice: false,
      };
    }
    const adapterInfo = adapter.info ? { ...adapter.info, source: 'webgpu-adapter' as const } : null;
    return {
      adapterInfo: gpuAdapterHasDetails(adapterInfo) ? adapterInfo : readWebGlDebugAdapterInfo(),
      mainGpuAvailable: true,
      // Do not call adapter.requestDevice() here: Chromium/Dawn can mark the
      // adapter as consumed, breaking the real engine initialization that runs
      // immediately after the probe.
      mainGpuDevice: false,
    };
  } catch {
    return {
      adapterInfo: readWebGlDebugAdapterInfo(),
      mainGpuAvailable: true,
      mainGpuDevice: false,
    };
  }
}

export async function runRenderCapabilityProbe(): Promise<RenderCapabilityProbeResult> {
  const nav = typeof navigator !== 'undefined'
    ? navigator as NavigatorWithUAData
    : undefined;
  const { adapterInfo, mainGpuAvailable, mainGpuDevice } = await requestGpuAdapterInfo(nav);
  const workerFacts = await probeWorkerCapabilities();
  const offscreenCanvasTransfer = typeof HTMLCanvasElement !== 'undefined'
    && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;
  const facts: RenderCapabilityFacts = {
    ...EMPTY_FACTS,
    workerNavigatorGpu: workerFacts.workerNavigatorGpu,
    workerWebGpuDevice: workerFacts.workerWebGpuDevice,
    offscreenCanvasTransfer,
    offscreenCanvasWebGpuContext: workerFacts.offscreenCanvasWebGpuContext,
    workerCanvasPresentation: workerFacts.workerCanvasPresentation,
    videoFrameTransfer: canTransferVideoFrame(),
    imageBitmapTransfer: await canTransferImageBitmap(),
    webCodecs: typeof VideoDecoder !== 'undefined',
    webCodecsWorker: workerFacts.webCodecsWorker,
    copyExternalImageToTexture: workerFacts.workerWebGpuDevice || (mainGpuAvailable && mainGpuDevice),
    audioContext: typeof AudioContext !== 'undefined',
  };
  const selection = selectRenderPresentationStrategy(facts);

  lastProbe = {
    timestamp: Date.now(),
    browserEngine: detectBrowserEngine(nav),
    os: detectOperatingSystem(nav),
    gpuAdapter: adapterInfo,
    facts,
    selectedStrategy: selection.strategy,
    selectionReason: selection.reason,
  };
  return lastProbe;
}
