import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmptyFrameProviderCounters,
  type FrameProviderStatus,
} from '../../src/engine/render/contracts/frameProviderPolicy';
import type { RenderCacheRegistrySnapshot } from '../../src/services/renderJobs/renderCacheRegistry';
import type { RenderSchedulerSnapshot } from '../../src/services/renderJobs/renderJobScheduler';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSourceSnapshot,
  getWorkerFirstCounterSources,
  recordWorkerFirstCacheSnapshot,
  recordWorkerFirstProviderStatuses,
  recordWorkerFirstSchedulerSnapshot,
  recordWorkerFirstTimingCounters,
  recordWorkerFirstVisiblePixelCounters,
} from '../../src/services/aiTools/workerFirstCounterSources';
import { createWorkerFirstProofSnapshot } from '../../src/services/aiTools/workerFirstProofHarness';

const scheduler: RenderSchedulerSnapshot = {
  queueDepth: 4,
  byPriority: { critical: 1, high: 1, normal: 1, low: 1, idle: 0 },
  byType: {
    'live-playback': 1,
    scrub: 1,
    'independent-preview': 0,
    'ram-preview': 0,
    thumbnail: 0,
    'clip-bake': 0,
    'composition-bake': 0,
    export: 2,
  },
  oldestCommandAgeMs: 25,
  counters: {
    admitted: 5,
    enqueued: 4,
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
  bytes: 8192,
  bytesByOwner: {
    'source-frame': 2048,
    'hold-frame': 0,
    'composite-frame': 4096,
    'subcomp-output': 0,
    'mask-texture': 2048,
    'effect-plan': 0,
    'target-surface': 0,
    'bake-artifact': 0,
    thumbnail: 0,
    'export-frame': 0,
  },
  counters: {
    allocations: 6,
    reuses: 8,
    evictions: 1,
    transfers: 2,
    releases: 3,
    leakChecks: 1,
  },
};

function provider(overrides: Partial<FrameProviderStatus> = {}): FrameProviderStatus {
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
      leaked: 1,
    },
    ...overrides,
  };
}

describe('worker-first runtime counter sources', () => {
  beforeEach(() => {
    clearWorkerFirstCounterSourcesForTests();
  });

  afterEach(() => {
    clearWorkerFirstCounterSourcesForTests();
  });

  it('records scheduler, cache, provider, and timing sources as serializable clones', () => {
    recordWorkerFirstSchedulerSnapshot(scheduler, 10);
    recordWorkerFirstCacheSnapshot(cache, 20);
    recordWorkerFirstProviderStatuses([provider()], 30);
    recordWorkerFirstTimingCounters({
      transferLatencyMs: 5,
      providerWaitMs: 9,
      presentedFrameId: 'frame-99',
    }, 40);
    recordWorkerFirstVisiblePixelCounters({
      nonBlankRatio: 0.8,
      blackFrameCount: 0,
      freezeCount: 1,
      staleVisibleFrameCount: 2,
    }, 50);

    const snapshot = getWorkerFirstCounterSourceSnapshot();

    expect(snapshot.updatedAt).toBe(50);
    expect(snapshot.scheduler?.queueDepth).toBe(4);
    expect(snapshot.cache?.bytes).toBe(8192);
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.transferLatencyMs).toBe(5);
    expect(snapshot.providerWaitMs).toBe(9);
    expect(snapshot.presentedFrameId).toBe('frame-99');
    expect(snapshot.visiblePixels).toEqual({
      nonBlankRatio: 0.8,
      blackFrameCount: 0,
      freezeCount: 1,
      staleVisibleFrameCount: 2,
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);

    (snapshot.providers as FrameProviderStatus[]).length = 0;
    expect(getWorkerFirstCounterSourceSnapshot().providers).toHaveLength(1);
  });

  it('feeds recorded runtime sources into worker-first W5 counters', () => {
    recordWorkerFirstSchedulerSnapshot(scheduler);
    recordWorkerFirstCacheSnapshot(cache);
    recordWorkerFirstProviderStatuses([provider()]);
    recordWorkerFirstTimingCounters({
      transferLatencyMs: 5,
      providerWaitMs: 9,
      presentedFrameId: 'frame-99',
    });
    recordWorkerFirstVisiblePixelCounters({
      nonBlankRatio: 0.8,
      blackFrameCount: 0,
      freezeCount: 1,
      staleVisibleFrameCount: 2,
    });

    const snapshot = createWorkerFirstProofSnapshot({
      counterSources: getWorkerFirstCounterSources(),
    });

    expect(snapshot.counters.queueDepth).toBe(4);
    expect(snapshot.counters.cache).toEqual({
      hits: 8,
      misses: 6,
      evictions: 1,
      vramPeakBytes: 8192,
    });
    expect(snapshot.counters.frameLifetime).toMatchObject({
      outstanding: 2,
      created: 3,
      released: 1,
      leaked: 1,
    });
    expect(snapshot.counters.transferLatencyMs).toBe(5);
    expect(snapshot.counters.providerWaitMs).toBe(9);
    expect(snapshot.counters.presentedFrameId).toBe('frame-99');
    expect(snapshot.counters.visiblePixels).toEqual({
      nonBlankRatio: 0.8,
      blackFrameCount: 0,
      freezeCount: 1,
      staleVisibleFrameCount: 2,
    });
    expect(snapshot.w5Prerequisites.workerShadowParity.checks.find((check) => (
      check.id === 'queue-depth-bounded'
    ))).toMatchObject({ status: 'failed' });
  });

  it('replaces visible-pixel counter snapshots instead of mixing separate proof runs', () => {
    recordWorkerFirstVisiblePixelCounters({
      nonBlankRatio: 0.9,
      blackFrameCount: 0,
      freezeCount: 0,
      staleVisibleFrameCount: 0,
    }, 10);
    recordWorkerFirstVisiblePixelCounters({
      nonBlankRatio: 0.4,
      blackFrameCount: 0,
    }, 20);

    const sources = getWorkerFirstCounterSourceSnapshot();
    const snapshot = createWorkerFirstProofSnapshot({
      counterSources: getWorkerFirstCounterSources(),
    });

    expect(sources.updatedAt).toBe(20);
    expect(sources.visiblePixels).toEqual({
      nonBlankRatio: 0.4,
      blackFrameCount: 0,
    });
    expect(snapshot.counters.visiblePixels).toEqual({
      nonBlankRatio: 0.4,
      blackFrameCount: 0,
      freezeCount: 0,
      staleVisibleFrameCount: 0,
    });
  });
});
