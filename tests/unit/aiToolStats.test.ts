import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { useEngineStore } from '../../src/stores/engineStore';
import {
  handleGetStats,
  handleGetStatsHistory,
} from '../../src/services/aiTools/handlers/stats';
import {
  isPlainTimelineRuntimeBridgeStats,
} from '../../src/services/timeline/runtimeCoordinatorContracts';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import type {
  RenderResourceDescriptor,
  TimelineRuntimeCoordinatorBridgeStats,
} from '../../src/services/timeline/runtimeCoordinatorTypes';

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

function readTimelineRuntimeCoordinatorStats(data: unknown): TimelineRuntimeCoordinatorBridgeStats {
  const snapshot = data as { timelineRuntimeCoordinator?: TimelineRuntimeCoordinatorBridgeStats };
  expect(snapshot.timelineRuntimeCoordinator).toBeDefined();
  return snapshot.timelineRuntimeCoordinator!;
}

describe('AI stats timeline runtime coordinator bridge field', () => {
  beforeEach(() => {
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
    timelineRuntimeCoordinator.clearResources();
    const debugEngine = engine as unknown as {
      getLayerCollector?: unknown;
      getRenderLoop?: unknown;
      getScrubbingCacheStats?: unknown;
      getCompositeCacheStats?: unknown;
      getDebugInfrastructureState?: unknown;
      getRenderDispatcherDebugSnapshot?: unknown;
    };
    delete debugEngine.getLayerCollector;
    delete debugEngine.getRenderLoop;
    delete debugEngine.getScrubbingCacheStats;
    delete debugEngine.getCompositeCacheStats;
    delete debugEngine.getDebugInfrastructureState;
    delete debugEngine.getRenderDispatcherDebugSnapshot;
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
    expect(stats.schemaVersion).toBe(1);
    expect(stats.totals.resources).toBe(1);
    expect(stats.policies.interactive.budgetReport.usage.htmlMediaElements).toBe(1);
    expect(isPlainTimelineRuntimeBridgeStats(stats)).toBe(true);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);

    const historyResult = await handleGetStatsHistory({ samples: 1 });
    expect(historyResult.success).toBe(true);
    const historyData = historyResult.data as { snapshots: unknown[] };
    const historyStats = readTimelineRuntimeCoordinatorStats(historyData.snapshots[0]);
    expect(historyStats.totals.resources).toBe(1);
    expect(isPlainTimelineRuntimeBridgeStats(historyStats)).toBe(true);
  });
});
