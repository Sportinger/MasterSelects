import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstRamCacheGoldenFixture,
  type WorkerFirstRamCacheGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstRamCacheGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstRamCacheGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'ram-cache',
        range: { start: 0, end: 1.15 },
        completed: true,
        cachedFrameCount: 35,
        cachedRanges: [{ start: 0, end: 1.17 }],
        compositeCacheStats: { count: 35, maxFrames: 900, memoryMB: 110 },
        timelineSignals: ['composite-cache', 'image', 'ram-preview', 'solid', 'text'],
      },
    }),
    runRamPreviewSmoke: vi.fn(async () => ({
      success: true,
      data: { completed: true, mode: 'store' },
    })),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'ram-cache',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          cachedFrameHit: true,
          compositeCacheStats: { count: 35, maxFrames: 900, memoryMB: 110 },
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

describe('worker-first ram-cache golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstRamCacheGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'ram-cache',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'ram-cache',
      sampleTimeSeconds: 0,
      settleMs: 700,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'ram-cache',
      sampleTimeSeconds: 0.5,
      settleMs: 700,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'ram-cache',
      sampleTimeSeconds: 1,
      settleMs: 700,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'ram-cache',
      manifestSampleTimesSeconds: [0, 0.5, 1],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, sample times, preview range, or cache state', async () => {
    const wrongProject = await handleRunWorkerFirstRamCacheGoldenFixture({
      projectId: 'multi-video',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1 },
      { targetSnapshot: {} },
    ]) {
      const result = await handleRunWorkerFirstRamCacheGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the ram-cache manifest');
    }

    for (const args of [
      { startTime: 0 },
      { endTime: 1 },
      { createSynthetic: true },
      { requireVideo: true },
      { allowDirectEngineFallback: false },
      { ramPreviewRange: { start: 0, end: 1 } },
      { cachedFrameTimes: [0, 0.5, 1] },
      { cachedRanges: [] },
      { compositeCache: {} },
      { compositeCacheStats: { count: 1 } },
      { ramPreviewSmoke: {} },
      { ramPreviewFrames: [] },
    ]) {
      const result = await handleRunWorkerFirstRamCacheGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('preview range, cached frames, composite cache, and smoke path are controlled');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'RAM preview generation failed',
      },
    });

    const result = await handleRunWorkerFirstRamCacheGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('RAM preview generation failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer', cachedFrameHit: true } },
        { success: false, error: 'missing composite-cache signal' },
        { success: true, data: { sampleTimeSeconds: 1, source: 'main-renderer', cachedFrameHit: true } },
      ],
    });

    const result = await handleRunWorkerFirstRamCacheGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing composite-cache signal' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer', cachedFrameHit: true },
        { error: 'missing composite-cache signal' },
        { sampleTimeSeconds: 1, source: 'main-renderer', cachedFrameHit: true },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstRamCacheGoldenFixture({
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
