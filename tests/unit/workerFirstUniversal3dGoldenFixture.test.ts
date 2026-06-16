import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstUniversal3dGoldenFixture,
  type WorkerFirstUniversal3dGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstUniversal3dGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstUniversal3dGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'universal-3d-gaussian-cad',
        clipIds: {
          model: 'wfg-model-clip',
          gaussian: 'wfg-gaussian-signal-clip',
          cad: 'wfg-cad-signal-clip',
        },
        signalAssetIds: {
          gaussian: 'wfg-gaussian-signal-asset',
          cad: 'wfg-cad-signal-asset',
        },
        timelineSignals: ['3d', 'cad', 'gaussian', 'model', 'text'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'universal-3d-gaussian-cad',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          timelineSignals: ['3d', 'cad', 'gaussian', 'model', 'text'],
        },
      }
    )),
    beginMutation: vi.fn(() => vi.fn()),
    captureRestoreState: vi.fn(() => ({ id: 'restore-state' } as never)),
    restoreTimeline: vi.fn(async () => ({
      restoredTrackCount: 3,
      restoredClipCount: 4,
      restoredPlayheadPosition: 0,
      resumedPlayback: false,
    })),
  };
}

describe('worker-first universal 3D/Gaussian/CAD golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes descriptors and captures every manifest sample', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstUniversal3dGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'universal-3d-gaussian-cad',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'universal-3d-gaussian-cad',
      sampleTimeSeconds: 0,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'universal-3d-gaussian-cad',
      sampleTimeSeconds: 1,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'universal-3d-gaussian-cad',
      sampleTimeSeconds: 2,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'universal-3d-gaussian-cad',
      manifestSampleTimesSeconds: [0, 1, 2],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, descriptors, or signal evidence', async () => {
    const wrongProject = await handleRunWorkerFirstUniversal3dGoldenFixture({
      projectId: 'export',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1 },
      { targetSnapshot: {} },
    ]) {
      const result = await handleRunWorkerFirstUniversal3dGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the universal-3d-gaussian-cad manifest');
    }

    for (const args of [
      { tracks: [] },
      { clips: [] },
      { timelineSignals: ['3d'] },
      { signalAssets: [] },
      { signalAssetId: 'signal' },
      { signalRefId: 'ref' },
      { signalRenderAdapterId: 'adapter' },
      { modelClip: {} },
      { gaussianClip: {} },
      { cadClip: {} },
      { meshType: 'cube' },
      { modelUrl: 'blob:model' },
      { modelFileName: 'model.glb' },
      { gaussianSplatUrl: 'blob:splat' },
      { gaussianSplatFileName: 'scene.splat' },
      { gaussianSplatRuntimeKey: 'runtime' },
      { cadFileName: 'drawing.dxf' },
      { cadMimeType: 'image/vnd.dxf' },
      { contentFixture: {} },
    ]) {
      const result = await handleRunWorkerFirstUniversal3dGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the fixture runner');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'missing cad signal',
      },
    });

    const result = await handleRunWorkerFirstUniversal3dGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing cad signal');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing gaussian signal' },
        { success: true, data: { sampleTimeSeconds: 2, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstUniversal3dGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing gaussian signal' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing gaussian signal' },
        { sampleTimeSeconds: 2, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstUniversal3dGoldenFixture({
      restoreTimelineAfterRun: true,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.captureRestoreState).toHaveBeenCalledTimes(1);
    expect(deps.restoreTimeline).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      restoredTimeline: {
        restoredTrackCount: 3,
        restoredClipCount: 4,
        restoredPlayheadPosition: 0,
      },
    });
  });
});
