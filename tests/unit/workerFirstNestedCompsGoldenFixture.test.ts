import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstNestedCompsGoldenFixture,
  type WorkerFirstNestedCompsGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstNestedCompsGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstNestedCompsGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'nested-comps',
        timelineSignals: ['composition', 'nested-composition'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'nested-comps',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
        },
      }
    )),
    beginMutation: vi.fn(() => vi.fn()),
    captureRestoreState: vi.fn(() => ({ id: 'restore-state' } as never)),
    restoreTimeline: vi.fn(async () => ({
      restoredTrackCount: 3,
      restoredClipCount: 3,
      restoredPlayheadPosition: 0.25,
      resumedPlayback: false,
    })),
  };
}

describe('worker-first nested-comps golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstNestedCompsGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'nested-comps',
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'nested-comps',
      sampleTimeSeconds: 0,
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'nested-comps',
      sampleTimeSeconds: 1.25,
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'nested-comps',
      sampleTimeSeconds: 2.5,
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    });
    expect(result.data).toMatchObject({
      projectId: 'nested-comps',
      manifestSampleTimesSeconds: [0, 1.25, 2.5],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, sample times, or the fixture tree', async () => {
    const wrongProject = await handleRunWorkerFirstNestedCompsGoldenFixture({
      projectId: 'multi-video',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1.25 },
    ]) {
      const result = await handleRunWorkerFirstNestedCompsGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the nested-comps manifest');
    }

    for (const args of [
      { compositionId: 'caller-comp' },
      { compositions: [] },
      { timelineData: {} },
      { tracks: [] },
      { clips: [] },
      { nestedClips: [] },
    ]) {
      const result = await handleRunWorkerFirstNestedCompsGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('composition tree is controlled');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'fixture failed',
      },
    });

    const result = await handleRunWorkerFirstNestedCompsGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing canvas' },
        { success: true, data: { sampleTimeSeconds: 2.5, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstNestedCompsGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing canvas' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing canvas' },
        { sampleTimeSeconds: 2.5, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstNestedCompsGoldenFixture({
      restoreTimelineAfterRun: true,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.captureRestoreState).toHaveBeenCalledTimes(1);
    expect(deps.restoreTimeline).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      restoredTimeline: {
        restoredTrackCount: 3,
        restoredClipCount: 3,
        restoredPlayheadPosition: 0.25,
      },
    });
  });
});
