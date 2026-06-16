import { describe, expect, it } from 'vitest';

import {
  createEmptyFrameProviderCounters,
  type FrameProviderStatus,
} from '../../src/engine/render/contracts/frameProviderPolicy';
import type { RenderCacheRegistrySnapshot } from '../../src/services/renderJobs/renderCacheRegistry';
import type { RenderSchedulerSnapshot } from '../../src/services/renderJobs/renderJobScheduler';
import {
  buildWorkerFirstProofCounters,
  createEmptyWorkerFirstProofCounters,
} from '../../src/services/aiTools/workerFirstGateInputs';
import { createWorkerFirstProofSnapshot } from '../../src/services/aiTools/workerFirstProofHarness';

const scheduler: RenderSchedulerSnapshot = {
  queueDepth: 3,
  byPriority: { critical: 1, high: 1, normal: 1, low: 0, idle: 0 },
  byType: {
    'live-playback': 1,
    scrub: 1,
    'independent-preview': 0,
    'ram-preview': 0,
    thumbnail: 0,
    'clip-bake': 0,
    'composition-bake': 0,
    export: 1,
  },
  oldestCommandAgeMs: 12,
  counters: {
    admitted: 4,
    enqueued: 3,
    started: 1,
    completed: 0,
    canceled: 0,
    coalesced: 1,
    dropped: 0,
    expired: 0,
    late: 0,
    staleResponses: 0,
    resizeCoalesced: 0,
    priorityInversions: 0,
  },
};

const cache: RenderCacheRegistrySnapshot = {
  entries: 2,
  bytes: 4096,
  bytesByOwner: {
    'source-frame': 1024,
    'hold-frame': 0,
    'composite-frame': 2048,
    'subcomp-output': 0,
    'mask-texture': 1024,
    'effect-plan': 0,
    'target-surface': 0,
    'bake-artifact': 0,
    thumbnail: 0,
    'export-frame': 0,
  },
  counters: {
    allocations: 5,
    reuses: 7,
    evictions: 2,
    transfers: 3,
    releases: 4,
    leakChecks: 1,
  },
};

function provider(overrides: Partial<FrameProviderStatus>): FrameProviderStatus {
  return {
    providerId: 'provider-a',
    sourceId: 'source-a',
    sourceKind: 'webcodecs',
    sessionKey: 'source-a:session',
    generation: 1,
    requestId: null,
    state: 'ready',
    substatus: [],
    mediaTime: 1,
    frameTimestamp: 1,
    freshness: 'fresh',
    deadlineTimeMs: 100,
    priority: 'high',
    outstandingFrameCount: 1,
    lastDropReason: null,
    fallbackUsed: false,
    counters: {
      ...createEmptyFrameProviderCounters(),
      created: 3,
      transferred: 2,
      imported: 2,
      cached: 1,
      released: 2,
      closed: 1,
      leaked: 1,
    },
    ...overrides,
  };
}

describe('worker-first gate input adapters', () => {
  it('creates isolated empty counters', () => {
    const first = createEmptyWorkerFirstProofCounters();
    const second = createEmptyWorkerFirstProofCounters();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.frameLifetime).not.toBe(second.frameLifetime);
  });

  it('maps scheduler, cache, provider, pass, and visible-pixel sources into proof counters', () => {
    const counters = buildWorkerFirstProofCounters({
      scheduler,
      cache,
      providers: [
        provider({ providerId: 'provider-a' }),
        provider({
          providerId: 'provider-b',
          outstandingFrameCount: 0,
          counters: {
            ...createEmptyFrameProviderCounters(),
            created: 1,
            released: 1,
            closed: 1,
          },
        }),
      ],
      transferLatencyMs: 4,
      providerWaitMs: 8,
      presentedFrameId: 'frame-42',
      passes: {
        passCount: 3,
        duplicatePassCount: 1,
      },
      visiblePixels: {
        nonBlankRatio: 0.75,
        staleVisibleFrameCount: 2,
      },
    });

    expect(counters.queueDepth).toBe(3);
    expect(counters.transferLatencyMs).toBe(4);
    expect(counters.providerWaitMs).toBe(8);
    expect(counters.presentedFrameId).toBe('frame-42');
    expect(counters.frameLifetime).toMatchObject({
      outstanding: 1,
      created: 4,
      transferred: 2,
      imported: 2,
      cached: 1,
      released: 3,
      closed: 2,
      leaked: 1,
    });
    expect(counters.cache).toEqual({
      hits: 7,
      misses: 5,
      evictions: 2,
      vramPeakBytes: 4096,
    });
    expect(counters.passes.passCount).toBe(3);
    expect(counters.passes.duplicatePassCount).toBe(1);
    expect(counters.visiblePixels.nonBlankRatio).toBe(0.75);
    expect(counters.visiblePixels.staleVisibleFrameCount).toBe(2);
  });

  it('feeds adapted counters into the worker-first W5 prerequisite snapshot', () => {
    const snapshot = createWorkerFirstProofSnapshot({
      counterSources: {
        scheduler,
        cache,
        providers: [provider({})],
      },
    });

    expect(snapshot.counters.queueDepth).toBe(3);
    expect(snapshot.counters.cache.vramPeakBytes).toBe(4096);
    expect(snapshot.counters.frameLifetime.outstanding).toBe(1);
    expect(snapshot.w5Prerequisites.canStartWorkerWebGpu).toBe(false);
    expect(snapshot.w5Prerequisites.workerShadowParity.checks.find((check) => (
      check.id === 'queue-depth-bounded'
    ))).toMatchObject({ status: 'failed' });
    expect(snapshot.w5Prerequisites.workerShadowParity.checks.find((check) => (
      check.id === 'frame-provider-lifetime-drained'
    ))).toMatchObject({ status: 'failed' });
  });
});
