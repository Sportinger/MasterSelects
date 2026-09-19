import {
  BRUSH_PRESET_CONFIG,
  type BrushDatasetEntry,
  type BrushTrainingPreset,
  type BrushTrainingSnapshot,
  type BrushWorkerRequest,
  type BrushWorkerResponse,
} from './brushTrainingContract';
import { virtualFilePath } from './virtualDirectoryHandle';

export type {
  BrushTrainingPhase,
  BrushTrainingPreset,
  BrushTrainingSnapshot,
} from './brushTrainingContract';

export interface BrushTrainingController {
  pause(): void;
  resume(): void;
  cancel(): void;
  exportPly(): Promise<Uint8Array>;
  finished: Promise<void>;
}

interface PendingExport {
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assetBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

function initialSnapshot(preset: BrushTrainingPreset): BrushTrainingSnapshot {
  return {
    phase: 'loading-runtime',
    iteration: 0,
    totalIterations: BRUSH_PRESET_CONFIG[preset].totalIterations,
    splatCount: 0,
    trainViews: 0,
    evalViews: 0,
    elapsedMs: 0,
    psnr: null,
    ssim: null,
    warning: null,
  };
}

export async function startBrushTraining(
  files: File[],
  preset: BrushTrainingPreset,
  onUpdate: (snapshot: BrushTrainingSnapshot) => void,
): Promise<BrushTrainingController> {
  if (files.length === 0) throw new Error('The COLMAP dataset has no files to train.');

  const worker = new Worker(new URL('./brushTraining.worker.ts', import.meta.url), { type: 'module' });
  const entries: BrushDatasetEntry[] = files.map((file) => ({
    file,
    path: virtualFilePath(file),
  }));
  const pendingExports = new Map<number, PendingExport>();
  let exportRequestId = 0;
  let lastSnapshot = initialSnapshot(preset);
  let startedSettled = false;
  let finishedSettled = false;
  let terminated = false;
  let cancelTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveFinished!: () => void;
  let resolveStarted!: () => void;
  let rejectStarted!: (error: Error) => void;

  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const started = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });

  const emit = (snapshot: BrushTrainingSnapshot) => {
    lastSnapshot = snapshot;
    onUpdate(snapshot);
  };
  const settleFinished = () => {
    if (finishedSettled) return;
    finishedSettled = true;
    resolveFinished();
  };
  const rejectExports = (message: string) => {
    pendingExports.forEach(({ reject }) => reject(new Error(message)));
    pendingExports.clear();
  };
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    if (cancelTimer) clearTimeout(cancelTimer);
    worker.terminate();
  };
  const fail = (message: string) => {
    emit({ ...lastSnapshot, phase: 'error', warning: message });
    if (!startedSettled) {
      startedSettled = true;
      rejectStarted(new Error(message));
    }
    rejectExports(message);
    settleFinished();
    terminate();
  };

  worker.onmessage = (event: MessageEvent<BrushWorkerResponse>) => {
    const message = event.data;
    if (message.type === 'snapshot') {
      emit(message.snapshot);
      return;
    }
    if (message.type === 'started') {
      if (!startedSettled) {
        startedSettled = true;
        resolveStarted();
      }
      return;
    }
    if (message.type === 'finished') {
      settleFinished();
      if (lastSnapshot.phase !== 'completed') terminate();
      return;
    }
    if (message.type === 'export-ply') {
      const pending = pendingExports.get(message.requestId);
      if (!pending) return;
      pendingExports.delete(message.requestId);
      pending.resolve(new Uint8Array(message.bytes));
      return;
    }
    if (message.type === 'export-error') {
      const pending = pendingExports.get(message.requestId);
      if (!pending) return;
      pendingExports.delete(message.requestId);
      pending.reject(new Error(message.message));
      return;
    }
    fail(message.message);
  };
  worker.onerror = (event) => fail(event.message || 'Brush training worker failed.');
  onUpdate(lastSnapshot);

  const post = (message: BrushWorkerRequest) => {
    if (!terminated) worker.postMessage(message);
  };
  post({ type: 'start', assetBaseUrl: assetBaseUrl(), entries, preset });

  const controller: BrushTrainingController = {
    pause() {
      if (terminated || lastSnapshot.phase !== 'training') return;
      emit({ ...lastSnapshot, phase: 'paused' });
      post({ type: 'pause' });
    },
    resume() {
      if (terminated || lastSnapshot.phase !== 'paused') return;
      emit({ ...lastSnapshot, phase: 'training' });
      post({ type: 'resume' });
    },
    cancel() {
      if (terminated || ['cancelled', 'error'].includes(lastSnapshot.phase)) return;
      emit({ ...lastSnapshot, phase: 'cancelled' });
      post({ type: 'cancel' });
      cancelTimer = setTimeout(() => {
        rejectExports('Brush training was cancelled.');
        settleFinished();
        terminate();
      }, 15_000);
    },
    exportPly() {
      if (terminated || lastSnapshot.phase !== 'completed') {
        return Promise.reject(new Error('Training is not complete.'));
      }
      const requestId = ++exportRequestId;
      return new Promise<Uint8Array>((resolve, reject) => {
        pendingExports.set(requestId, { resolve, reject });
        post({ type: 'export-ply', requestId });
      });
    },
    finished,
  };

  try {
    await started;
    return controller;
  } catch (error) {
    terminate();
    throw new Error(describeError(error));
  }
}
