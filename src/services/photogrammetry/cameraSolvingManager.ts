import type {
  CameraSolveDataset,
  CameraSolveSourceContext,
  CameraSolvingController,
  CameraSolvingSnapshot,
} from './cameraSolvingContract';
import { loadLatestCameraSolve, persistLatestCameraSolve } from './cameraSolveProjectStorage';
import { solveScanCameras } from './cameraSolvingRuntime';
import { sampleScanVideoWithTimes } from './videoFrameSampler';

export interface CameraVideoSolveRequest {
  file: File;
  datasetName: string;
  frameCount: number;
  sourceImageMaxSide: number;
  featureImageMaxSide: number;
  sourceStart: number;
  sourceEnd: number;
  source: CameraSolveSourceContext;
}

export interface CameraSolvingJobSnapshot {
  datasetName: string | null;
  sampling: { current: number; total: number } | null;
  solving: CameraSolvingSnapshot | null;
  isStarting: boolean;
  hasResult: boolean;
  persistence: 'none' | 'memory' | 'project';
  error: string | null;
}

type CameraSolvingStarter = typeof solveScanCameras;
type CameraSolvingListener = () => void;

const EMPTY_JOB: CameraSolvingJobSnapshot = {
  datasetName: null,
  sampling: null,
  solving: null,
  isStarting: false,
  hasResult: false,
  persistence: 'none',
  error: null,
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns the SfM workers so switching panels does not interrupt camera solving. */
export class CameraSolvingManager {
  private starter: CameraSolvingStarter;
  private controller: CameraSolvingController | null = null;
  private samplingController: AbortController | null = null;
  private listeners = new Set<CameraSolvingListener>();
  private result: CameraSolveDataset | null = null;
  private jobId = 0;
  private snapshot: CameraSolvingJobSnapshot = EMPTY_JOB;
  private schemaVersion = 3;

  constructor(starter: CameraSolvingStarter = solveScanCameras) {
    this.starter = starter;
  }

  readonly getSnapshot = (): CameraSolvingJobSnapshot => this.snapshot;

  readonly subscribe = (listener: CameraSolvingListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(
    files: File[],
    datasetName: string,
    maxImageSide: number,
    source: CameraSolveSourceContext | null = null,
  ): Promise<CameraSolveDataset | null> {
    const jobId = ++this.jobId;
    this.stopActiveWork();
    this.result = null;
    this.update({ datasetName, sampling: null, solving: null, isStarting: true, hasResult: false, persistence: 'none', error: null });
    return this.solveFiles(jobId, files, datasetName, maxImageSide, source);
  }

  async startVideo(request: CameraVideoSolveRequest): Promise<CameraSolveDataset | null> {
    const jobId = ++this.jobId;
    this.stopActiveWork();
    this.result = null;
    const samplingController = new AbortController();
    this.samplingController = samplingController;
    this.update({
      datasetName: request.datasetName,
      sampling: { current: 0, total: request.frameCount },
      solving: null,
      isStarting: true,
      hasResult: false,
      persistence: 'none',
      error: null,
    });
    try {
      const frames = await sampleScanVideoWithTimes(request.file, {
        frameCount: request.frameCount,
        maxResolution: request.sourceImageMaxSide,
        startTime: request.sourceStart,
        endTime: request.sourceEnd,
        frameRate: request.source.frameRate,
        signal: samplingController.signal,
        onProgress: (current, total) => {
          if (jobId !== this.jobId) return;
          this.update({ ...this.snapshot, sampling: { current, total } });
        },
      });
      if (jobId !== this.jobId) return null;
      this.samplingController = null;
      const sourceSpan = Math.max(0.001, request.sourceEnd - request.sourceStart);
      const frameRate = request.source.frameRate && request.source.frameRate > 0
        ? request.source.frameRate
        : null;
      const source = {
        ...request.source,
        sampleTimes: frames.map((frame) => {
          const localTime = Math.max(
            0,
            Math.min(
              request.source.clipDuration ?? sourceSpan,
              ((frame.sourceTime - request.sourceStart) / sourceSpan)
                * (request.source.clipDuration ?? sourceSpan),
            ),
          );
          return frameRate ? Math.round(localTime * frameRate) / frameRate : localTime;
        }),
      };
      this.update({ ...this.snapshot, sampling: null });
      return this.solveFiles(
        jobId,
        frames.map((frame) => frame.file),
        request.datasetName,
        request.featureImageMaxSide,
        source,
      );
    } catch (error) {
      if (jobId !== this.jobId) return null;
      this.samplingController = null;
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.update({ ...this.snapshot, sampling: null, isStarting: false });
        return null;
      }
      this.update({
        ...this.snapshot,
        sampling: null,
        isStarting: false,
        error: describeError(error),
      });
      return null;
    }
  }

  private async solveFiles(
    jobId: number,
    files: File[],
    datasetName: string,
    maxImageSide: number,
    source: CameraSolveSourceContext | null,
  ): Promise<CameraSolveDataset | null> {
    const controller = this.starter(files, datasetName, maxImageSide, (solving) => {
      if (jobId !== this.jobId) return;
      this.update({ ...this.snapshot, sampling: null, solving, isStarting: false });
    }, source);
    this.controller = controller;
    try {
      const result = await controller.result;
      if (jobId !== this.jobId) return null;
      this.result = result;
      this.controller = null;
      this.update({ ...this.snapshot, isStarting: false, hasResult: true, persistence: 'memory' });
      const saved = await persistLatestCameraSolve(result).catch(() => false);
      if (jobId === this.jobId && saved) {
        this.update({ ...this.snapshot, persistence: 'project' });
      }
      return result;
    } catch (error) {
      if (jobId !== this.jobId) return null;
      this.controller = null;
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.update({ ...this.snapshot, isStarting: false });
        return null;
      }
      this.update({ ...this.snapshot, isStarting: false, error: describeError(error) });
      return null;
    }
  }

  getResultFiles(): File[] | null {
    return this.result?.files ?? null;
  }

  getResult(): CameraSolveDataset | null {
    return this.result;
  }

  async loadLatest(): Promise<CameraSolveDataset | null> {
    if (this.controller) return this.result;
    const jobId = ++this.jobId;
    this.update({ ...this.snapshot, isStarting: true, error: null });
    try {
      const result = await loadLatestCameraSolve();
      if (jobId !== this.jobId) return null;
      this.result = result;
      this.update({
        ...this.snapshot,
        datasetName: result?.model.datasetName ?? null,
        isStarting: false,
        hasResult: Boolean(result),
        persistence: result ? 'project' : 'none',
      });
      return result;
    } catch (error) {
      if (jobId !== this.jobId) return null;
      this.update({ ...this.snapshot, isStarting: false, error: describeError(error) });
      return null;
    }
  }

  cancel(): void {
    this.samplingController?.abort();
    this.controller?.cancel();
  }

  reset(): void {
    ++this.jobId;
    this.stopActiveWork();
    this.result = null;
    this.update(EMPTY_JOB);
  }

  refreshAfterHmr(starter: CameraSolvingStarter): void {
    this.starter = starter;
    if (this.schemaVersion === 3) return;
    if (this.schemaVersion === 2) {
      this.schemaVersion = 3;
      this.samplingController = null;
      this.update({ ...this.snapshot, sampling: null });
      return;
    }
    // Pre-project-backed manager shapes cannot be promoted safely.
    this.schemaVersion = 3;
    ++this.jobId;
    this.stopActiveWork();
    this.result = null;
    this.update(EMPTY_JOB);
  }

  private update(snapshot: CameraSolvingJobSnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  private stopActiveWork(): void {
    this.samplingController?.abort();
    this.samplingController = null;
    this.controller?.cancel();
    this.controller = null;
  }
}

interface CameraSolvingHotData {
  manager?: CameraSolvingManager;
}

const hotData = import.meta.hot?.data as CameraSolvingHotData | undefined;
const restoredManager = hotData?.manager;
if (restoredManager) {
  Object.setPrototypeOf(restoredManager, CameraSolvingManager.prototype);
  restoredManager.refreshAfterHmr(solveScanCameras);
}

export const cameraSolvingManager = restoredManager ?? new CameraSolvingManager();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    (data as CameraSolvingHotData).manager = cameraSolvingManager;
  });
}
