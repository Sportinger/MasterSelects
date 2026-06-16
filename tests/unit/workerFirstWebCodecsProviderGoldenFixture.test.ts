import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstWebCodecsProviderGoldenFixture,
  type WorkerFirstWebCodecsProviderGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstWebCodecsProviderGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstWebCodecsProviderGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'webcodecs-provider',
        timelineSignals: ['video', 'webcodecs'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'webcodecs-provider',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
        },
      }
    )),
    enableFixtureFlags: vi.fn(() => vi.fn()),
    beginMutation: vi.fn(() => vi.fn()),
    captureRestoreState: vi.fn(() => ({ id: 'restore-state' } as never)),
    restoreTimeline: vi.fn(async () => ({
      restoredTrackCount: 2,
      restoredClipCount: 2,
      restoredPlayheadPosition: 0.25,
      resumedPlayback: false,
    })),
  };
}

describe('worker-first webcodecs-provider golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstWebCodecsProviderGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'webcodecs-provider',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.enableFixtureFlags).toHaveBeenCalledTimes(1);
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 0,
      settleMs: 1500,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 0.75,
      settleMs: 1500,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 1.5,
      settleMs: 1500,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'webcodecs-provider',
      manifestSampleTimesSeconds: [0, 0.75, 1.5],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, sample times, or provider handles', async () => {
    const wrongProject = await handleRunWorkerFirstWebCodecsProviderGoldenFixture({
      projectId: 'multi-video',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1 },
    ]) {
      const result = await handleRunWorkerFirstWebCodecsProviderGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the webcodecs-provider manifest');
    }

    for (const args of [
      { assetUrls: ['/different.mp4'] },
      { paths: ['C:/tmp/different.mp4'] },
      { files: ['different.mp4'] },
      { videoElement: {} },
      { webCodecsPlayer: {} },
    ]) {
      const result = await handleRunWorkerFirstWebCodecsProviderGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('asset and provider handles are controlled');
    }
  });

  it('does not capture when fixture materialization fails and restores fixture flags', async () => {
    const restoreFlags = vi.fn();
    const deps = {
      ...createDeps({
        materializeResult: {
          success: false,
          error: 'fixture failed',
        },
      }),
      enableFixtureFlags: vi.fn(() => restoreFlags),
    };

    const result = await handleRunWorkerFirstWebCodecsProviderGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
    expect(restoreFlags).toHaveBeenCalledTimes(1);
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing canvas' },
        { success: true, data: { sampleTimeSeconds: 1.5, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstWebCodecsProviderGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing canvas' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing canvas' },
        { sampleTimeSeconds: 1.5, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstWebCodecsProviderGoldenFixture({
      restoreTimelineAfterRun: true,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.captureRestoreState).toHaveBeenCalledTimes(1);
    expect(deps.restoreTimeline).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      restoredTimeline: {
        restoredTrackCount: 2,
        restoredClipCount: 2,
        restoredPlayheadPosition: 0.25,
      },
    });
  });
});
