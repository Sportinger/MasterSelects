import type { FrameProviderStatus } from '../../engine/render/contracts/frameProviderPolicy';
import type { RenderCacheRegistrySnapshot } from '../renderJobs/renderCacheRegistry';
import type { RenderSchedulerSnapshot } from '../renderJobs/renderJobScheduler';
import type { WorkerFirstProofCounters } from './workerFirstProofHarness';
import type { WorkerFirstProofCounterSources } from './workerFirstGateInputs';

export interface WorkerFirstRuntimeCounterSourceSnapshot {
  readonly scheduler: RenderSchedulerSnapshot | null;
  readonly cache: RenderCacheRegistrySnapshot | null;
  readonly providers: readonly FrameProviderStatus[];
  readonly transferLatencyMs: number | null;
  readonly providerWaitMs: number | null;
  readonly presentedFrameId: string | null;
  readonly visiblePixels: Partial<WorkerFirstProofCounters['visiblePixels']>;
  readonly updatedAt: number | null;
}

let schedulerSnapshot: RenderSchedulerSnapshot | null = null;
let cacheSnapshot: RenderCacheRegistrySnapshot | null = null;
let providerStatuses: FrameProviderStatus[] = [];
let transferLatencyMs: number | null = null;
let providerWaitMs: number | null = null;
let presentedFrameId: string | null = null;
let visiblePixels: Partial<WorkerFirstProofCounters['visiblePixels']> = {};
let updatedAt: number | null = null;

function touch(timestamp = Date.now()): number {
  updatedAt = Math.max(updatedAt ?? 0, timestamp);
  return timestamp;
}

function cloneScheduler(snapshot: RenderSchedulerSnapshot | null): RenderSchedulerSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    byPriority: { ...snapshot.byPriority },
    byType: { ...snapshot.byType },
    counters: { ...snapshot.counters },
  };
}

function cloneCache(snapshot: RenderCacheRegistrySnapshot | null): RenderCacheRegistrySnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    bytesByOwner: { ...snapshot.bytesByOwner },
    counters: { ...snapshot.counters },
  };
}

function cloneProvider(status: FrameProviderStatus): FrameProviderStatus {
  return {
    ...status,
    substatus: [...status.substatus],
    counters: { ...status.counters },
  };
}

export function clearWorkerFirstCounterSources(): void {
  schedulerSnapshot = null;
  cacheSnapshot = null;
  providerStatuses = [];
  transferLatencyMs = null;
  providerWaitMs = null;
  presentedFrameId = null;
  visiblePixels = {};
  updatedAt = null;
}

export function clearWorkerFirstCounterSourcesForTests(): void {
  clearWorkerFirstCounterSources();
}

export function recordWorkerFirstSchedulerSnapshot(
  snapshot: RenderSchedulerSnapshot,
  capturedAt?: number,
): void {
  touch(capturedAt);
  schedulerSnapshot = cloneScheduler(snapshot);
}

export function recordWorkerFirstCacheSnapshot(
  snapshot: RenderCacheRegistrySnapshot,
  capturedAt?: number,
): void {
  touch(capturedAt);
  cacheSnapshot = cloneCache(snapshot);
}

export function recordWorkerFirstProviderStatuses(
  statuses: readonly FrameProviderStatus[],
  capturedAt?: number,
): void {
  touch(capturedAt);
  providerStatuses = statuses.map(cloneProvider);
}

export function recordWorkerFirstTimingCounters(input: {
  readonly transferLatencyMs?: number | null;
  readonly providerWaitMs?: number | null;
  readonly presentedFrameId?: string | null;
}, capturedAt?: number): void {
  touch(capturedAt);
  if ('transferLatencyMs' in input) {
    transferLatencyMs = input.transferLatencyMs ?? null;
  }
  if ('providerWaitMs' in input) {
    providerWaitMs = input.providerWaitMs ?? null;
  }
  if ('presentedFrameId' in input) {
    presentedFrameId = input.presentedFrameId ?? null;
  }
}

export function recordWorkerFirstVisiblePixelCounters(
  input: Partial<WorkerFirstProofCounters['visiblePixels']>,
  capturedAt?: number,
): void {
  touch(capturedAt);
  visiblePixels = { ...input };
}

export function recordWorkerFirstCounterSources(
  sources: WorkerFirstProofCounterSources,
  capturedAt?: number,
): void {
  touch(capturedAt);
  schedulerSnapshot = cloneScheduler(sources.scheduler ?? null);
  cacheSnapshot = cloneCache(sources.cache ?? null);
  providerStatuses = (sources.providers ?? []).map(cloneProvider);
  transferLatencyMs = sources.transferLatencyMs ?? null;
  providerWaitMs = sources.providerWaitMs ?? null;
  presentedFrameId = sources.presentedFrameId ?? null;
  visiblePixels = { ...(sources.visiblePixels ?? {}) };
}

export function getWorkerFirstCounterSourceSnapshot(): WorkerFirstRuntimeCounterSourceSnapshot {
  return {
    scheduler: cloneScheduler(schedulerSnapshot),
    cache: cloneCache(cacheSnapshot),
    providers: providerStatuses.map(cloneProvider),
    transferLatencyMs,
    providerWaitMs,
    presentedFrameId,
    visiblePixels: { ...visiblePixels },
    updatedAt,
  };
}

export function getWorkerFirstCounterSources(): WorkerFirstProofCounterSources {
  return {
    scheduler: cloneScheduler(schedulerSnapshot),
    cache: cloneCache(cacheSnapshot),
    providers: providerStatuses.map(cloneProvider),
    transferLatencyMs,
    providerWaitMs,
    presentedFrameId,
    visiblePixels: { ...visiblePixels },
  };
}
