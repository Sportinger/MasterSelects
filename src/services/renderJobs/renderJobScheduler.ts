export type RenderJobPriority = 'critical' | 'high' | 'normal' | 'low' | 'idle';

export type RenderSchedulerJobType =
  | 'live-playback'
  | 'scrub'
  | 'independent-preview'
  | 'ram-preview'
  | 'thumbnail'
  | 'clip-bake'
  | 'composition-bake'
  | 'export';

export interface RenderSchedulerJob {
  readonly id: string;
  readonly type: RenderSchedulerJobType;
  readonly targetId: string | null;
  readonly compositionId: string;
  readonly priority: RenderJobPriority;
  readonly createdAt: number;
  readonly coalesceKey?: string;
  readonly exactFrame?: boolean;
}

export interface RenderSchedulerCounters {
  admitted: number;
  enqueued: number;
  started: number;
  completed: number;
  canceled: number;
  coalesced: number;
  dropped: number;
  expired: number;
  late: number;
  staleResponses: number;
  resizeCoalesced: number;
  priorityInversions: number;
}

export interface RenderSchedulerSnapshot {
  readonly queueDepth: number;
  readonly byPriority: Readonly<Record<RenderJobPriority, number>>;
  readonly byType: Readonly<Record<RenderSchedulerJobType, number>>;
  readonly oldestCommandAgeMs: number;
  readonly counters: Readonly<RenderSchedulerCounters>;
}

export interface RenderTargetResizeRequest {
  readonly targetId: string;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly requestedAt: number;
}

const PRIORITY_ORDER: Record<RenderJobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  idle: 4,
};

function createCounters(): RenderSchedulerCounters {
  return {
    admitted: 0,
    enqueued: 0,
    started: 0,
    completed: 0,
    canceled: 0,
    coalesced: 0,
    dropped: 0,
    expired: 0,
    late: 0,
    staleResponses: 0,
    resizeCoalesced: 0,
    priorityInversions: 0,
  };
}

function emptyPriorityCounts(): Record<RenderJobPriority, number> {
  return { critical: 0, high: 0, normal: 0, low: 0, idle: 0 };
}

function emptyTypeCounts(): Record<RenderSchedulerJobType, number> {
  return {
    'live-playback': 0,
    scrub: 0,
    'independent-preview': 0,
    'ram-preview': 0,
    thumbnail: 0,
    'clip-bake': 0,
    'composition-bake': 0,
    export: 0,
  };
}

function shouldCoalesce(existing: RenderSchedulerJob, next: RenderSchedulerJob): boolean {
  if (next.exactFrame) return false;
  if (!next.coalesceKey || existing.coalesceKey !== next.coalesceKey) return false;
  return next.type === 'scrub' || next.type === 'live-playback' || next.type === 'independent-preview';
}

export class RenderJobScheduler {
  private queue: RenderSchedulerJob[] = [];
  private active: RenderSchedulerJob | null = null;
  private readonly counters = createCounters();
  private readonly pendingResizes = new Map<string, RenderTargetResizeRequest>();

  enqueue(job: RenderSchedulerJob): RenderSchedulerJob {
    this.counters.admitted += 1;
    const existingIndex = this.queue.findIndex((entry) => shouldCoalesce(entry, job));
    if (existingIndex >= 0) {
      this.queue.splice(existingIndex, 1, job);
      this.counters.coalesced += 1;
      this.sortQueue();
      return job;
    }

    this.queue.push(job);
    this.counters.enqueued += 1;
    this.sortQueue();
    return job;
  }

  coalesceResize(request: RenderTargetResizeRequest): void {
    if (this.pendingResizes.has(request.targetId)) {
      this.counters.resizeCoalesced += 1;
    }
    this.pendingResizes.set(request.targetId, request);
  }

  consumeResize(targetId: string): RenderTargetResizeRequest | null {
    const request = this.pendingResizes.get(targetId) ?? null;
    this.pendingResizes.delete(targetId);
    return request;
  }

  startNext(now = performance.now()): RenderSchedulerJob | null {
    const next = this.queue.shift() ?? null;
    if (!next) return null;
    this.active = next;
    this.counters.started += 1;
    if (this.queue.some((job) => PRIORITY_ORDER[job.priority] < PRIORITY_ORDER[next.priority])) {
      this.counters.priorityInversions += 1;
    }
    if (now - next.createdAt > 1000 && !next.exactFrame) {
      this.counters.late += 1;
    }
    return next;
  }

  complete(jobId: string): boolean {
    if (this.active?.id !== jobId) {
      this.counters.staleResponses += 1;
      return false;
    }
    this.active = null;
    this.counters.completed += 1;
    return true;
  }

  cancel(jobId: string): boolean {
    if (this.active?.id === jobId) {
      this.active = null;
      this.counters.canceled += 1;
      return true;
    }
    const before = this.queue.length;
    this.queue = this.queue.filter((job) => job.id !== jobId);
    const canceled = before !== this.queue.length;
    if (canceled) this.counters.canceled += 1;
    return canceled;
  }

  drain(reason: 'cancel' | 'drop' | 'expire'): void {
    const count = this.queue.length + (this.active ? 1 : 0);
    this.queue = [];
    this.active = null;
    if (reason === 'cancel') this.counters.canceled += count;
    if (reason === 'drop') this.counters.dropped += count;
    if (reason === 'expire') this.counters.expired += count;
  }

  snapshot(now = performance.now()): RenderSchedulerSnapshot {
    const byPriority = emptyPriorityCounts();
    const byType = emptyTypeCounts();
    for (const job of this.queue) {
      byPriority[job.priority] += 1;
      byType[job.type] += 1;
    }
    const oldest = this.queue.reduce((min, job) => Math.min(min, job.createdAt), Number.POSITIVE_INFINITY);
    return {
      queueDepth: this.queue.length,
      byPriority,
      byType,
      oldestCommandAgeMs: Number.isFinite(oldest) ? Math.max(0, now - oldest) : 0,
      counters: { ...this.counters },
    };
  }

  private sortQueue(): void {
    this.queue = this.queue.toSorted((a, b) => {
      const priorityDelta = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return priorityDelta !== 0 ? priorityDelta : a.createdAt - b.createdAt;
    });
  }
}
