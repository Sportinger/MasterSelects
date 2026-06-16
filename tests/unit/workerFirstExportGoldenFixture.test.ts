import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstExportGoldenFixture,
  type WorkerFirstExportGoldenFixtureDeps,
} from '../../src/services/aiTools/workerFirstExportGoldenFixture';

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
} = {}): WorkerFirstExportGoldenFixtureDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'export',
        exportRun: {
          completed: true,
          blobSize: 2048,
          previewSampleCount: 4,
          failures: [],
          sampleTime: 0,
          exportDurationSeconds: 2.15,
        },
        timelineSignals: ['export', 'image', 'render-target', 'solid', 'text'],
      },
    }),
    captureGoldenFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'export',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          timelineSignals: ['export', 'image', 'render-target', 'solid', 'text'],
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

describe('worker-first export golden fixture runner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes the export parity path and captures every manifest sample', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstExportGoldenFixture({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'export',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'export',
      sampleTimeSeconds: 0,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    }, expect.objectContaining({ projectId: 'export' }));
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'export',
      sampleTimeSeconds: 1,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    }, expect.objectContaining({ projectId: 'export' }));
    expect(deps.captureGoldenFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'export',
      sampleTimeSeconds: 2,
      settleMs: 900,
      sampleWidth: 12,
      sampleHeight: 10,
    }, expect.objectContaining({ projectId: 'export' }));
    expect(result.data).toMatchObject({
      projectId: 'export',
      manifestSampleTimesSeconds: [0, 1, 2],
      w5StartPermissionsRemainStatsGuarded: true,
      failures: [],
    });
  });

  it('rejects attempts to override project, proof fields, export range, codec, blob, or preview evidence', async () => {
    const wrongProject = await handleRunWorkerFirstExportGoldenFixture({
      projectId: 'bake',
    }, createDeps());
    expect(wrongProject.success).toBe(false);
    expect(wrongProject.error).toContain('only materializes');

    for (const args of [
      { source: 'export-frame' },
      { fingerprint: { hash: 'spoof' } },
      { sampleTimeSeconds: 1 },
      { targetSnapshot: {} },
    ]) {
      const result = await handleRunWorkerFirstExportGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the export manifest');
    }

    for (const args of [
      { startTime: 0 },
      { endTime: 1 },
      { exportDurationSeconds: 1 },
      { exportWidth: 320 },
      { exportHeight: 180 },
      { exportFps: 8 },
      { fps: 8 },
      { sampleTimes: [0] },
      { exportMode: 'precise' },
      { includePrecise: true },
      { download: true },
      { codec: 'vp9' },
      { container: 'webm' },
      { maxRuntimeMs: 1000 },
      { createSynthetic: true },
      { captureMode: 'dom' },
      { requireTimelineDom: true },
      { exportRun: {} },
      { fastRun: {} },
      { preciseRun: {} },
      { blob: {} },
      { blobSize: 1 },
      { progressSamples: [] },
      { exportStats: {} },
      { exportPreviewFrame: {} },
      { exportPreviewFrameTime: 0 },
      { previewSampleCount: 1 },
    ]) {
      const result = await handleRunWorkerFirstExportGoldenFixture(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('controlled by the export runner');
    }
  });

  it('does not capture when export fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'Export preview parity failed',
      },
    });

    const result = await handleRunWorkerFirstExportGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Export preview parity failed');
    expect(deps.captureGoldenFingerprint).not.toHaveBeenCalled();
  });

  it('returns capture failures while preserving successful sample evidence', async () => {
    const deps = createDeps({
      captureResults: [
        { success: true, data: { sampleTimeSeconds: 0, source: 'main-renderer' } },
        { success: false, error: 'missing export signal' },
        { success: true, data: { sampleTimeSeconds: 2, source: 'main-renderer' } },
      ],
    });

    const result = await handleRunWorkerFirstExportGoldenFixture({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('One or more');
    expect(deps.captureGoldenFingerprint).toHaveBeenCalledTimes(3);
    expect(result.data).toMatchObject({
      failures: [{ success: false, error: 'missing export signal' }],
      captures: [
        { sampleTimeSeconds: 0, source: 'main-renderer' },
        { error: 'missing export signal' },
        { sampleTimeSeconds: 2, source: 'main-renderer' },
      ],
    });
  });

  it('restores the previous timeline when explicitly requested', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstExportGoldenFixture({
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
