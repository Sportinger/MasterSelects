import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstSolidTextImageGoldenFixture,
  type WorkerFirstSolidTextImageGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstSolidTextImageGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstSolidTextImageGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'solid-text-image',
        timelineSignals: ['image', 'solid', 'text'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'solid-text-image',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
        },
      }
    )),
    beginMutation: vi.fn(() => vi.fn()),
    captureRestoreState: vi.fn(() => ({ id: 'restore-state' } as never)),
    restoreTimeline: vi.fn(async () => ({
      restoredTrackCount: 2,
      restoredClipCount: 4,
      restoredPlayheadPosition: 0.25,
      resumedPlayback: false,
    })),
  };
}

describe('worker-first solid/text/image golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstSolidTextImageGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'solid-text-image',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0.5,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'solid-text-image',
      sampleTimeSeconds: 1,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'solid-text-image',
      manifestSampleTimesSeconds: [0, 0.5, 1],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, source, fingerprint, or sample times', async () => {
    const wrongProject = await handleRunWorkerFirstSolidTextImageGoldenFixture({
      projectId: 'multi-video',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 0 },
    ]) {
      const result = await handleRunWorkerFirstSolidTextImageGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the solid-text-image manifest');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'fixture failed',
      },
    });

    const result = await handleRunWorkerFirstSolidTextImageGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing canvas' },
        { success: true, data: { sampleTimeSeconds: 1, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstSolidTextImageGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing canvas' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing canvas' },
        { sampleTimeSeconds: 1, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstSolidTextImageGoldenFixture({
      restoreTimelineAfterRun: true,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.captureRestoreState).toHaveBeenCalledTimes(1);
    expect(deps.restoreTimeline).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      restoredTimeline: {
        restoredTrackCount: 2,
        restoredClipCount: 4,
        restoredPlayheadPosition: 0.25,
      },
    });
  });
});
