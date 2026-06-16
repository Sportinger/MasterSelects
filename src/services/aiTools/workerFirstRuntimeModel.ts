import type {
  FrameProviderStatus,
} from '../../engine/render/contracts/frameProviderPolicy';
import type {
  RenderCacheCounters,
  RenderCacheOwner,
  RenderCacheRegistrySnapshot,
} from '../renderJobs/renderCacheRegistry';
import type {
  RenderJobPriority,
  RenderSchedulerCounters,
  RenderSchedulerJobType,
  RenderSchedulerSnapshot,
} from '../renderJobs/renderJobScheduler';
import type { WorkerFirstProofCounterSources } from './workerFirstGateInputs';
import type { WorkerFirstProofCounters } from './workerFirstProofHarness';

export type WorkerFirstRuntimeSnapshotSource =
  | 'main-host-observation'
  | 'worker-shadow'
  | 'worker-runtime';

export type WorkerFirstRuntimeJobState =
  | 'queued'
  | 'started'
  | 'completed'
  | 'canceled'
  | 'dropped'
  | 'expired';

export interface WorkerFirstRuntimeJobRecord {
  readonly jobId: string;
  readonly type: RenderSchedulerJobType;
  readonly targetId: string | null;
  readonly compositionId: string | null;
  readonly priority: RenderJobPriority;
  readonly state: WorkerFirstRuntimeJobState;
  readonly queuedAtMs: number | null;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
  readonly coalesceKey?: string;
  readonly exactFrame?: boolean;
}

export interface WorkerFirstRuntimeCacheRecord {
  readonly cacheId: string;
  readonly owner: RenderCacheOwner;
  readonly entries: number;
  readonly bytes: number;
  readonly allocations: number;
  readonly reuses: number;
  readonly evictions: number;
  readonly transfers: number;
  readonly releases: number;
  readonly leakChecks: number;
}

export interface WorkerFirstRuntimeTimingRecord {
  readonly transferLatencyMs?: number | null;
  readonly providerWaitMs?: number | null;
  readonly presentedFrameId?: string | null;
}

export interface WorkerFirstRuntimeSnapshotInput {
  readonly source: WorkerFirstRuntimeSnapshotSource;
  readonly capturedAtMs: number;
  readonly jobs?: readonly WorkerFirstRuntimeJobRecord[];
  readonly cacheEntries?: readonly WorkerFirstRuntimeCacheRecord[];
  readonly providers?: readonly FrameProviderStatus[];
  readonly timing?: WorkerFirstRuntimeTimingRecord;
  readonly schedulerCounters?: Partial<RenderSchedulerCounters>;
  readonly cacheCounters?: Partial<RenderCacheCounters>;
  readonly passes?: Partial<WorkerFirstProofCounters['passes']>;
  readonly visiblePixels?: Partial<WorkerFirstProofCounters['visiblePixels']>;
}

export interface WorkerFirstRuntimeSnapshot {
  readonly schemaVersion: 1;
  readonly source: WorkerFirstRuntimeSnapshotSource;
  readonly capturedAtMs: number;
  readonly jobs: readonly WorkerFirstRuntimeJobRecord[];
  readonly cacheEntries: readonly WorkerFirstRuntimeCacheRecord[];
  readonly providers: readonly FrameProviderStatus[];
  readonly scheduler: RenderSchedulerSnapshot;
  readonly cache: RenderCacheRegistrySnapshot;
  readonly transferLatencyMs: number | null;
  readonly providerWaitMs: number | null;
  readonly presentedFrameId: string | null;
  readonly passes: Partial<WorkerFirstProofCounters['passes']>;
  readonly visiblePixels: Partial<WorkerFirstProofCounters['visiblePixels']>;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
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

function emptySchedulerCounters(): RenderSchedulerCounters {
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

function emptyOwnerBytes(): Record<RenderCacheOwner, number> {
  return {
    'source-frame': 0,
    'hold-frame': 0,
    'composite-frame': 0,
    'subcomp-output': 0,
    'mask-texture': 0,
    'effect-plan': 0,
    'target-surface': 0,
    'bake-artifact': 0,
    thumbnail: 0,
    'export-frame': 0,
  };
}

function emptyCacheCounters(): RenderCacheCounters {
  return {
    allocations: 0,
    reuses: 0,
    evictions: 0,
    transfers: 0,
    releases: 0,
    leakChecks: 0,
  };
}

function cloneJob(record: WorkerFirstRuntimeJobRecord): WorkerFirstRuntimeJobRecord {
  return { ...record };
}

function cloneCacheRecord(record: WorkerFirstRuntimeCacheRecord): WorkerFirstRuntimeCacheRecord {
  return { ...record };
}

function cloneProvider(status: FrameProviderStatus): FrameProviderStatus {
  return {
    ...status,
    substatus: [...status.substatus],
    counters: { ...status.counters },
  };
}

function overlayCounters<T extends object>(base: T, overlay: Partial<T> | undefined): T {
  if (!overlay) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      (next as Record<string, number>)[key] = value;
    }
  }
  return next;
}

function schedulerSnapshotFromJobs(
  jobs: readonly WorkerFirstRuntimeJobRecord[],
  capturedAtMs: number,
  counterOverlay?: Partial<RenderSchedulerCounters>,
): RenderSchedulerSnapshot {
  const byPriority = emptyPriorityCounts();
  const byType = emptyTypeCounts();
  let queueDepth = 0;
  let oldestQueuedAt = Number.POSITIVE_INFINITY;
  const counters = emptySchedulerCounters();

  for (const job of jobs) {
    counters.admitted += 1;
    if (job.state === 'queued') {
      queueDepth += 1;
      counters.enqueued += 1;
      byPriority[job.priority] += 1;
      byType[job.type] += 1;
      if (typeof job.queuedAtMs === 'number' && Number.isFinite(job.queuedAtMs)) {
        oldestQueuedAt = Math.min(oldestQueuedAt, job.queuedAtMs);
      }
      continue;
    }

    if (job.state === 'started' || job.state === 'completed' || job.startedAtMs !== null) {
      counters.started += 1;
    }
    if (job.state === 'completed') counters.completed += 1;
    if (job.state === 'canceled') counters.canceled += 1;
    if (job.state === 'dropped') counters.dropped += 1;
    if (job.state === 'expired') counters.expired += 1;
  }

  return {
    queueDepth,
    byPriority,
    byType,
    oldestCommandAgeMs: Number.isFinite(oldestQueuedAt) ? Math.max(0, capturedAtMs - oldestQueuedAt) : 0,
    counters: overlayCounters(counters, counterOverlay),
  };
}

function cacheSnapshotFromRecords(
  records: readonly WorkerFirstRuntimeCacheRecord[],
  counterOverlay?: Partial<RenderCacheCounters>,
): RenderCacheRegistrySnapshot {
  const bytesByOwner = emptyOwnerBytes();
  const counters = emptyCacheCounters();
  let entries = 0;
  let bytes = 0;

  for (const record of records) {
    const recordEntries = nonNegativeInteger(record.entries);
    const recordBytes = positive(record.bytes);
    entries += recordEntries;
    bytes += recordBytes;
    bytesByOwner[record.owner] += recordBytes;
    counters.allocations += nonNegativeInteger(record.allocations);
    counters.reuses += nonNegativeInteger(record.reuses);
    counters.evictions += nonNegativeInteger(record.evictions);
    counters.transfers += nonNegativeInteger(record.transfers);
    counters.releases += nonNegativeInteger(record.releases);
    counters.leakChecks += nonNegativeInteger(record.leakChecks);
  }

  return {
    entries,
    bytes,
    bytesByOwner,
    counters: overlayCounters(counters, counterOverlay),
  };
}

export function createWorkerFirstRuntimeSnapshot(
  input: WorkerFirstRuntimeSnapshotInput,
): WorkerFirstRuntimeSnapshot {
  const jobs = (input.jobs ?? []).map(cloneJob);
  const cacheEntries = (input.cacheEntries ?? []).map(cloneCacheRecord);
  const providers = (input.providers ?? []).map(cloneProvider);

  return {
    schemaVersion: 1,
    source: input.source,
    capturedAtMs: input.capturedAtMs,
    jobs,
    cacheEntries,
    providers,
    scheduler: schedulerSnapshotFromJobs(jobs, input.capturedAtMs, input.schedulerCounters),
    cache: cacheSnapshotFromRecords(cacheEntries, input.cacheCounters),
    transferLatencyMs: input.timing?.transferLatencyMs ?? null,
    providerWaitMs: input.timing?.providerWaitMs ?? null,
    presentedFrameId: input.timing?.presentedFrameId ?? null,
    passes: { ...(input.passes ?? {}) },
    visiblePixels: { ...(input.visiblePixels ?? {}) },
  };
}

export function workerFirstRuntimeSnapshotToCounterSources(
  snapshot: WorkerFirstRuntimeSnapshot,
): WorkerFirstProofCounterSources {
  return {
    scheduler: {
      ...snapshot.scheduler,
      byPriority: { ...snapshot.scheduler.byPriority },
      byType: { ...snapshot.scheduler.byType },
      counters: { ...snapshot.scheduler.counters },
    },
    cache: {
      ...snapshot.cache,
      bytesByOwner: { ...snapshot.cache.bytesByOwner },
      counters: { ...snapshot.cache.counters },
    },
    providers: snapshot.providers.map(cloneProvider),
    transferLatencyMs: snapshot.transferLatencyMs,
    providerWaitMs: snapshot.providerWaitMs,
    presentedFrameId: snapshot.presentedFrameId,
    passes: { ...snapshot.passes },
    visiblePixels: { ...snapshot.visiblePixels },
  };
}
