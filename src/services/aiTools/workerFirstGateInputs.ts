import type { FrameProviderStatus } from '../../engine/render/contracts/frameProviderPolicy';
import type { RenderCacheRegistrySnapshot } from '../renderJobs/renderCacheRegistry';
import type { RenderSchedulerSnapshot } from '../renderJobs/renderJobScheduler';
import type { WorkerFirstProofCounters } from './workerFirstProofHarness';

export interface WorkerFirstProofCounterSources {
  readonly scheduler?: RenderSchedulerSnapshot | null;
  readonly cache?: RenderCacheRegistrySnapshot | null;
  readonly providers?: readonly FrameProviderStatus[] | null;
  readonly transferLatencyMs?: number | null;
  readonly providerWaitMs?: number | null;
  readonly presentedFrameId?: string | null;
  readonly passes?: Partial<WorkerFirstProofCounters['passes']>;
  readonly visiblePixels?: Partial<WorkerFirstProofCounters['visiblePixels']>;
}

export function createEmptyWorkerFirstProofCounters(): WorkerFirstProofCounters {
  return {
    queueDepth: 0,
    transferLatencyMs: null,
    providerWaitMs: null,
    presentedFrameId: null,
    frameLifetime: {
      outstanding: 0,
      created: 0,
      cloned: 0,
      transferred: 0,
      imported: 0,
      cached: 0,
      released: 0,
      closed: 0,
      lateClosed: 0,
      leaked: 0,
      fallbackUsed: 0,
    },
    passes: {
      graphNodesEmitted: 0,
      graphNodesExecuted: 0,
      graphNodesDeduped: 0,
      graphNodesSkipped: 0,
      passCount: 0,
      effectPassCount: 0,
      duplicatePassCount: 0,
    },
    cache: {
      hits: 0,
      misses: 0,
      evictions: 0,
      vramPeakBytes: 0,
    },
    visiblePixels: {
      nonBlankRatio: null,
      blackFrameCount: 0,
      freezeCount: 0,
      staleVisibleFrameCount: 0,
    },
  };
}

function collectFrameLifetime(providers: readonly FrameProviderStatus[]): WorkerFirstProofCounters['frameLifetime'] {
  const frameLifetime = {
    outstanding: 0,
    created: 0,
    cloned: 0,
    transferred: 0,
    imported: 0,
    cached: 0,
    released: 0,
    closed: 0,
    lateClosed: 0,
    leaked: 0,
    fallbackUsed: 0,
  };
  for (const provider of providers) {
    frameLifetime.outstanding += provider.outstandingFrameCount;
    frameLifetime.created += provider.counters.created;
    frameLifetime.cloned += provider.counters.cloned;
    frameLifetime.transferred += provider.counters.transferred;
    frameLifetime.imported += provider.counters.imported;
    frameLifetime.cached += provider.counters.cached;
    frameLifetime.released += provider.counters.released;
    frameLifetime.closed += provider.counters.closed;
    frameLifetime.lateClosed += provider.counters.lateClosed;
    frameLifetime.leaked += provider.counters.leaked;
    frameLifetime.fallbackUsed += provider.counters.fallbackUsed;
  }
  return frameLifetime;
}

export function buildWorkerFirstProofCounters(
  sources: WorkerFirstProofCounterSources = {},
): WorkerFirstProofCounters {
  const counters = createEmptyWorkerFirstProofCounters();
  const providers = sources.providers ?? [];

  return {
    queueDepth: sources.scheduler?.queueDepth ?? counters.queueDepth,
    transferLatencyMs: sources.transferLatencyMs ?? counters.transferLatencyMs,
    providerWaitMs: sources.providerWaitMs ?? counters.providerWaitMs,
    presentedFrameId: sources.presentedFrameId ?? counters.presentedFrameId,
    frameLifetime: providers.length > 0
      ? collectFrameLifetime(providers)
      : counters.frameLifetime,
    passes: {
      ...counters.passes,
      ...sources.passes,
    },
    cache: {
      hits: sources.cache?.counters.reuses ?? counters.cache.hits,
      misses: sources.cache?.counters.allocations ?? counters.cache.misses,
      evictions: sources.cache?.counters.evictions ?? counters.cache.evictions,
      vramPeakBytes: sources.cache?.bytes ?? counters.cache.vramPeakBytes,
    },
    visiblePixels: {
      ...counters.visiblePixels,
      ...sources.visiblePixels,
    },
  };
}
