import { describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstRuntimeExportPlaybackSmoke,
  type WorkerFirstRuntimeExportPlaybackSmokeDeps,
} from '../../src/services/aiTools/workerFirstRuntimeExportPlaybackSmoke';

function statsResult(options: {
  readonly startPermissions?: boolean;
  readonly cacheRecords?: number;
  readonly providerRecords?: number;
  readonly schedulerJobs?: number;
} = {}): ToolResult {
  const startPermission = options.startPermissions === true;
  return {
    success: true,
    data: {
      engineReady: true,
      cacheRuntime: {
        records: Array.from({ length: options.cacheRecords ?? 1 }, (_, index) => ({ cacheId: `cache-${index}` })),
      },
      providerRuntime: {
        providers: Array.from({ length: options.providerRecords ?? 2 }, (_, index) => ({ providerId: `provider-${index}` })),
      },
      independentRenderScheduler: {
        jobs: Array.from({ length: options.schedulerJobs ?? 3 }, (_, index) => ({ jobId: `job-${index}` })),
      },
      workerFirstRenderer: {
        w5GateEvidenceMode: 'stats-observation',
        w5Prerequisites: {
          canStartWorkerWebGpu: startPermission,
          canStartWorkerPresentation: false,
          canStartRenderDispatcherCutover: false,
        },
      },
    },
  };
}

function traceResult(): ToolResult {
  return {
    success: true,
    data: {
      playback: {
        status: 'ok',
        previewFrames: 12,
        previewUpdates: 10,
        stalePreviewFrames: 0,
      },
      workerFirstRenderer: {
        w5GateEvidenceMode: 'stats-observation',
        w5Prerequisites: {
          canStartWorkerWebGpu: false,
          canStartWorkerPresentation: false,
          canStartRenderDispatcherCutover: false,
        },
      },
    },
  };
}

function createDeps(overrides: Partial<WorkerFirstRuntimeExportPlaybackSmokeDeps> = {}): WorkerFirstRuntimeExportPlaybackSmokeDeps {
  return {
    materializeFixture: vi.fn(async () => ({
      success: true,
      data: { projectId: 'solid-text-image', durationSeconds: 2.25 },
    })),
    getStats: vi.fn(async () => statsResult()),
    simulatePlayback: vi.fn(async () => ({
      success: true,
      data: {
        requestedDurationMs: 1000,
        actualDurationMs: 1016,
        initialPosition: 0,
        finalPosition: 1,
        deltaSeconds: 1,
        framesObserved: 60,
        movingFrames: 58,
        stalledFrames: 2,
        longestStallFrames: 1,
        endedPlaying: false,
      },
    })),
    debugExport: vi.fn(async () => ({
      success: true,
      data: {
        elapsedMs: 800,
        timedOut: false,
        blob: { size: 4096, type: 'video/mp4' },
        progressSamples: [{ percent: 0 }, { percent: 100 }],
      },
    })),
    getPlaybackTrace: vi.fn(async () => traceResult()),
    now: (() => {
      let value = 1000;
      return () => value += 25;
    })(),
    ...overrides,
  };
}

describe('worker-first runtime export/playback smoke', () => {
  it('materializes a controlled fixture, runs playback/export, and verifies runtime diagnostics stay observation-only', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({
      width: 640,
      height: 360,
      playbackDurationMs: 750,
      exportDurationSeconds: 0.5,
      exportWidth: 160,
      exportHeight: 90,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith({
      resetProject: true,
      width: 640,
      height: 360,
      durationSeconds: 2.25,
    });
    expect(deps.simulatePlayback).toHaveBeenCalledWith(expect.objectContaining({
      startTime: 0,
      durationMs: 750,
      restorePlaybackState: false,
    }));
    expect(deps.debugExport).toHaveBeenCalledWith(expect.objectContaining({
      startTime: 0,
      durationSeconds: 0.5,
      width: 160,
      height: 90,
      includeAudio: false,
      download: false,
    }));
    expect(deps.getStats).toHaveBeenCalledTimes(2);
    expect(deps.getPlaybackTrace).toHaveBeenCalledWith({ windowMs: 5000, limit: 200 });
    expect(result.data).toMatchObject({
      checks: {
        playbackSucceeded: true,
        playbackObservedMotion: true,
        exportSucceeded: true,
        exportProducedBlob: true,
        runtimeFeedsPresent: true,
        statsStartPermissionsRemainFalse: true,
        traceStartPermissionsRemainFalse: true,
      },
      playback: {
        movingFrames: 58,
      },
      export: {
        blobSize: 4096,
      },
      statsAfter: {
        w5GateEvidenceMode: 'stats-observation',
        canStartWorkerWebGpu: false,
      },
      w5StartPermissionsRemainStatsGuarded: true,
    });
  });

  it('rejects caller-supplied proof or start-permission evidence', async () => {
    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({
      fingerprint: { hash: 'spoof' },
      canStartWorkerWebGpu: true,
    }, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('caller-supplied proof fields');
    expect(result.data).toMatchObject({
      forbiddenFields: ['fingerprint', 'canStartWorkerWebGpu'],
    });
  });

  it('fails when export evidence or start-permission invariants are not satisfied', async () => {
    const deps = createDeps({
      getStats: vi.fn(async () => statsResult({ startPermissions: true })),
      debugExport: vi.fn(async () => ({
        success: true,
        data: {
          elapsedMs: 100,
          timedOut: false,
          blob: { size: 0, type: 'video/mp4' },
          progressSamples: [],
        },
      })),
    });

    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not satisfy');
    expect(result.data).toMatchObject({
      checks: {
        exportSucceeded: true,
        exportProducedBlob: false,
        statsStartPermissionsRemainFalse: false,
      },
      statsAfter: {
        canStartWorkerWebGpu: true,
      },
    });
  });
});
