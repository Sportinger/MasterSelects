/// <reference lib="webworker" />
import type {
  CameraSolvingSnapshot,
  CameraSolvingWorkerRequest,
  CameraSolvingWorkerResponse,
} from './cameraSolvingContract';
import { createColmapTextModel } from './sfm/colmapText';
import { reconstructSparseModel } from './sfm/reconstruction';

const workerScope = self as DedicatedWorkerGlobalScope;
let abortController: AbortController | null = null;
let startedAt = 0;

function post(message: CameraSolvingWorkerResponse): void {
  workerScope.postMessage(message);
}

function snapshot(partial: Omit<CameraSolvingSnapshot, 'elapsedMs'>): void {
  post({ type: 'snapshot', snapshot: { ...partial, elapsedMs: performance.now() - startedAt } });
}

async function start(request: Extract<CameraSolvingWorkerRequest, { type: 'start' }>): Promise<void> {
  abortController?.abort();
  abortController = new AbortController();
  startedAt = performance.now();
  snapshot({
    phase: 'loading-runtime',
    current: 0,
    total: request.files.length,
    registeredImages: 0,
    pointCount: 0,
    message: 'Loading browser vision engine',
  });
  try {
    const reconstruction = await reconstructSparseModel(
      request.files,
      request.maxImageSide,
      (progress) => snapshot({
        phase: progress.registeredImages > 0 ? 'reconstructing' : 'extracting-features',
        ...progress,
      }),
      abortController.signal,
    );
    if (abortController.signal.aborted) throw new DOMException('Camera solving cancelled.', 'AbortError');
    snapshot({
      phase: 'writing-dataset',
      current: reconstruction.poses.size,
      total: reconstruction.poses.size,
      registeredImages: reconstruction.poses.size,
      pointCount: reconstruction.points.length,
      message: 'Writing COLMAP-compatible camera model',
    });
    const model = createColmapTextModel(reconstruction);
    snapshot({
      phase: 'completed',
      current: model.registeredSourceIndices.length,
      total: request.files.length,
      registeredImages: model.registeredSourceIndices.length,
      pointCount: reconstruction.points.length,
      message: 'Camera solving complete',
    });
    post({ type: 'completed', model: { datasetName: request.datasetName, ...model } });
  } catch (error) {
    if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      post({ type: 'cancelled' });
    } else {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

workerScope.onmessage = (event: MessageEvent<CameraSolvingWorkerRequest>) => {
  if (event.data.type === 'cancel') {
    abortController?.abort();
    return;
  }
  void start(event.data);
};
