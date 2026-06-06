import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportClipState } from '../../src/engine/export/types';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

const mocks = vi.hoisted(() => ({
  prepareClipsForExport: vi.fn(),
  cleanupExportMode: vi.fn(),
  initializeLayerBuilder: vi.fn(),
  cleanupLayerBuilder: vi.fn(),
  buildLayersAtTime: vi.fn(() => []),
  preload3DAssetsForExport: vi.fn(async () => undefined),
  preloadGaussianSplatsForExport: vi.fn(async () => undefined),
  seekAllClipsToTime: vi.fn(async () => undefined),
  waitForAllVideosReady: vi.fn(async () => undefined),
  getTimelineState: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: mocks.getTimelineState,
  },
}));

vi.mock('../../src/engine/export/ClipPreparation', () => ({
  prepareClipsForExport: mocks.prepareClipsForExport,
  cleanupExportMode: mocks.cleanupExportMode,
}));

vi.mock('../../src/engine/export/ExportLayerBuilder', () => ({
  buildLayersAtTime: mocks.buildLayersAtTime,
  cleanupLayerBuilder: mocks.cleanupLayerBuilder,
  initializeLayerBuilder: mocks.initializeLayerBuilder,
}));

vi.mock('../../src/engine/export/preloadGaussianSplats', () => ({
  preload3DAssetsForExport: mocks.preload3DAssetsForExport,
  preloadGaussianSplatsForExport: mocks.preloadGaussianSplatsForExport,
}));

vi.mock('../../src/engine/export/VideoSeeker', () => ({
  seekAllClipsToTime: mocks.seekAllClipsToTime,
  waitForAllVideosReady: mocks.waitForAllVideosReady,
}));

const { FFmpegFrameRenderer } = await import('../../src/components/export/exportHelpers');

function createClipState(): ExportClipState {
  return {
    clipId: 'clip-export',
    webCodecsPlayer: null,
    lastSampleIndex: 0,
    isSequential: false,
    runtimeSource: {
      type: 'video',
      runtimeSourceId: 'runtime-source',
      runtimeSessionKey: 'export:runtime-source',
      mediaFileId: 'media-export',
    },
  };
}

describe('FFmpegFrameRenderer runtime reporting', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    mocks.getTimelineState.mockReturnValue({
      tracks: [{ id: 'video-1', visible: true }],
      getClipsAtTime: vi.fn(() => []),
      getInterpolatedTransform: vi.fn(),
      getInterpolatedEffects: vi.fn(() => []),
      getInterpolatedColorCorrection: vi.fn(),
      getInterpolatedVectorAnimationSettings: vi.fn(),
      getInterpolatedTextBounds: vi.fn(),
      getSourceTimeForClip: vi.fn(() => 0),
      getInterpolatedSpeed: vi.fn(() => 1),
    });
    mocks.prepareClipsForExport.mockResolvedValue({
      clipStates: new Map([['clip-export', createClipState()]]),
      parallelDecoder: null,
      useParallelDecode: false,
      exportMode: 'precise',
    });
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.clearAllMocks();
  });

  it('reports and releases FFmpeg renderer export run resources', async () => {
    const renderer = new FFmpegFrameRenderer({
      width: 1280,
      height: 720,
      fps: 30,
      startTime: 0,
      endTime: 2,
      runtimeReporting: true,
      runtimeExportKind: 'ffmpeg-video',
      includeAudio: true,
    });

    await renderer.initialize();

    const runId = renderer.getRuntimeRunId();
    const stats = timelineRuntimeCoordinator.getBridgeStats().policies.export;
    expect(runId).toEqual(expect.any(String));
    expect(mocks.prepareClipsForExport).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1280,
        height: 720,
        fps: 30,
        startTime: 0,
        endTime: 2,
      }),
      'precise',
      runId
    );
    expect(stats.resources.map((resource) => resource.kind).toSorted()).toEqual([
      'image-canvas',
      'job',
      'runtime-binding',
    ]);
    expect(stats.budgetReport.usage).toMatchObject({
      resources: 3,
      jobs: 1,
      sessions: 1,
      imageBitmaps: 1,
    });

    renderer.cleanup();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
    expect(mocks.cleanupExportMode).toHaveBeenCalledTimes(1);
  });

  it('does not report resources when runtime reporting is disabled', async () => {
    const renderer = new FFmpegFrameRenderer({
      width: 1280,
      height: 720,
      fps: 30,
      startTime: 0,
      endTime: 2,
    });

    await renderer.initialize();

    expect(renderer.getRuntimeRunId()).toBeNull();
    expect(mocks.prepareClipsForExport).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1280,
        height: 720,
        fps: 30,
        startTime: 0,
        endTime: 2,
      }),
      'precise',
      undefined
    );
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
    renderer.cleanup();
  });

  it('releases the reported export job when preparation fails', async () => {
    mocks.prepareClipsForExport.mockRejectedValueOnce(new Error('prepare failed'));
    const renderer = new FFmpegFrameRenderer({
      width: 1280,
      height: 720,
      fps: 30,
      startTime: 0,
      endTime: 2,
      runtimeReporting: true,
    });

    await expect(renderer.initialize()).rejects.toThrow('prepare failed');

    expect(renderer.getRuntimeRunId()).toEqual(expect.any(String));
    expect(mocks.prepareClipsForExport).toHaveBeenCalledWith(
      expect.any(Object),
      'precise',
      renderer.getRuntimeRunId()
    );
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.resources).toHaveLength(0);
    expect(mocks.cleanupExportMode).toHaveBeenCalledWith(expect.any(Map), null);
  });
});
