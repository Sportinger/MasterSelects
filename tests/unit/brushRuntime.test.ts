import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startBrushTraining,
  type BrushTrainingSnapshot,
} from '../../src/services/photogrammetry/brushRuntime';
import type {
  BrushWorkerRequest,
  BrushWorkerResponse,
} from '../../src/services/photogrammetry/brushTrainingContract';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<BrushWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: BrushWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: BrushWorkerRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: BrushWorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<BrushWorkerResponse>);
  }
}

function trainingSnapshot(update: Partial<BrushTrainingSnapshot> = {}): BrushTrainingSnapshot {
  return {
    phase: 'training',
    iteration: 5,
    totalIterations: 1_500,
    splatCount: 9_965,
    trainViews: 31,
    evalViews: 0,
    elapsedMs: 1_000,
    psnr: null,
    ssim: null,
    warning: null,
    ...update,
  };
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});

describe('Brush worker runtime', () => {
  it('runs controls and PLY export across a dedicated worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const file = new File(['image'], 'frame.jpg');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'dataset/images/frame.jpg' });
    const updates: BrushTrainingSnapshot[] = [];

    const controllerPromise = startBrushTraining([file], 'preview', (snapshot) => updates.push(snapshot));
    const worker = FakeWorker.instances[0];
    expect(worker.posted[0]).toMatchObject({
      type: 'start',
      preset: 'preview',
      entries: [{ path: 'dataset/images/frame.jpg', file }],
    });

    worker.emit({ type: 'snapshot', snapshot: trainingSnapshot() });
    worker.emit({ type: 'started' });
    const controller = await controllerPromise;
    controller.pause();
    controller.resume();
    expect(worker.posted.slice(-2).map(({ type }) => type)).toEqual(['pause', 'resume']);

    worker.emit({ type: 'snapshot', snapshot: trainingSnapshot({ phase: 'completed', iteration: 1_500 }) });
    worker.emit({ type: 'finished' });
    const exportPromise = controller.exportPly();
    const exportRequest = worker.posted.at(-1);
    expect(exportRequest).toMatchObject({ type: 'export-ply' });
    const requestId = (exportRequest as Extract<BrushWorkerRequest, { type: 'export-ply' }>).requestId;
    worker.emit({ type: 'export-ply', requestId, bytes: new Uint8Array([1, 2, 3]).buffer });

    await expect(exportPromise).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(controller.finished).resolves.toBeUndefined();
    expect(updates.at(-1)?.phase).toBe('completed');
    expect(worker.terminated).toBe(false);
  });
});
