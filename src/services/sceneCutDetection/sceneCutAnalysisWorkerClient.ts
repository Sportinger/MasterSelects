import type { SceneCutAnalysis } from '../../types/sceneCutAnalysis';

interface AnalyzedMessage {
  type: 'analyzed';
  requestId: number;
}

interface CompleteMessage {
  type: 'complete';
  analysis: SceneCutAnalysis;
}

interface ErrorMessage {
  type: 'error';
  requestId?: number;
  message: string;
}

type WorkerMessage = AnalyzedMessage | CompleteMessage | ErrorMessage;

export class SceneCutAnalysisWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 1;
  private nextFrameNumber = 0;
  private pendingCount = 0;
  private failure: Error | null = null;
  private disposed = false;
  private backpressureWaiters: Array<{
    maximum: number;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private completeResolve: ((analysis: SceneCutAnalysis) => void) | null = null;
  private completeReject: ((error: Error) => void) | null = null;

  constructor() {
    this.worker = new Worker(
      new URL('../../workers/sceneCutAnalysisWorker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      this.handleMessage(event.data);
    };
    this.worker.onerror = (event) => {
      this.fail(new Error(event.message || 'Scene-cut analysis worker failed.'));
    };
  }

  analyze(frame: VideoFrame): void {
    if (this.disposed || this.failure) return;

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    let workerFrame: VideoFrame | null = null;
    try {
      workerFrame = frame.clone();
      this.pendingCount += 1;
      this.worker.postMessage(
        {
          type: 'analyze',
          requestId,
          frameNumber: this.nextFrameNumber,
          frame: workerFrame,
        },
        [workerFrame as unknown as Transferable],
      );
      workerFrame = null;
      this.nextFrameNumber += 1;
    } catch (error) {
      if (workerFrame) {
        try {
          workerFrame.close();
        } catch {
          // Ignore close errors after a failed transfer.
        }
      }
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  waitForBackpressure(maximum = 8): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pendingCount <= maximum) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.backpressureWaiters.push({ maximum, resolve, reject });
    });
  }

  complete(
    duration: number,
    expectedSourceFrameCount: number,
    sourceFingerprint: { size: number; lastModified: number },
  ): Promise<SceneCutAnalysis> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.disposed) {
      return Promise.reject(new Error('Scene-cut analysis worker was disposed.'));
    }
    return new Promise((resolve, reject) => {
      this.completeResolve = resolve;
      this.completeReject = reject;
      this.worker.postMessage({
        type: 'complete',
        duration,
        expectedSourceFrameCount,
        sourceFingerprint,
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('Scene-cut analysis worker was disposed.');
    this.worker.terminate();
    this.completeReject?.(error);
    this.rejectBackpressure(error);
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.type === 'error') {
      this.fail(new Error(message.message));
      return;
    }
    if (message.type === 'complete') {
      this.completeResolve?.(message.analysis);
      this.completeResolve = null;
      this.completeReject = null;
      return;
    }

    this.pendingCount = Math.max(0, this.pendingCount - 1);
    this.releaseBackpressure();
  }

  private releaseBackpressure(): void {
    const waiting = this.backpressureWaiters;
    this.backpressureWaiters = [];
    for (const waiter of waiting) {
      if (this.pendingCount <= waiter.maximum) {
        waiter.resolve();
      } else {
        this.backpressureWaiters.push(waiter);
      }
    }
  }

  private rejectBackpressure(error: Error): void {
    for (const waiter of this.backpressureWaiters) {
      waiter.reject(error);
    }
    this.backpressureWaiters = [];
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.completeReject?.(error);
    this.completeResolve = null;
    this.completeReject = null;
    this.rejectBackpressure(error);
  }
}
