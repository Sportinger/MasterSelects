import type { ClipAudioAnalysisJobKind } from '../../types/audio';

export type ClipAudioAnalysisJobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface ClipAudioAnalysisJobRequest {
  clipId: string;
  kind: ClipAudioAnalysisJobKind;
  replaceExisting?: boolean;
}

export interface ClipAudioAnalysisJobContext {
  clipId: string;
  kind: ClipAudioAnalysisJobKind;
  signal: AbortSignal;
  queuedForMs: number;
}

export interface ClipAudioAnalysisJobSnapshot {
  key: string;
  clipId: string;
  kind: ClipAudioAnalysisJobKind;
  status: ClipAudioAnalysisJobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

type QueuedJob<T> = ClipAudioAnalysisJobSnapshot & {
  controller: AbortController;
  work: (context: ClipAudioAnalysisJobContext) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export class ClipAudioAnalysisJobCancelledError extends Error {
  readonly clipId: string;
  readonly kind: ClipAudioAnalysisJobKind;

  constructor(clipId: string, kind: ClipAudioAnalysisJobKind, message = 'Audio analysis job cancelled') {
    super(message);
    this.name = 'ClipAudioAnalysisJobCancelledError';
    this.clipId = clipId;
    this.kind = kind;
  }
}

export function isClipAudioAnalysisJobCancelledError(error: unknown): error is ClipAudioAnalysisJobCancelledError {
  return error instanceof ClipAudioAnalysisJobCancelledError
    || (
      Boolean(error)
      && typeof error === 'object'
      && (error as { name?: unknown }).name === 'ClipAudioAnalysisJobCancelledError'
    );
}

function jobKey(clipId: string, kind: ClipAudioAnalysisJobKind): string {
  return `${clipId}:${kind}`;
}

export class ClipAudioAnalysisJobService {
  private readonly maxConcurrent: number;
  private readonly queued: QueuedJob<unknown>[] = [];
  private readonly jobs = new Map<string, QueuedJob<unknown>>();
  private runningCount = 0;

  constructor(options: { maxConcurrent?: number } = {}) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent ?? 2));
  }

  run<T>(
    request: ClipAudioAnalysisJobRequest,
    work: (context: ClipAudioAnalysisJobContext) => Promise<T>,
  ): Promise<T> {
    const key = jobKey(request.clipId, request.kind);
    if (request.replaceExisting !== false) {
      this.cancelJob(request.clipId, request.kind);
    } else if (this.jobs.has(key)) {
      return Promise.reject(new Error(`Audio analysis job already exists: ${key}`));
    }

    return new Promise<T>((resolve, reject) => {
      const queuedAt = Date.now();
      const queuedJob: QueuedJob<T> = {
        key,
        clipId: request.clipId,
        kind: request.kind,
        status: 'queued',
        queuedAt,
        controller: new AbortController(),
        work,
        resolve,
        reject,
      };
      this.jobs.set(key, queuedJob as QueuedJob<unknown>);
      this.queued.push(queuedJob as QueuedJob<unknown>);
      this.pump();
    });
  }

  cancelJob(clipId: string, kind: ClipAudioAnalysisJobKind): boolean {
    const key = jobKey(clipId, kind);
    const job = this.jobs.get(key);
    if (!job) {
      return false;
    }

    const cancellation = new ClipAudioAnalysisJobCancelledError(clipId, kind);
    job.controller.abort(cancellation);

    if (job.status === 'queued') {
      const index = this.queued.findIndex((candidate) => candidate.key === key);
      if (index >= 0) {
        this.queued.splice(index, 1);
      }
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      this.jobs.delete(key);
      job.reject(cancellation);
    }

    return true;
  }

  cancelClip(clipId: string): number {
    const matching = [...this.jobs.values()].filter((job) => job.clipId === clipId);
    for (const job of matching) {
      this.cancelJob(job.clipId, job.kind);
    }
    return matching.length;
  }

  getSnapshot(): ClipAudioAnalysisJobSnapshot[] {
    return [...this.jobs.values()].map((job) => ({
      key: job.key,
      clipId: job.clipId,
      kind: job.kind,
      status: job.status,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }));
  }

  reset(): void {
    for (const job of [...this.jobs.values()]) {
      this.cancelJob(job.clipId, job.kind);
    }
    this.queued.length = 0;
    this.jobs.clear();
    this.runningCount = 0;
  }

  private pump(): void {
    while (this.runningCount < this.maxConcurrent && this.queued.length > 0) {
      const job = this.queued.shift();
      if (!job || job.controller.signal.aborted) {
        continue;
      }

      this.start(job);
    }
  }

  private start(job: QueuedJob<unknown>): void {
    job.status = 'running';
    job.startedAt = Date.now();
    this.runningCount += 1;

    const context: ClipAudioAnalysisJobContext = {
      clipId: job.clipId,
      kind: job.kind,
      signal: job.controller.signal,
      queuedForMs: job.startedAt - job.queuedAt,
    };

    job.work(context)
      .then((result) => {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'completed';
        job.finishedAt = Date.now();
        if (job.controller.signal.aborted) {
          job.reject(job.controller.signal.reason ?? new ClipAudioAnalysisJobCancelledError(job.clipId, job.kind));
        } else {
          job.resolve(result);
        }
      })
      .catch((error) => {
        job.status = job.controller.signal.aborted || isClipAudioAnalysisJobCancelledError(error)
          ? 'cancelled'
          : 'failed';
        job.finishedAt = Date.now();
        job.reject(error);
      })
      .finally(() => {
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.jobs.delete(job.key);
        this.pump();
      });
  }
}

export const clipAudioAnalysisJobService = new ClipAudioAnalysisJobService();
