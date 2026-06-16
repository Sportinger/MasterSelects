import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstBakeGoldenFixture,
  type WorkerFirstBakeGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstBakeGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstBakeGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'bake',
        clipBake: {
          regionId: 'clip-bake-region',
          clipId: 'wfg-image-clip',
          status: 'baked',
          completed: true,
          cachedFrameCount: 65,
          cachedRanges: [{ start: 0, end: 2.17 }],
        },
        compositionBake: {
          regionId: 'composition-bake-region',
          status: 'baked',
          completed: true,
          proxyReady: true,
        },
        timelineSignals: ['clip-bake', 'composition-bake', 'image', 'solid', 'text'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'bake',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          cachedFrameHit: true,
        },
      }
    )),
    beginMutation: vi.fn(() => vi.fn()),
    captureRestoreState: vi.fn(() => ({ id: 'restore-state' } as never)),
    restoreTimeline: vi.fn(async () => ({
      restoredTrackCount: 2,
      restoredClipCount: 3,
      restoredPlayheadPosition: 0.5,
      resumedPlayback: false,
    })),
  };
}

describe('worker-first bake golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes clip and composition bake paths, then captures every manifest sample', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstBakeGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'bake',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'bake',
      sampleTimeSeconds: 0,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'bake',
      sampleTimeSeconds: 1,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'bake',
      sampleTimeSeconds: 2,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'bake',
      manifestSampleTimesSeconds: [0, 1, 2],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, bake regions, proxy state, or cache state', async () => {
    const wrongProject = await handleRunWorkerFirstBakeGoldenFixture({
      projectId: 'ram-cache',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1 },
      { targetSnapshot: {} },
    ]) {
      const result = await handleRunWorkerFirstBakeGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the bake manifest');
    }

    for (const args of [
      { clipId: 'clip-a' },
      { trackId: 'track-a' },
      { regionId: 'region-a' },
      { clipRegionId: 'clip-bake-a' },
      { compositionRegionId: 'composition-bake-a' },
      { videoBakeRegions: [] },
      { bakeRegions: [] },
      { clipBake: {} },
      { compositionBake: {} },
      { startTime: 0 },
      { endTime: 1 },
      { sourceInPoint: 0 },
      { sourceOutPoint: 1 },
      { clipBakeRange: { start: 0, end: 2 } },
      { compositionBakeRange: { start: 0, end: 1 } },
      { proxyReady: true },
      { videoBakeProxyCache: {} },
      { cachedFrameTimes: [0, 1, 2] },
      { cachedRanges: [] },
      { compositeCache: {} },
      { compositeCacheStats: { count: 1 } },
    ]) {
      const result = await handleRunWorkerFirstBakeGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the bake runner');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'Composition video bake did not produce a ready bake proxy artifact.',
      },
    });

    const result = await handleRunWorkerFirstBakeGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Composition video bake');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer', cachedFrameHit: true } },
        { success: false, error: 'missing composition-bake signal' },
        { success: true, data: { sampleTimeSeconds: 2, source: 'main-renderer', cachedFrameHit: true } },
      ],
    });

    const result = await handleRunWorkerFirstBakeGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing composition-bake signal' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer', cachedFrameHit: true },
        { error: 'missing composition-bake signal' },
        { sampleTimeSeconds: 2, source: 'main-renderer', cachedFrameHit: true },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstBakeGoldenFixture({
      restoreTimelineAfterRun: true,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.captureRestoreState).toHaveBeenCalledTimes(1);
    expect(deps.restoreTimeline).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      restoredTimeline: {
        restoredTrackCount: 2,
        restoredClipCount: 3,
        restoredPlayheadPosition: 0.5,
      },
    });
  });
});
