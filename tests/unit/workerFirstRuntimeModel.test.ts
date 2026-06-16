import { describe, expect, it } from 'vitest';

import {
  createEmptyFrameProviderCounters,
  type FrameProviderStatus,
} from '../../src/engine/render/contracts/frameProviderPolicy';
import {
  buildWorkerFirstProofCounters,
} from '../../src/services/aiTools/workerFirstGateInputs';
import {
  createWorkerFirstRuntimeSnapshot,
  workerFirstRuntimeSnapshotToCounterSources,
  type WorkerFirstRuntimeCacheRecord,
  type WorkerFirstRuntimeJobRecord,
} from '../../src/services/aiTools/workerFirstRuntimeModel';

function job(overrides: Partial<WorkerFirstRuntimeJobRecord>): WorkerFirstRuntimeJobRecord {
  return {
    jobId: 'job-a',
    type: 'independent-preview',
    targetId: 'preview',
    compositionId: 'comp-a',
    priority: 'normal',
    state: 'queued',
    queuedAtMs: 10,
    startedAtMs: null,
    finishedAtMs: null,
    ...overrides,
  };
}

function cacheEntry(overrides: Partial<WorkerFirstRuntimeCacheRecord>): WorkerFirstRuntimeCacheRecord {
  return {
    cacheId: 'cache-a',
    owner: 'source-frame',
    entries: 1,
    bytes: 1024,
    allocations: 1,
    reuses: 0,
    evictions: 0,
    transfers: 0,
    releases: 0,
    leakChecks: 0,
    ...overrides,
  };
}

function provider(): FrameProviderStatus {
  return {
    providerId: 'provider-a',
    sourceId: 'source-a',
    sourceKind: 'webcodecs',
    sessionKey: 'source-a:session',
    generation: 1,
    requestId: 'request-a',
    state: 'ready',
    substatus: [],
    mediaTime: 1,
    frameTimestamp: 1,
    freshness: 'fresh',
    deadlineTimeMs: 100,
    priority: 'high',
    outstandingFrameCount: 2,
    lastDropReason: null,
    fallbackUsed: false,
    counters: {
      ...createEmptyFrameProviderCounters(),
      created: 3,
      transferred: 2,
      imported: 2,
      cached: 1,
      released: 1,
      closed: 1,
    },
  };
}

describe('worker-first runtime model', () => {
  it('derives scheduler, cache, provider, timing, pass, and visible counters from explicit records', () => {
    const queued = job({
      jobId: 'queued-scrub',
      type: 'scrub',
      priority: 'critical',
      state: 'queued',
      queuedAtMs: 10,
    });
    const started = job({
      jobId: 'started-export',
      type: 'export',
      priority: 'normal',
      state: 'started',
      queuedAtMs: 12,
      startedAtMs: 14,
    });
    const completed = job({
      jobId: 'completed-thumbnail',
      type: 'thumbnail',
      priority: 'low',
      state: 'completed',
      queuedAtMs: 13,
      startedAtMs: 15,
      finishedAtMs: 20,
    });

    const snapshot = createWorkerFirstRuntimeSnapshot({
      source: 'worker-runtime',
      capturedAtMs: 30,
      jobs: [queued, started, completed],
      cacheEntries: [
        cacheEntry({ cacheId: 'source-frame', bytes: 1024, allocations: 1, reuses: 2 }),
        cacheEntry({
          cacheId: 'target-surface',
          owner: 'target-surface',
          entries: 2,
          bytes: 4096,
          allocations: 2,
          reuses: 1,
          evictions: 1,
          transfers: 1,
          releases: 1,
          leakChecks: 1,
        }),
      ],
      providers: [provider()],
      timing: {
        transferLatencyMs: 4,
        providerWaitMs: 8,
        presentedFrameId: 'provider-a:1',
      },
      passes: {
        passCount: 3,
        duplicatePassCount: 1,
      },
      visiblePixels: {
        nonBlankRatio: 0.9,
        blackFrameCount: 0,
      },
    });

    const counters = buildWorkerFirstProofCounters(
      workerFirstRuntimeSnapshotToCounterSources(snapshot),
    );

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.scheduler.queueDepth).toBe(1);
    expect(snapshot.scheduler.oldestCommandAgeMs).toBe(20);
    expect(snapshot.scheduler.byPriority.critical).toBe(1);
    expect(snapshot.scheduler.byType.scrub).toBe(1);
    expect(snapshot.scheduler.counters).toMatchObject({
      admitted: 3,
      enqueued: 1,
      started: 2,
      completed: 1,
    });
    expect(snapshot.cache).toMatchObject({
      entries: 3,
      bytes: 5120,
      counters: {
        allocations: 3,
        reuses: 3,
        evictions: 1,
        transfers: 1,
        releases: 1,
        leakChecks: 1,
      },
    });
    expect(counters).toMatchObject({
      queueDepth: 1,
      transferLatencyMs: 4,
      providerWaitMs: 8,
      presentedFrameId: 'provider-a:1',
      cache: {
        hits: 3,
        misses: 3,
        evictions: 1,
        vramPeakBytes: 5120,
      },
      frameLifetime: {
        outstanding: 2,
        created: 3,
        transferred: 2,
        imported: 2,
        cached: 1,
        released: 1,
        closed: 1,
      },
      passes: {
        passCount: 3,
        duplicatePassCount: 1,
      },
      visiblePixels: {
        nonBlankRatio: 0.9,
        blackFrameCount: 0,
      },
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('clones mutable input records before deriving counter sources', () => {
    const jobs = [job({ jobId: 'queued-a' })];
    const caches = [cacheEntry({ cacheId: 'cache-a' })];
    const providers = [provider()];

    const snapshot = createWorkerFirstRuntimeSnapshot({
      source: 'main-host-observation',
      capturedAtMs: 100,
      jobs,
      cacheEntries: caches,
      providers,
    });

    jobs[0] = job({ jobId: 'queued-b', queuedAtMs: 90 });
    caches[0] = cacheEntry({ cacheId: 'cache-b', bytes: 4096 });
    providers[0] = { ...provider(), providerId: 'provider-b' };

    const sources = workerFirstRuntimeSnapshotToCounterSources(snapshot);

    expect(snapshot.jobs[0].jobId).toBe('queued-a');
    expect(snapshot.cacheEntries[0].cacheId).toBe('cache-a');
    expect(snapshot.providers[0].providerId).toBe('provider-a');
    expect((sources.providers ?? [])[0].providerId).toBe('provider-a');
    expect(JSON.parse(JSON.stringify(sources))).toEqual(sources);
  });
});
