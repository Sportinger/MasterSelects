import {
  BRUSH_PRESET_CONFIG,
  type BrushTrainingSnapshot,
  type BrushWorkerRequest,
  type BrushWorkerResponse,
} from './brushTrainingContract';
import { createVirtualDirectoryHandleFromEntries } from './virtualDirectoryHandle';
import { readColmapPointsForBrush, stabilizeBrushPly } from './stabilizeBrushPly';

interface BrushMessage {
  kind: number;
  iter?: number;
  numSplats?: number;
  elapsedMs?: number;
  psnr?: number;
  ssim?: number;
  trainViews?: number;
  evalViews?: number;
  text?: string;
}

interface BrushTrainingBinding {
  trainSteps(steps: number): Promise<BrushMessage[]>;
  exportPly(): Promise<Uint8Array>;
  free(): void;
}

interface BrushAppBinding {
  init(): Promise<void>;
  initExisting?(adapter: GPUAdapter, device: GPUDevice, queue: GPUQueue): void;
  startTrainingFromDirectory(
    handle: FileSystemDirectoryHandle,
    config: (initial: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ): BrushTrainingBinding;
}

interface BrushModule {
  default(input?: string | URL | { module_or_path?: string | URL }): Promise<unknown>;
  BrushApp: new () => BrushAppBinding;
  BrushMessageKind: Record<string, number>;
}

interface BrushWorkerScope {
  postMessage(message: BrushWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<BrushWorkerRequest>) => void) | null;
}

const workerScope = self as unknown as BrushWorkerScope;
let training: BrushTrainingBinding | null = null;
let snapshot: BrushTrainingSnapshot | null = null;
let active = false;
let paused = false;
let completed = false;
let resumePump: (() => void) | null = null;
let freed = false;
let colmapPointsBuffer: ArrayBuffer | null = null;
let brushDevice: GPUDevice | null = null;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function send(message: BrushWorkerResponse, transfer?: Transferable[]) {
  workerScope.postMessage(message, transfer);
}

function emit(update: Partial<BrushTrainingSnapshot>) {
  if (!snapshot) return;
  snapshot = { ...snapshot, ...update };
  send({ type: 'snapshot', snapshot });
}

async function initializeBrushApp(app: BrushAppBinding): Promise<void> {
  if (!app.initExisting) {
    await app.init();
    return;
  }
  const gpu = (navigator as WorkerNavigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error('WebGPU is unavailable in the training worker.');
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Could not acquire a WebGPU adapter for Brush.');
  const requiredFeatures = [...adapter.features]
    .filter((feature) => feature !== 'mappable-primary-buffers') as GPUFeatureName[];
  const requiredLimits: Record<string, number> = {};
  for (const key in adapter.limits) {
    const value = (adapter.limits as unknown as Record<string, number>)[key];
    if (typeof value === 'number') requiredLimits[key] = value;
  }
  brushDevice = await adapter.requestDevice({ requiredFeatures, requiredLimits });
  app.initExisting(adapter, brushDevice, brushDevice.queue);
}

function freeTraining() {
  if (!training || freed) return;
  freed = true;
  try {
    training.free();
  } catch {
    // An async wasm-bindgen method may still hold a Rust borrow. Terminating
    // the worker releases the complete WASM instance in that case.
  }
}

async function start(request: Extract<BrushWorkerRequest, { type: 'start' }>) {
  const preset = BRUSH_PRESET_CONFIG[request.preset];
  snapshot = {
    phase: 'loading-runtime',
    iteration: 0,
    totalIterations: preset.totalIterations,
    splatCount: 0,
    trainViews: 0,
    evalViews: 0,
    elapsedMs: 0,
    psnr: null,
    ssim: null,
    warning: null,
  };
  active = true;
  paused = false;
  completed = false;
  send({ type: 'snapshot', snapshot });

  const moduleUrl = new URL('wasm/brush/brush_js.js', request.assetBaseUrl).href;
  const wasmUrl = new URL('wasm/brush/brush_js_bg.wasm', request.assetBaseUrl).href;
  const module = await import(/* @vite-ignore */ moduleUrl) as BrushModule;
  await module.default({ module_or_path: wasmUrl });
  const app = new module.BrushApp();
  await initializeBrushApp(app);

  emit({ phase: 'loading-dataset' });
  colmapPointsBuffer = await readColmapPointsForBrush(request.entries);
  const handle = createVirtualDirectoryHandleFromEntries(request.entries);
  training = app.startTrainingFromDirectory(handle, async (initial) => ({
    ...initial,
    'total-train-iters': preset.totalIterations,
    'refine-every': preset.refineEvery,
    'growth-stop-iter': preset.growthStopIteration,
    'growth-grad-threshold': preset.growthGradientThreshold,
    'growth-select-fraction': preset.growthSelectFraction,
    'split-at-screen-size': preset.splitAtScreenSize,
    'max-resolution': preset.maxResolution,
    'subsample-frames': preset.frameStride,
    'max-frames': preset.maxFrames,
    'max-splats': preset.maxSplats,
    'max-scene-batch-cache-size': preset.cacheBytes,
    'sh-degree': preset.shDegree,
    'mean-noise-weight': preset.meanNoiseWeight,
    'ssim-weight': preset.ssimWeight,
  }));
  send({ type: 'started' });

  const kinds = module.BrushMessageKind;
  const applyMessage = (message: BrushMessage) => {
    if (message.kind === kinds.StartLoading) emit({ phase: 'loading-dataset' });
    if (message.kind === kinds.DatasetLoaded) {
      emit({ trainViews: message.trainViews ?? 0, evalViews: message.evalViews ?? 0 });
    }
    if (message.kind === kinds.SplatsUpdated || message.kind === kinds.RefineStep) {
      emit({ splatCount: message.numSplats ?? snapshot?.splatCount ?? 0 });
    }
    if (message.kind === kinds.TrainStep) {
      emit({
        phase: paused ? 'paused' : 'training',
        iteration: message.iter ?? snapshot?.iteration ?? 0,
        elapsedMs: message.elapsedMs ?? snapshot?.elapsedMs ?? 0,
      });
    }
    if (message.kind === kinds.EvalResult) {
      emit({ psnr: message.psnr ?? null, ssim: message.ssim ?? null });
    }
    if (message.kind === kinds.Warning) emit({ warning: message.text ?? 'Brush reported a warning.' });
    if (message.kind === kinds.DoneTraining) {
      completed = true;
      emit({ phase: 'completed' });
    }
  };

  try {
    while (active) {
      while (paused && active) {
        await new Promise<void>((resolve) => { resumePump = resolve; });
      }
      if (!active) break;
      const messages = await training.trainSteps(5);
      if (messages.length === 0) break;
      messages.forEach(applyMessage);
      // DoneTraining can share the final batch with TrainStep. Calling back
      // into Brush after that terminal message panics inside the WASM state.
      if (completed) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (active && !completed) {
      completed = true;
      emit({ phase: 'completed' });
    }
  } finally {
    if (!active) freeTraining();
    send({ type: 'finished' });
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'start') {
    void start(request).catch((error) => {
      const message = describeError(error);
      emit({ phase: 'error', warning: message });
      send({ type: 'error', message });
      freeTraining();
    });
    return;
  }
  if (request.type === 'pause' && active && !paused) {
    paused = true;
    emit({ phase: 'paused' });
    return;
  }
  if (request.type === 'resume' && active && paused) {
    paused = false;
    emit({ phase: 'training' });
    resumePump?.();
    resumePump = null;
    return;
  }
  if (request.type === 'cancel') {
    active = false;
    paused = false;
    completed = false;
    resumePump?.();
    resumePump = null;
    emit({ phase: 'cancelled' });
    return;
  }
  if (request.type === 'export-ply') {
    if (!training || !completed) {
      send({ type: 'export-error', requestId: request.requestId, message: 'Training is not complete.' });
      return;
    }
    void training.exportPly().then((bytes) => {
      const stabilized = colmapPointsBuffer ? stabilizeBrushPly(bytes, colmapPointsBuffer) : null;
      if (stabilized && (stabilized.repairedValues || stabilized.discardedSplats)) {
        const details = [
          stabilized.repairedValues
            ? `${stabilized.repairedValues.toLocaleString()} non-finite values repaired`
            : null,
          stabilized.discardedSplats
            ? `${stabilized.discardedSplats.toLocaleString()} unstable splats hidden`
            : null,
        ].filter(Boolean).join(', ');
        emit({ warning: `Brush output stabilized: ${details}.` });
      }
      const copy = (stabilized?.bytes ?? bytes).slice().buffer;
      send({ type: 'export-ply', requestId: request.requestId, bytes: copy }, [copy]);
    }).catch((error) => {
      send({ type: 'export-error', requestId: request.requestId, message: describeError(error) });
    });
  }
};

export {};
