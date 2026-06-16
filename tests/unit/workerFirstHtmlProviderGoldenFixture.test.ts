import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstHtmlProviderGoldenFixture,
  type WorkerFirstHtmlProviderGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstHtmlProviderGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstHtmlProviderGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'html-provider-fallback',
        timelineSignals: ['html-video', 'video'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'html-provider-fallback',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
        },
      }
    )),
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

describe('worker-first html-provider-fallback golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the fixture and captures every manifest sample through the golden bridge', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstHtmlProviderGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'html-provider-fallback',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'html-provider-fallback',
      sampleTimeSeconds: 0,
      settleMs: 1200,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'html-provider-fallback',
      sampleTimeSeconds: 1,
      settleMs: 1200,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'html-provider-fallback',
      sampleTimeSeconds: 2,
      settleMs: 1200,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(result.data).toMatchObject({
      projectId: 'html-provider-fallback',
      manifestSampleTimesSeconds: [0, 1, 2],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, sample times, or provider handles', async () => {
    const wrongProject = await handleRunWorkerFirstHtmlProviderGoldenFixture({
      projectId: 'multi-video',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'worker-shadow-main' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1 },
    ]) {
      const result = await handleRunWorkerFirstHtmlProviderGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the html-provider-fallback manifest');
    }

    for (const args of [
      { assetUrls: ['/different.webm'] },
      { paths: ['C:/tmp/different.webm'] },
      { files: ['different.webm'] },
      { videoElement: {} },
      { webCodecsPlayer: {} },
    ]) {
      const result = await handleRunWorkerFirstHtmlProviderGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('asset and provider handles are controlled');
    }
  });

  it('does not capture when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'fixture failed',
      },
    });

    const result = await handleRunWorkerFirstHtmlProviderGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing canvas' },
        { success: true, data: { sampleTimeSeconds: 2, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstHtmlProviderGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing canvas' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing canvas' },
        { sampleTimeSeconds: 2, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstHtmlProviderGoldenFixture({
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
