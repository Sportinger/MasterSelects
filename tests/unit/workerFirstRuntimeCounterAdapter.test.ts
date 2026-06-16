import { describe, expect, it } from 'vitest';

import {
  buildWorkerFirstProofCounters,
} from '../../src/services/aiTools/workerFirstGateInputs';
import {
  buildWorkerFirstRuntimeSnapshot,
} from '../../src/services/aiTools/workerFirstRuntimeCounterAdapter';
import {
  workerFirstRuntimeSnapshotToCounterSources,
} from '../../src/services/aiTools/workerFirstRuntimeModel';
import type {
  IndependentRenderSchedulerRuntimeSnapshot,
} from '../../src/services/renderScheduler';
import type {
  WorkerFirstProviderRuntimeSnapshot,
} from '../../src/services/timeline/providerRuntimeDiagnostics';

describe('worker-first runtime counter adapter', () => {
  it('maps independent render scheduler diagnostics into runtime-model job counters', () => {
    const independentRenderScheduler: IndependentRenderSchedulerRuntimeSnapshot = {
      generatedAtMs: 100,
      isRunning: true,
      registeredTargetCount: 2,
      jobs: [
        {
          jobId: 'independent-render:1',
          targetId: 'target-a',
          compositionId: 'comp-a',
          state: 'completed',
          queuedAtMs: 80,
          startedAtMs: 81,
          finishedAtMs: 90,
          reason: 'composition-render',
        },
        {
          jobId: 'independent-render:2',
          targetId: 'target-b',
          compositionId: 'comp-b',
          state: 'dropped',
          queuedAtMs: 82,
          startedAtMs: null,
          finishedAtMs: null,
          reason: 'composition-not-ready',
        },
      ],
      counters: {
        admitted: 2,
        started: 1,
        completed: 1,
        dropped: 1,
        blackFrames: 0,
        activeLayerFilters: 0,
        nestedTextureCopies: 0,
        compositionRenders: 1,
        compositionNotReadyDrops: 1,
      },
    };

    const snapshot = buildWorkerFirstRuntimeSnapshot({
      independentRenderScheduler,
      nowMs: 110,
    });
    const counters = buildWorkerFirstProofCounters(
      workerFirstRuntimeSnapshotToCounterSources(snapshot),
    );

    expect(snapshot.source).toBe('main-host-observation');
    expect(snapshot.jobs).toEqual([
      expect.objectContaining({
        jobId: 'independent-render:1',
        targetId: 'target-a',
        compositionId: 'comp-a',
        state: 'completed',
        type: 'independent-preview',
      }),
      expect.objectContaining({
        jobId: 'independent-render:2',
        targetId: 'target-b',
        compositionId: 'comp-b',
        state: 'dropped',
        priority: 'low',
      }),
    ]);
    expect(snapshot.scheduler).toMatchObject({
      queueDepth: 0,
      counters: {
        admitted: 2,
        enqueued: 0,
        started: 1,
        completed: 1,
        dropped: 1,
      },
    });
    expect(counters.queueDepth).toBe(0);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('prefers producer-owned cache runtime records over legacy cache stats fallback', () => {
    const snapshot = buildWorkerFirstRuntimeSnapshot({
      cacheRuntime: {
        generatedAtMs: 50,
        records: [
          {
            cacheId: 'ram-preview:composite-cache',
            owner: 'composite-frame',
            entries: 2,
            bytes: 2048,
            allocations: 3,
            reuses: 4,
            evictions: 1,
            transfers: 0,
            releases: 1,
            leakChecks: 1,
          },
        ],
      },
      cacheStats: {
        scrubbing: {
          count: 9,
          approxMemoryMB: 9,
          evictions: 9,
        },
        composite: {
          count: 9,
          memoryMB: 9,
        },
      },
      nowMs: 60,
    });
    const counters = buildWorkerFirstProofCounters(
      workerFirstRuntimeSnapshotToCounterSources(snapshot),
    );

    expect(snapshot.cacheEntries).toEqual([
      expect.objectContaining({
        cacheId: 'ram-preview:composite-cache',
        entries: 2,
        bytes: 2048,
        allocations: 3,
        reuses: 4,
        evictions: 1,
      }),
    ]);
    expect(counters.cache).toEqual({
      hits: 4,
      misses: 3,
      evictions: 1,
      vramPeakBytes: 2048,
    });
  });

  it('prefers provider runtime records over timeline provider fallback diagnostics', () => {
    const providerRuntime: WorkerFirstProviderRuntimeSnapshot = {
      generatedAtMs: 70,
      providers: [
        {
          providerId: 'provider-runtime-a',
          providerKind: 'webcodecs',
          resourceId: 'provider-resource-a',
          sourceId: 'source-a',
          sessionKey: 'interactive:source-a',
          policyId: 'interactive',
          memoryBytes: 2048,
          status: 'ok',
          isReady: true,
          bufferedFrameCount: 2,
          averageDecodeLatencyMs: 7,
          currentTimeSeconds: 1.5,
          lastFrameTimeSeconds: 1.5,
          lastFrameAtMs: 100,
        },
      ],
    };
    const snapshot = buildWorkerFirstRuntimeSnapshot({
      providerRuntime,
      timelineRuntime: {
        schemaVersion: 1,
        generatedAtMs: 1,
        policyOrder: [],
        policies: {} as never,
        totals: {
          resources: 0,
          sessions: 0,
          frameProviders: 0,
          htmlMediaElements: 0,
          nativeDecoders: 0,
          gpuTextures: 0,
          imageBitmaps: 0,
          audioSources: 0,
          jobs: 0,
          heapBytes: 0,
          gpuBytes: 0,
        },
        diagnostics: {
          providers: [
            {
              providerId: 'fallback-provider',
              providerKind: 'html-video',
              status: 'ok',
              bufferedFrameCount: 9,
              averageDecodeLatencyMs: 99,
              lastFrameTimeSeconds: 9,
            },
          ],
          sessions: [],
          resources: [],
          messages: [],
        },
      },
      nowMs: 80,
    });
    const counters = buildWorkerFirstProofCounters(
      workerFirstRuntimeSnapshotToCounterSources(snapshot),
    );

    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]).toMatchObject({
      providerId: 'provider-runtime-a',
      sourceId: 'source-a',
      sessionKey: 'interactive:source-a',
      outstandingFrameCount: 2,
    });
    expect(counters.frameLifetime).toMatchObject({
      outstanding: 2,
      created: 2,
      cached: 2,
    });
    expect(counters.providerWaitMs).toBe(7);
    expect(counters.presentedFrameId).toBe('provider-runtime-a:1.5');
  });
});
