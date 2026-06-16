import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import {
  createEmptyFrameProviderCounters,
  type FrameProviderStatus,
} from '../../src/engine/render/contracts/frameProviderPolicy';
import { useEngineStore } from '../../src/stores/engineStore';
import {
  handleGetStats,
  handleGetStatsHistory,
  handleGetPlaybackTrace,
} from '../../src/services/aiTools/handlers/stats';
import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import {
  clearWorkerFirstProofCapturesForTests,
  recordWorkerFirstShadowParitySample,
  recordWorkerFirstVisiblePresentationProof,
} from '../../src/services/aiTools/workerFirstProofCaptures';
import {
  clearWorkerFirstCounterSourcesForTests,
  recordWorkerFirstCacheSnapshot,
  recordWorkerFirstProviderStatuses,
  recordWorkerFirstSchedulerSnapshot,
} from '../../src/services/aiTools/workerFirstCounterSources';
import {
  isPlainTimelineRuntimeBridgeStats,
} from '../../src/services/timeline/runtimeCoordinatorContracts';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type {
  RenderResourceDescriptor,
  TimelineRuntimeCoordinatorBridgeStats,
} from '../../src/services/timeline/runtimeCoordinatorTypes';
import type { RenderCacheRegistrySnapshot } from '../../src/services/renderJobs/renderCacheRegistry';
import type { RenderSchedulerSnapshot } from '../../src/services/renderJobs/renderJobScheduler';

const htmlMediaResource: RenderResourceDescriptor = {
  id: 'stats-test-html-media',
  kind: 'html-media',
  policyId: 'interactive',
  owner: {
    ownerId: 'clip-1',
    ownerType: 'clip',
    clipId: 'clip-1',
    trackId: 'track-1',
    mediaFileId: 'media-1',
  },
  mediaElementKind: 'video',
  elementId: 'video-element-1',
  srcKind: 'blob-url',
  diagnostics: {
    status: 'ok',
    provider: {
      providerId: 'video-element-1',
      providerKind: 'html-video',
      status: 'ok',
      readyState: 1,
    },
  },
};

const runtimeCounterOwner = {
  ownerId: 'runtime-counter-test',
  ownerType: 'tool' as const,
};

const fingerprint: FrameFingerprint = {
  sourceWidth: 16,
  sourceHeight: 16,
  sampleWidth: 16,
  sampleHeight: 16,
  pixelCount: 256,
  hash: 'abc12345',
  nonBlankRatio: 1,
  alphaCoverage: 1,
  avgRgb: { r: 120, g: 80, b: 40 },
  meanLuma: 90,
  colorRange: { r: 100, g: 90, b: 80, luma: 85 },
};

const schedulerSnapshot: RenderSchedulerSnapshot = {
  queueDepth: 3,
  byPriority: { critical: 1, high: 1, normal: 1, low: 0, idle: 0 },
  byType: {
    'live-playback': 1,
    scrub: 0,
    'independent-preview': 0,
    'ram-preview': 0,
    thumbnail: 0,
    'clip-bake': 0,
    'composition-bake': 0,
    export: 2,
  },
  oldestCommandAgeMs: 10,
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

const cacheSnapshot: RenderCacheRegistrySnapshot = {
  entries: 1,
  bytes: 2048,
  bytesByOwner: {
    'source-frame': 2048,
    'hold-frame': 0,
    'composite-frame': 0,
    'subcomp-output': 0,
    'mask-texture': 0,
    'effect-plan': 0,
    'target-surface': 0,
    'bake-artifact': 0,
    thumbnail: 0,
    'export-frame': 0,
  },
  counters: {
    allocations: 2,
    reuses: 5,
    evictions: 1,
    transfers: 0,
    releases: 1,
    leakChecks: 0,
  },
};

const providerStatus: FrameProviderStatus = {
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
  outstandingFrameCount: 1,
  lastDropReason: null,
  fallbackUsed: false,
  counters: {
    ...createEmptyFrameProviderCounters(),
    created: 2,
    released: 1,
    closed: 1,
    leaked: 1,
  },
};

function readTimelineRuntimeCoordinatorStats(data: unknown): TimelineRuntimeCoordinatorBridgeStats {
  const snapshot = data as { timelineRuntimeCoordinator?: TimelineRuntimeCoordinatorBridgeStats };
  expect(snapshot.timelineRuntimeCoordinator).toBeDefined();
  return snapshot.timelineRuntimeCoordinator!;
}

function readWorkerFirstRendererStats(data: unknown): Record<string, unknown> {
  const snapshot = data as { workerFirstRenderer?: Record<string, unknown> };
  expect(snapshot.workerFirstRenderer).toBeDefined();
  return snapshot.workerFirstRenderer!;
}

describe('AI stats timeline runtime coordinator bridge field', () => {
  let previousEngineStats: ReturnType<typeof useEngineStore.getState>['engineStats'];
  const enginePatchKeys = [
    'getLayerCollector',
    'getRenderLoop',
    'getScrubbingCacheStats',
    'getCompositeCacheStats',
    'getDebugInfrastructureState',
    'getRenderDispatcherDebugSnapshot',
  ] as const;
  let previousEngineDescriptors: Record<typeof enginePatchKeys[number], PropertyDescriptor | undefined>;

  beforeEach(() => {
    previousEngineStats = useEngineStore.getState().engineStats;
    previousEngineDescriptors = Object.fromEntries(
      enginePatchKeys.map((key) => [key, Object.getOwnPropertyDescriptor(engine, key)]),
    ) as Record<typeof enginePatchKeys[number], PropertyDescriptor | undefined>;
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    timelineRuntimeCoordinator.clearResources();
    const debugEngine = engine as unknown as {
      getLayerCollector?: () => { isVideoGpuReady: () => boolean };
      getRenderLoop?: () => null;
      getScrubbingCacheStats?: () => Record<string, never>;
      getCompositeCacheStats?: () => Record<string, never>;
      getDebugInfrastructureState?: () => Record<string, never>;
      getRenderDispatcherDebugSnapshot?: () => null;
    };
    debugEngine.getLayerCollector = () => ({
      isVideoGpuReady: () => false,
    });
    debugEngine.getRenderLoop = () => null;
    debugEngine.getScrubbingCacheStats = () => ({});
    debugEngine.getCompositeCacheStats = () => ({});
    debugEngine.getDebugInfrastructureState = () => ({});
    debugEngine.getRenderDispatcherDebugSnapshot = () => null;
  });

  afterEach(() => {
    useEngineStore.getState().setEngineStats(previousEngineStats);
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    timelineRuntimeCoordinator.clearResources();
    for (const key of enginePatchKeys) {
      const descriptor = previousEngineDescriptors[key];
      if (descriptor) {
        Object.defineProperty(engine, key, descriptor);
      } else {
        Reflect.deleteProperty(engine, key);
      }
    }
  });

  it('includes plain coordinator stats in getStats and getStatsHistory', async () => {
    timelineRuntimeCoordinator.retainResource(htmlMediaResource);
    useEngineStore.getState().setEngineStats({
      ...useEngineStore.getState().engineStats,
      mainThread: {
        windowMs: 5000,
        samples: 3,
        liveSamples: 2,
        cachedSamples: 1,
        skippedSamples: 0,
        avgTotalMs: 4,
        p95TotalMs: 6,
        maxTotalMs: 7,
        avgStatsMs: 0,
        avgBuildMs: 1,
        avgRenderMs: 1,
        avgSyncVideoMs: 0.5,
        avgSyncAudioMs: 1.5,
        avgCacheMs: 0,
        maxBuildMs: 2,
        maxRenderMs: 2,
        maxSyncVideoMs: 1,
        maxSyncAudioMs: 3,
        maxCacheMs: 0,
      },
    });
    recordWorkerFirstShadowParitySample({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      mainFingerprint: fingerprint,
      workerFingerprint: fingerprint,
    }, 10);
    recordWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      proof: {
        attached: true,
        cssSize: { width: 320, height: 180 },
        backingSize: { width: 320, height: 180 },
        viewportIntersecting: true,
        centerOccluded: false,
        fingerprint,
        errors: [],
      },
      capabilityProbe: null,
      stress: {
        playbackDurationMs: 5000,
        frameCount: 150,
        staleVisibleFrameCount: 0,
      },
    }, 20);
    recordWorkerFirstSchedulerSnapshot(schedulerSnapshot, 30);
    recordWorkerFirstCacheSnapshot(cacheSnapshot, 40);
    recordWorkerFirstProviderStatuses([providerStatus], 50);

    const statsResult = await handleGetStats();
    expect(statsResult.success).toBe(true);
    expect(statsResult.data).toMatchObject({
      projectLoadProgress: {
        active: false,
        phase: 'idle',
      },
      mainThread: {
        samples: 3,
        avgSyncAudioMs: 1.5,
      },
    });
    const stats = readTimelineRuntimeCoordinatorStats(statsResult.data);
    const workerFirst = readWorkerFirstRendererStats(statsResult.data);
    expect(workerFirst).toMatchObject({
      mode: 'main',
      selectedStrategy: 'main-host-dev',
      capabilityProbeStatus: 'missing',
      capabilityProbe: null,
      w5GateEvidenceMode: 'stats-observation',
      proofPaths: {
        frameFingerprint: 'src/services/aiTools/frameFingerprint.ts',
        domVisibleCapture: 'src/services/aiTools/visiblePixelProof.ts:captureDomVisibleCanvasProof',
      },
      proofCaptures: {
        shadowSamples: [{
          projectId: 'solid-text-image',
          sampleTimeSeconds: 0,
        }],
        visibleProofs: [{
          platform: 'windows-chromium',
          strategy: 'worker-webgpu-main-present',
        }],
        updatedAt: 20,
      },
      counters: {
        queueDepth: 3,
        cache: {
          hits: 5,
          misses: 2,
          evictions: 1,
          vramPeakBytes: 2048,
        },
        frameLifetime: {
          outstanding: 1,
          leaked: 1,
        },
      },
      w5Prerequisites: {
        canStartWorkerWebGpu: false,
        canStartWorkerPresentation: false,
        canStartRenderDispatcherCutover: false,
      },
    });
    expect(JSON.parse(JSON.stringify(workerFirst))).toEqual(workerFirst);
    expect(stats.schemaVersion).toBe(1);
    expect(stats.totals.resources).toBe(1);
    expect(stats.policies.interactive.budgetReport.usage.htmlMediaElements).toBe(1);
    expect(isPlainTimelineRuntimeBridgeStats(stats)).toBe(true);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);

    const historyResult = await handleGetStatsHistory({ samples: 1 });
    expect(historyResult.success).toBe(true);
    const historyData = historyResult.data as { snapshots: unknown[] };
    const historyStats = readTimelineRuntimeCoordinatorStats(historyData.snapshots[0]);
    const historyWorkerFirst = readWorkerFirstRendererStats(historyData.snapshots[0]);
    expect(historyStats.totals.resources).toBe(1);
    expect(historyWorkerFirst.mode).toBe('main');
    expect(isPlainTimelineRuntimeBridgeStats(historyStats)).toBe(true);

    const traceResult = await handleGetPlaybackTrace({ windowMs: 100, limit: 1 });
    expect(traceResult.success).toBe(true);
    const traceWorkerFirst = readWorkerFirstRendererStats(traceResult.data);
    expect(traceWorkerFirst).toMatchObject({
      mode: 'main',
      counters: {
        queueDepth: 3,
      },
    });
  });

  it('derives worker-first counters from real runtime coordinator, render loop, and cache snapshots when no accepted counters are recorded', async () => {
    const debugEngine = engine as unknown as {
      getRenderLoop?: () => Record<string, unknown>;
      getScrubbingCacheStats?: () => Record<string, unknown>;
      getCompositeCacheStats?: () => Record<string, unknown>;
    };
    debugEngine.getRenderLoop = () => ({
      renderRequested: true,
      isPlaying: false,
      isScrubbing: true,
      hasActiveVideo: false,
      isRunning: true,
      animationId: 1,
      idleSuppressed: false,
      lastRenderTime: 0,
      watchdogTimer: null,
      getTimelineVisualDemand: () => true,
      getIsIdle: () => false,
      getIsPlaying: () => false,
      getRenderCount: () => 10,
      getLastSuccessfulRenderTime: () => 100,
    });
    debugEngine.getScrubbingCacheStats = () => ({
      count: 2,
      approxMemoryMB: 1.5,
      evictions: 1,
    });
    debugEngine.getCompositeCacheStats = () => ({
      count: 3,
      maxFrames: 120,
      memoryMB: 2,
    });

    timelineRuntimeCoordinator.retainResource({
      id: 'runtime-counter-job',
      kind: 'job',
      policyId: 'export',
      owner: runtimeCounterOwner,
      jobId: 'runtime-counter-job',
      jobKind: 'export-render',
      queuedAtMs: Date.now() - 25,
    });
    timelineRuntimeCoordinator.retainResource({
      id: 'runtime-counter-provider',
      kind: 'video-frame-provider',
      policyId: 'interactive',
      owner: runtimeCounterOwner,
      providerId: 'runtime-counter-provider',
      providerKind: 'webcodecs',
      memoryCost: { decodedFrameBytes: 2048 },
      diagnostics: {
        status: 'ok',
        provider: {
          providerId: 'runtime-counter-provider',
          providerKind: 'webcodecs',
          status: 'ok',
          isReady: true,
          bufferedFrameCount: 2,
          averageDecodeLatencyMs: 12,
          currentTimeSeconds: 1.25,
          lastFrameTimeSeconds: 1.25,
          lastFrameAtMs: 222,
        },
      },
    });
    timelineRuntimeCoordinator.retainResource({
      id: 'runtime-counter-texture',
      kind: 'gpu-texture',
      policyId: 'render-target',
      owner: runtimeCounterOwner,
      textureId: 'runtime-counter-texture',
      textureKind: 'render-target',
      memoryCost: { gpuBytes: 4096 },
    });

    const result = await handleGetStats();
    expect(result.success).toBe(true);
    const workerFirst = readWorkerFirstRendererStats(result.data);

    expect(workerFirst).toMatchObject({
      counters: {
        queueDepth: 2,
        providerWaitMs: 12,
        presentedFrameId: 'runtime-counter-provider:1.25',
        frameLifetime: {
          outstanding: 2,
          cached: 2,
          leaked: 0,
        },
        cache: {
          hits: 5,
          misses: 7,
          evictions: 1,
        },
      },
      w5Prerequisites: {
        canStartWorkerWebGpu: false,
        canStartWorkerPresentation: false,
        canStartRenderDispatcherCutover: false,
      },
    });
    expect((workerFirst.counters as { cache: { vramPeakBytes: number } }).cache.vramPeakBytes)
      .toBe(3676160);
    expect(JSON.parse(JSON.stringify(workerFirst))).toEqual(workerFirst);
  });
});
