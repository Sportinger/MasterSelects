import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture,
  type WorkerFirstMultiTargetOutputSliceGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstMultiTargetOutputSliceGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstMultiTargetOutputSliceGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'multi-target-output-slice',
        targetIds: ['wfg-output-slice-target-a', 'wfg-output-slice-target-b'],
        activeCompositionTargetIds: ['wfg-output-slice-target-a', 'wfg-output-slice-target-b'],
        sliceTargetId: 'wfg-output-slice-target-a',
        enabledSliceCount: 1,
        timelineSignals: ['image', 'output-slice', 'render-target', 'solid', 'text'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'multi-target-output-slice',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          activeCompositionTargetIds: ['wfg-output-slice-target-a', 'wfg-output-slice-target-b'],
          enabledSliceCount: 1,
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

describe('worker-first multi-target/output-slice golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'multi-target-output-slice',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'multi-target-output-slice',
      sampleTimeSeconds: 0,
      settleMs: 600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'multi-target-output-slice',
      sampleTimeSeconds: 1,
      settleMs: 600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'multi-target-output-slice',
      sampleTimeSeconds: 2,
      settleMs: 600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'multi-target-output-slice',
      manifestSampleTimesSeconds: [0, 1, 2],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, sample times, targets, canvases, or slice state', async () => {
    const wrongProject = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture({
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
      const result = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the multi-target-output-slice manifest');
    }

    for (const args of [
      { targetIds: ['different-target'] },
      { renderTargets: [] },
      { outputTargets: [] },
      { slices: [] },
      { outputSlices: [] },
      { sliceConfigs: {} },
      { canvases: [] },
    ]) {
      const result = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('render targets, canvases, and slice configuration are controlled');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'fixture failed',
      },
    });

    const result = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing output slice signal' },
        { success: true, data: { sampleTimeSeconds: 2, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing output slice signal' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing output slice signal' },
        { sampleTimeSeconds: 2, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture({
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
