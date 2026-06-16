import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstMultiVideoGoldenFixture,
  type WorkerFirstMultiVideoGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstMultiVideoGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstMultiVideoGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'multi-video',
        timelineSignals: ['audio-clock', 'video'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'multi-video',
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

describe('worker-first multi-video golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstMultiVideoGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'multi-video',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(4);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'multi-video',
      sampleTimeSeconds: 1,
      settleMs: 1600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'multi-video',
      sampleTimeSeconds: 2,
      settleMs: 1600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'multi-video',
      sampleTimeSeconds: 3,
      settleMs: 1600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(4, {
      projectId: 'multi-video',
      sampleTimeSeconds: 4,
      settleMs: 1600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'multi-video',
      manifestSampleTimesSeconds: [1, 2, 3, 4],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, sample times, or fixture assets', async () => {
    const wrongProject = await handleRunWorkerFirstMultiVideoGoldenFixture({
      projectId: 'solid-text-image',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 0 },
    ]) {
      const result = await handleRunWorkerFirstMultiVideoGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the multi-video manifest');
    }

    for (const args of [
      { assetUrls: ['/different.webm'] },
      { paths: ['C:/tmp/different.webm'] },
      { files: ['different.webm'] },
    ]) {
      const result = await handleRunWorkerFirstMultiVideoGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('asset list is controlled');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'fixture failed',
      },
    });

    const result = await handleRunWorkerFirstMultiVideoGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 1, source: 'main-renderer' } },
        { success: false, error: 'missing canvas' },
        { success: true, data: { sampleTimeSeconds: 3, source: 'main-renderer' } },
        { success: true, data: { sampleTimeSeconds: 4, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstMultiVideoGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(4);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing canvas' }],
      captures: [
        { sampleTimeSeconds: 1, source: 'main-renderer' },
        { error: 'missing canvas' },
        { sampleTimeSeconds: 3, source: 'main-renderer' },
        { sampleTimeSeconds: 4, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstMultiVideoGoldenFixture({
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
