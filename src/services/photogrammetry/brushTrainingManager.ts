import {
  startBrushTraining,
  type BrushTrainingController,
  type BrushTrainingPreset,
  type BrushTrainingSnapshot,
} from './brushRuntime';

export interface BrushTrainingJobSnapshot {
  datasetName: string | null;
  preset: BrushTrainingPreset;
  training: BrushTrainingSnapshot | null;
  isStarting: boolean;
  error: string | null;
}

type BrushTrainingStarter = typeof startBrushTraining;
type BrushTrainingListener = () => void;

const EMPTY_JOB: BrushTrainingJobSnapshot = {
  datasetName: null,
  preset: 'preview',
  training: null,
  isStarting: false,
  error: null,
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns the GPU worker independently from whichever dock panel displays it. */
export class BrushTrainingManager {
  private readonly starter: BrushTrainingStarter;
  private controller: BrushTrainingController | null = null;
  private listeners = new Set<BrushTrainingListener>();
  private jobId = 0;
  private snapshot: BrushTrainingJobSnapshot = EMPTY_JOB;

  constructor(starter: BrushTrainingStarter = startBrushTraining) {
    this.starter = starter;
  }

  readonly getSnapshot = (): BrushTrainingJobSnapshot => this.snapshot;

  readonly subscribe = (listener: BrushTrainingListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(files: File[], preset: BrushTrainingPreset, datasetName: string): Promise<void> {
    const jobId = ++this.jobId;
    this.controller?.cancel();
    this.controller = null;
    this.update({ datasetName, preset, training: null, isStarting: true, error: null });

    try {
      const controller = await this.starter(files, preset, (training) => {
        if (jobId !== this.jobId) return;
        this.update({ ...this.snapshot, training });
      });
      if (jobId !== this.jobId) {
        controller.cancel();
        return;
      }
      this.controller = controller;
      this.update({ ...this.snapshot, isStarting: false });
    } catch (error) {
      if (jobId !== this.jobId) return;
      this.update({
        ...this.snapshot,
        isStarting: false,
        error: describeError(error),
      });
    }
  }

  pause(): void {
    this.controller?.pause();
  }

  resume(): void {
    this.controller?.resume();
  }

  cancel(): void {
    if (!this.controller && this.snapshot.isStarting) {
      ++this.jobId;
      this.update({
        ...this.snapshot,
        isStarting: false,
        training: this.snapshot.training
          ? { ...this.snapshot.training, phase: 'cancelled' }
          : null,
      });
      return;
    }
    this.controller?.cancel();
  }

  reset(): void {
    ++this.jobId;
    this.controller?.cancel();
    this.controller = null;
    this.update(EMPTY_JOB);
  }

  exportPly(): Promise<Uint8Array> {
    if (!this.controller) return Promise.reject(new Error('No Brush training result is available.'));
    return this.controller.exportPly();
  }

  private update(snapshot: BrushTrainingJobSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
}

interface BrushTrainingHotData {
  manager?: BrushTrainingManager;
}

const hotData = import.meta.hot?.data as BrushTrainingHotData | undefined;
const restoredManager = hotData?.manager;
if (restoredManager) Object.setPrototypeOf(restoredManager, BrushTrainingManager.prototype);

export const brushTrainingManager = restoredManager ?? new BrushTrainingManager();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    (data as BrushTrainingHotData).manager = brushTrainingManager;
  });
}
