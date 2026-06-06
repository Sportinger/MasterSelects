import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureTimelineCanvasSmokeRestoreState,
  createTimelineCanvasSmokeClips,
  createTimelineCanvasSmokeTracks,
  handleRunTimelineCanvasBladeToolSmoke,
  handleRunTimelineCanvasLargeProjectSmoke,
  handleRunTimelineCanvasPlayheadSmoothnessSmoke,
  handleRunTimelineCanvasThumbnailReloadSmoke,
  assertCanvasSmokeSnapshot,
  assertTimelineCanvasFrameLoopBudget,
  assertTimelineCanvasStepInvariants,
  restoreTimelineCanvasSmokeState,
  shouldRestoreTimelineAfterCanvasSmoke,
  summarizeNumbers,
} from '../../src/services/aiTools/handlers/timelineCanvasSmoke';
import { flags } from '../../src/engine/featureFlags';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { thumbnailCacheService } from '../../src/services/thumbnailCacheService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('timeline canvas smoke helpers', () => {
  it('creates bounded synthetic tracks for large-project browser smoke', () => {
    const tracks = createTimelineCanvasSmokeTracks(3, 2);

    expect(tracks).toHaveLength(5);
    expect(tracks.map((track) => track.id)).toEqual([
      'smoke-video-1',
      'smoke-video-2',
      'smoke-video-3',
      'smoke-audio-1',
      'smoke-audio-2',
    ]);
    expect(tracks.every((track) => track.visible && !track.muted && !track.solo)).toBe(true);
  });

  it('creates data-only solid clips spread across video tracks without media runtime', () => {
    const tracks = createTimelineCanvasSmokeTracks(2, 1);
    const clips = createTimelineCanvasSmokeClips({
      tracks,
      clipCount: 6,
      durationSeconds: 20,
      clipDurationSeconds: 1.5,
    });

    expect(clips).toHaveLength(6);
    expect(clips.map((clip) => clip.trackId)).toEqual([
      'smoke-video-1',
      'smoke-video-2',
      'smoke-video-1',
      'smoke-video-2',
      'smoke-video-1',
      'smoke-video-2',
    ]);
    expect(clips.every((clip) => clip.source?.type === 'solid')).toBe(true);
    expect(clips.every((clip) => !clip.source?.videoElement && !clip.source?.audioElement && !clip.source?.webCodecsPlayer)).toBe(true);
    expect(clips.every((clip) => clip.startTime >= 0 && clip.startTime + clip.duration <= 20)).toBe(true);
  });

  it('summarizes frame deltas for report output', () => {
    expect(summarizeNumbers([])).toEqual({ count: 0, min: 0, max: 0, avg: 0 });
    expect(summarizeNumbers([10, 20, 30])).toEqual({ count: 3, min: 10, max: 30, avg: 20 });
  });

  it('asserts large-project frame-loop budgets with concrete failure messages', () => {
    const healthy = assertTimelineCanvasFrameLoopBudget({
      durationMs: 750,
      frameCount: 45,
      estimatedFps: 60,
      frameDeltaMs: { count: 45, min: 16, max: 22, avg: 17 },
      slowFrameCount: 0,
      droppedFrameEstimate: 0,
    }, {
      minEstimatedFps: 45,
      maxDroppedFrameEstimate: 8,
      maxSlowFrameCount: 4,
      maxFrameDeltaMs: 70,
    });
    expect(healthy).toEqual([]);

    const failures = assertTimelineCanvasFrameLoopBudget({
      durationMs: 750,
      frameCount: 20,
      estimatedFps: 26.7,
      frameDeltaMs: { count: 20, min: 16, max: 120, avg: 38 },
      slowFrameCount: 9,
      droppedFrameEstimate: 18,
    }, {
      minEstimatedFps: 45,
      maxDroppedFrameEstimate: 8,
      maxSlowFrameCount: 4,
      maxFrameDeltaMs: 70,
    });
    expect(failures).toEqual([
      'large project estimated FPS 26.7/45',
      'large project dropped frame estimate 18/8',
      'large project slow frame count 9/4',
      'large project max frame delta 120ms/70ms',
    ]);
  });

  it('asserts per-step large-project DOM, worker, shell, and position invariants', () => {
    const healthy = assertTimelineCanvasStepInvariants({
      label: 'zoom:12:scroll:0.5',
      requestedZoom: 12,
      zoom: 12,
      requestedScrollX: 120,
      scrollX: 120,
      dom: {
        hasDocument: true,
        hasTimelineTracks: true,
        timelineCanvasCount: 1,
        legacyClipBodyCount: 0,
        previewClipCount: 0,
        domOverlayCount: 0,
        interactionShellCount: 0,
        trackLaneCount: 1,
        guidedScrollX: '120',
        guidedZoom: '12',
      },
      canvasTotals: {
        domClipBodyCount: 0,
        workerTrackCount: 0,
        shellCount: 0,
      },
    }, {
      requireTimelineDom: true,
      maxWorkerTrackCount: 0,
      maxShellCount: 0,
      assertRequestedPosition: true,
    });
    expect(healthy).toEqual([]);

    const failures = assertTimelineCanvasStepInvariants({
      label: 'zoom:12:scroll:0.5',
      requestedZoom: 12,
      zoom: 10,
      requestedScrollX: 120,
      scrollX: 90,
      dom: {
        hasDocument: true,
        hasTimelineTracks: false,
        timelineCanvasCount: 1,
        legacyClipBodyCount: 1,
        previewClipCount: 0,
        domOverlayCount: 1,
        interactionShellCount: 2,
        trackLaneCount: 1,
        guidedScrollX: '90',
        guidedZoom: '10',
      },
      canvasTotals: {
        domClipBodyCount: 1,
        workerTrackCount: 1,
        workerPendingTrackCount: 1,
        workerErrorTrackCount: 1,
        workerErrors: { 'worker-messageerror': 1 },
        workerResourceBytes: 4096,
        shellCount: 2,
      },
    }, {
      requireTimelineDom: true,
      maxWorkerTrackCount: 0,
      maxWorkerPendingTrackCount: 0,
      maxWorkerErrorTrackCount: 0,
      maxWorkerResourceBytes: 1024,
      maxShellCount: 0,
      assertRequestedPosition: true,
    });
    expect(failures).toEqual([
      'zoom:12:scroll:0.5: timeline DOM target was not found',
      'zoom:12:scroll:0.5: legacy .timeline-clip bodies mounted: 1',
      'zoom:12:scroll:0.5: canvas diagnostics reported DOM clip bodies: 1',
      'zoom:12:scroll:0.5: worker tracks 1/0',
      'zoom:12:scroll:0.5: worker pending tracks 1/0',
      'zoom:12:scroll:0.5: worker error tracks 1/0 (worker-messageerror:1)',
      'zoom:12:scroll:0.5: worker resource bytes 4096/1024 max',
      'zoom:12:scroll:0.5: interaction shells 2/0',
      'zoom:12:scroll:0.5: zoom 10/12',
      'zoom:12:scroll:0.5: scrollX 90/120',
    ]);
  });

  it('asserts snapshot worker resource budgets', () => {
    const failures = assertCanvasSmokeSnapshot({
      label: 'after',
      timeline: {
        trackCount: 1,
        clipCount: 4,
        selectedClipCount: 0,
        zoom: 12,
        scrollX: 0,
        duration: 10,
        audioDisplayMode: 'detailed',
        ramPreviewRange: null,
        cachedFrameCount: 0,
        compositionClipCount: 0,
        audioLikeClipCount: 0,
      },
      dom: {
        hasDocument: true,
        hasTimelineTracks: true,
        timelineCanvasCount: 1,
        legacyClipBodyCount: 0,
        previewClipCount: 0,
        domOverlayCount: 0,
        interactionShellCount: 0,
        trackLaneCount: 1,
        guidedScrollX: '0',
        guidedZoom: '12',
      },
      canvasDiagnostics: {
        totals: {
          domClipBodyCount: 0,
          drawnClipCount: 4,
          workerTrackCount: 1,
          workerPendingTrackCount: 1,
          workerErrorTrackCount: 1,
          workerErrors: { 'worker-runtime-error:draw failed': 1 },
          workerResourceBytes: 2048,
          shellCount: 0,
        },
      },
      runtimeCoordinator: {},
    }, {
      maxWorkerPendingTrackCount: 0,
      maxWorkerErrorTrackCount: 0,
      maxWorkerResourceBytes: 1024,
    });

    expect(failures).toEqual([
      'worker pending tracks 1/0',
      'worker error tracks 1/0 (worker-runtime-error:draw failed:1)',
      'worker resource bytes 2048/1024 max',
    ]);
  });

  it('allows whitelisted worker fallback reasons while rejecting video fallback reasons', () => {
    const baseSnapshot = {
      label: 'after',
      timeline: {
        trackCount: 3,
        clipCount: 8,
        selectedClipCount: 0,
        zoom: 12,
        scrollX: 0,
        duration: 10,
        audioDisplayMode: 'detailed',
        ramPreviewRange: null,
        cachedFrameCount: 0,
        compositionClipCount: 0,
        audioLikeClipCount: 4,
      },
      dom: {
        hasDocument: true,
        hasTimelineTracks: true,
        timelineCanvasCount: 3,
        legacyClipBodyCount: 0,
        previewClipCount: 0,
        domOverlayCount: 0,
        interactionShellCount: 0,
        trackLaneCount: 3,
        guidedScrollX: '0',
        guidedZoom: '12',
      },
      canvasDiagnostics: {
        totals: {
          domClipBodyCount: 0,
          drawnClipCount: 8,
          workerTrackCount: 1,
          workerEligibleTrackCount: 1,
          workerFallbackTrackCount: 2,
          workerFallbackReasons: {
            'audio-resource-visuals': 2,
          },
          shellCount: 0,
        },
      },
      runtimeCoordinator: {},
    };

    expect(assertCanvasSmokeSnapshot(baseSnapshot, {
      maxWorkerFallbackTrackCount: 2,
      allowedWorkerFallbackReasons: ['audio-resource-visuals'],
    })).toEqual([]);

    const failures = assertCanvasSmokeSnapshot({
      ...baseSnapshot,
      canvasDiagnostics: {
        totals: {
          ...baseSnapshot.canvasDiagnostics.totals,
          workerFallbackReasons: {
            'audio-resource-visuals': 2,
            'thumbnail-visuals': 1,
          },
        },
      },
    }, {
      maxWorkerFallbackTrackCount: 3,
      allowedWorkerFallbackReasons: ['audio-resource-visuals'],
    });

    expect(failures).toEqual(['unexpected worker fallback reason: thumbnail-visuals:1']);
  });

  it('restores the pre-smoke timeline state after temporary smoke mutation', async () => {
    const originalTrack = {
      ...createTimelineCanvasSmokeTracks(1)[0],
      id: 'original-video',
      name: 'Original Video',
    };
    const originalClip = {
      ...createTimelineCanvasSmokeClips({
        tracks: [originalTrack],
        clipCount: 1,
        durationSeconds: 12,
      })[0],
      id: 'original-clip',
      trackId: 'original-video',
      name: 'Original Clip',
    };
    const smokeTracks = createTimelineCanvasSmokeTracks(2);
    const smokeClips = createTimelineCanvasSmokeClips({
      tracks: smokeTracks,
      clipCount: 4,
      durationSeconds: 8,
    });

    useTimelineStore.getState().pause();
    useTimelineStore.setState({
      tracks: [originalTrack],
      clips: [originalClip],
      layers: [],
      selectedClipIds: new Set(['original-clip']),
      primarySelectedClipId: 'original-clip',
      propertiesSelection: null,
      clipKeyframes: new Map(),
      selectedKeyframeIds: new Set(),
      expandedTracks: new Set(['original-video']),
      expandedTrackPropertyGroups: new Map(),
      expandedCurveProperties: new Map(),
      markers: [],
      duration: 12,
      durationLocked: false,
      playheadPosition: 4.25,
      playbackSpeed: 1.5,
      isDraggingPlayhead: true,
      toolMode: 'select',
      activeTimelineToolId: 'select',
      previousTimelineToolId: null,
      openTimelineToolGroupId: null,
      momentaryTimelineToolId: null,
      scrollX: 41,
      zoom: 33,
      cachedFrameTimes: new Set([1, 2]),
      ramPreviewRange: { start: 1, end: 2 },
      ramPreviewProgress: null,
      isRamPreviewing: false,
      timelineRangeSelection: null,
      clipDragPreview: null,
      timelineToolPreview: null,
    });

    const snapshot = captureTimelineCanvasSmokeRestoreState();
    useTimelineStore.setState({
      tracks: smokeTracks,
      clips: smokeClips,
      selectedClipIds: new Set(),
      primarySelectedClipId: null,
      duration: 8,
      playheadPosition: 0,
      activeTimelineToolId: 'blade',
      scrollX: 0,
      zoom: 99,
      cachedFrameTimes: new Set(),
      ramPreviewRange: null,
    });

    const result = await restoreTimelineCanvasSmokeState(snapshot);
    const restored = useTimelineStore.getState();

    expect(result).toMatchObject({
      restoredTrackCount: 1,
      restoredClipCount: 1,
      restoredPlayheadPosition: 4.25,
      resumedPlayback: false,
    });
    expect(restored.tracks.map((track) => track.id)).toEqual(['original-video']);
    expect(restored.clips.map((clip) => clip.id)).toEqual(['original-clip']);
    expect([...restored.selectedClipIds]).toEqual(['original-clip']);
    expect(restored.primarySelectedClipId).toBe('original-clip');
    expect(restored.duration).toBe(12);
    expect(restored.durationLocked).toBe(false);
    expect(restored.playheadPosition).toBe(4.25);
    expect(restored.playbackSpeed).toBe(1.5);
    expect(restored.isDraggingPlayhead).toBe(true);
    expect(restored.activeTimelineToolId).toBe('select');
    expect(restored.scrollX).toBe(41);
    expect(restored.zoom).toBe(33);
    expect([...restored.cachedFrameTimes]).toEqual([1, 2]);
    expect(restored.ramPreviewRange).toEqual({ start: 1, end: 2 });
  });

  it('restores timeline-mutating smoke runs by default', () => {
    expect(shouldRestoreTimelineAfterCanvasSmoke({ useExistingMediaFile: true })).toBe(true);
    expect(shouldRestoreTimelineAfterCanvasSmoke({ useExistingMediaFile: true, restoreTimelineAfterRun: false })).toBe(false);
    expect(shouldRestoreTimelineAfterCanvasSmoke({ createSynthetic: true })).toBe(true);
    expect(shouldRestoreTimelineAfterCanvasSmoke({ createSynthetic: true, restoreTimelineAfterRun: true })).toBe(true);
    expect(shouldRestoreTimelineAfterCanvasSmoke({ createSynthetic: false })).toBe(false);
  });

  it('can reuse an existing media file for thumbnail reload smoke sources', async () => {
    const existingMediaFile = {
      id: 'existing-thumbnail-source',
      name: 'Existing Thumbnail Source.mp4',
      type: 'video',
      parentId: null,
      createdAt: Date.now(),
      url: 'blob:existing-thumbnail-source',
      duration: 6,
      width: 1920,
      height: 1080,
      fps: 30,
      fileSize: 1024,
      hasAudio: false,
      fileHash: 'existing-thumbnail-source-hash',
      file: new File([new Uint8Array([1])], 'Existing Thumbnail Source.mp4', { type: 'video/mp4' }),
    } as const;
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [existingMediaFile],
    } as unknown as ReturnType<typeof useMediaStore.getState>);

    const generateForSourceUrl = vi.spyOn(thumbnailCacheService, 'generateForSourceUrl')
      .mockResolvedValue(undefined);
    vi.spyOn(thumbnailCacheService, 'getCount').mockReturnValue(1);
    vi.spyOn(thumbnailCacheService, 'evictFromMemory').mockImplementation(() => undefined);
    vi.spyOn(thumbnailCacheService, 'clearSource').mockResolvedValue(undefined);
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    try {
      const result = await handleRunTimelineCanvasThumbnailReloadSmoke({
        useExistingMediaFile: true,
        restoreTimelineAfterRun: true,
        forceTimelineCanvasWorker: false,
        clipCount: 1,
        videoTrackCount: 1,
        durationSeconds: 2,
        clipDurationSeconds: 1,
        sourceDurationSeconds: 2,
        minThumbnailClipCount: 0,
        minThumbnailDrawCount: 0,
        timeoutMs: 1000,
        requireTimelineDom: false,
      });

      expect(result.success, result.error ?? JSON.stringify(result.data?.failures)).toBe(true);
      expect(result.data?.source).toMatchObject({
        reusedMediaFileId: 'existing-thumbnail-source',
        sourceName: 'Existing Thumbnail Source.mp4',
        durationSeconds: 2,
      });
      expect(generateForSourceUrl).toHaveBeenCalledWith(
        expect.any(String),
        'blob:existing-thumbnail-source',
        2,
        expect.any(String),
        'anonymous',
      );
      expect(revokeObjectUrl).not.toHaveBeenCalledWith('blob:existing-thumbnail-source');
    } finally {
      vi.mocked(useMediaStore.getState).mockReturnValue({
        files: [],
      } as unknown as ReturnType<typeof useMediaStore.getState>);
    }
  });

  it('uses the bundled smoke video for thumbnail reload when no media file is present', async () => {
    vi.mocked(useMediaStore.getState).mockReturnValue({
      files: [],
    } as unknown as ReturnType<typeof useMediaStore.getState>);
    const generateForSourceUrl = vi.spyOn(thumbnailCacheService, 'generateForSourceUrl')
      .mockResolvedValue(undefined);
    vi.spyOn(thumbnailCacheService, 'getCount').mockReturnValue(1);
    vi.spyOn(thumbnailCacheService, 'evictFromMemory').mockImplementation(() => undefined);
    vi.spyOn(thumbnailCacheService, 'clearSource').mockResolvedValue(undefined);
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const result = await handleRunTimelineCanvasThumbnailReloadSmoke({
      restoreTimelineAfterRun: true,
      forceTimelineCanvasWorker: false,
      clipCount: 1,
      videoTrackCount: 1,
      durationSeconds: 2,
      clipDurationSeconds: 1,
      sourceDurationSeconds: 3,
      minThumbnailClipCount: 0,
      minThumbnailDrawCount: 0,
      timeoutMs: 1000,
      requireTimelineDom: false,
    });

    expect(result.success, result.error ?? JSON.stringify(result.data?.failures)).toBe(true);
    expect(result.data?.source).toMatchObject({
      sourceName: 'Bundled masterselects_github.mp4',
      durationSeconds: 3,
    });
    expect(generateForSourceUrl).toHaveBeenCalledWith(
      expect.any(String),
      '/masterselects_github.mp4',
      3,
      expect.any(String),
      'anonymous',
    );
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('/masterselects_github.mp4');
  });

  it('restores the active timeline after large-project synthetic smoke by default', async () => {
    const originalTrack = {
      ...createTimelineCanvasSmokeTracks(1)[0],
      id: 'large-original-video',
      name: 'Large Original Video',
    };
    const originalClip = {
      ...createTimelineCanvasSmokeClips({
        tracks: [originalTrack],
        clipCount: 1,
        durationSeconds: 12,
      })[0],
      id: 'large-original-clip',
      trackId: 'large-original-video',
      name: 'Large Original Clip',
    };

    useTimelineStore.getState().pause();
    useTimelineStore.setState({
      tracks: [originalTrack],
      clips: [originalClip],
      selectedClipIds: new Set(['large-original-clip']),
      primarySelectedClipId: 'large-original-clip',
      duration: 12,
      durationLocked: false,
      playheadPosition: 3,
      scrollX: 12,
      zoom: 24,
    });

    const result = await handleRunTimelineCanvasLargeProjectSmoke({
      createSynthetic: true,
      clipCount: 6,
      videoTrackCount: 2,
      durationSeconds: 12,
      selectAll: true,
      frameSampleMs: 100,
      minEstimatedFps: 1,
      maxDroppedFrameEstimate: 1000,
      maxSlowFrameCount: 1000,
      maxFrameDeltaMs: 1000,
      maxWorkerTrackCount: 1000,
      maxShellCount: 1000,
      requireTimelineDom: false,
      requireCulling: false,
    });
    const restored = useTimelineStore.getState();

    expect(result.success).toBe(true);
    expect(result.data?.synthetic).toMatchObject({ clipCount: 6 });
    expect(result.data?.restore).toMatchObject({
      enabled: true,
      result: {
        restoredClipCount: 1,
        restoredTrackCount: 1,
      },
    });
    expect(restored.clips.map((clip) => clip.id)).toEqual(['large-original-clip']);
    expect(restored.tracks.map((track) => track.id)).toEqual(['large-original-video']);
    expect([...restored.selectedClipIds]).toEqual(['large-original-clip']);
    expect(restored.primarySelectedClipId).toBe('large-original-clip');
    expect(restored.playheadPosition).toBe(3);
    expect(restored.scrollX).toBe(12);
    expect(restored.zoom).toBe(24);
  });

  it('restores a forced timeline canvas worker flag even when the smoke fails', async () => {
    const previousFlag = flags.timelineCanvasWorker;
    flags.timelineCanvasWorker = false;
    try {
      const result = await handleRunTimelineCanvasLargeProjectSmoke({
        createSynthetic: true,
        restoreTimelineAfterRun: true,
        forceTimelineCanvasWorker: true,
        clipCount: 4,
        videoTrackCount: 1,
        durationSeconds: 8,
        selectAll: false,
        frameSampleMs: 100,
        minEstimatedFps: 1,
        maxDroppedFrameEstimate: 1000,
        maxSlowFrameCount: 1000,
        maxFrameDeltaMs: 1000,
        minWorkerTrackCount: 1,
        maxShellCount: 1000,
        requireTimelineDom: false,
        requireCulling: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('worker tracks 0/1 required');
      expect(result.data?.workerFlag).toMatchObject({
        forced: true,
        previous: false,
        restored: false,
      });
      expect(flags.timelineCanvasWorker).toBe(false);
    } finally {
      flags.timelineCanvasWorker = previousFlag;
    }
  });

  it('reports real-timeline worker thumbnail warmup state before large-project smoke', async () => {
    const originalTrack = {
      ...createTimelineCanvasSmokeTracks(1)[0],
      id: 'warmup-original-video',
      name: 'Warmup Original Video',
    };
    const originalClip = {
      ...createTimelineCanvasSmokeClips({
        tracks: [originalTrack],
        clipCount: 1,
        durationSeconds: 10,
      })[0],
      id: 'warmup-original-clip',
      trackId: 'warmup-original-video',
      name: 'Warmup Original Clip',
      source: {
        type: 'video' as const,
        mediaFileId: 'warmup-media',
        naturalDuration: 10,
      },
      mediaFileId: 'warmup-media',
    };

    useTimelineStore.getState().pause();
    useTimelineStore.setState({
      tracks: [originalTrack],
      clips: [originalClip],
      selectedClipIds: new Set(['warmup-original-clip']),
      primarySelectedClipId: 'warmup-original-clip',
      duration: 10,
      durationLocked: false,
      playheadPosition: 2,
      scrollX: 15,
      zoom: 24,
    });

    const result = await handleRunTimelineCanvasLargeProjectSmoke({
      createSynthetic: false,
      restoreTimelineAfterRun: true,
      warmWorkerThumbnails: true,
      workerThumbnailWarmupTimeoutMs: 0,
      workerThumbnailWarmupMaxSecondsPerSource: 12,
      minWorkerWarmThumbnailBitmapCount: 0,
      selectAll: false,
      frameSampleMs: 100,
      minEstimatedFps: 1,
      maxDroppedFrameEstimate: 1000,
      maxSlowFrameCount: 1000,
      maxFrameDeltaMs: 1000,
      maxWorkerTrackCount: 1000,
      maxShellCount: 1000,
      zoomLevels: [24],
      scrollFractions: [0],
      requireTimelineDom: false,
      requireCulling: false,
    });
    const restored = useTimelineStore.getState();

    expect(result.success).toBe(true);
    expect(result.data?.synthetic).toBeNull();
    expect(result.data?.workerThumbnailWarmup).toMatchObject({
      sourceCount: 1,
      requestedUrlCount: 0,
      warmedBitmapCount: 0,
      missingSourceIds: ['warmup-media'],
    });
    expect(restored.clips.map((clip) => clip.id)).toEqual(['warmup-original-clip']);
    expect(restored.tracks.map((track) => track.id)).toEqual(['warmup-original-video']);
    expect(restored.playheadPosition).toBe(2);
    expect(restored.scrollX).toBe(15);
    expect(restored.zoom).toBe(24);
  });

  it('does not fall back to synthetic mutation when an existing-media smoke has no media file', async () => {
    const originalTrack = {
      ...createTimelineCanvasSmokeTracks(1)[0],
      id: 'existing-video',
    };
    const originalClip = {
      ...createTimelineCanvasSmokeClips({
        tracks: [originalTrack],
        clipCount: 1,
        durationSeconds: 5,
      })[0],
      id: 'existing-clip',
      trackId: 'existing-video',
    };
    useTimelineStore.getState().pause();
    useTimelineStore.setState({
      tracks: [originalTrack],
      clips: [originalClip],
      selectedClipIds: new Set(['existing-clip']),
      primarySelectedClipId: 'existing-clip',
      duration: 5,
      playheadPosition: 1,
      scrollX: 17,
      zoom: 22,
    });

    const result = await handleRunTimelineCanvasPlayheadSmoothnessSmoke({
      useExistingMediaFile: true,
      durationMs: 300,
    });
    const restored = useTimelineStore.getState();

    expect(result.success).toBe(false);
    expect(result.error).toContain('no existing video MediaFile');
    expect(result.data?.synthetic).toBeNull();
    expect(result.data?.restore).toMatchObject({
      enabled: true,
      result: {
        restoredClipCount: 1,
        restoredTrackCount: 1,
      },
    });
    expect(restored.clips.map((clip) => clip.id)).toEqual(['existing-clip']);
    expect([...restored.selectedClipIds]).toEqual(['existing-clip']);
    expect(restored.playheadPosition).toBe(1);
    expect(restored.scrollX).toBe(17);
    expect(restored.zoom).toBe(22);
  });

  it('does not fall back to synthetic Blade smoke when an existing media file is required', async () => {
    const originalTrack = {
      ...createTimelineCanvasSmokeTracks(1)[0],
      id: 'blade-existing-video',
    };
    const originalClip = {
      ...createTimelineCanvasSmokeClips({
        tracks: [originalTrack],
        clipCount: 1,
        durationSeconds: 5,
      })[0],
      id: 'blade-existing-clip',
      trackId: 'blade-existing-video',
    };
    useTimelineStore.getState().pause();
    useTimelineStore.setState({
      tracks: [originalTrack],
      clips: [originalClip],
      selectedClipIds: new Set(['blade-existing-clip']),
      primarySelectedClipId: 'blade-existing-clip',
      duration: 5,
      playheadPosition: 1,
      scrollX: 23,
      zoom: 31,
    });

    const result = await handleRunTimelineCanvasBladeToolSmoke({
      useExistingMediaFile: true,
    });
    const restored = useTimelineStore.getState();

    expect(result.success).toBe(false);
    expect(result.error).toContain('no existing video MediaFile');
    expect(result.data?.mediaSetup).toBeNull();
    expect(result.data?.synthetic).toBeNull();
    expect(result.data?.restore).toMatchObject({
      enabled: true,
      result: {
        restoredClipCount: 1,
        restoredTrackCount: 1,
      },
    });
    expect(restored.clips.map((clip) => clip.id)).toEqual(['blade-existing-clip']);
    expect([...restored.selectedClipIds]).toEqual(['blade-existing-clip']);
    expect(restored.playheadPosition).toBe(1);
    expect(restored.scrollX).toBe(23);
    expect(restored.zoom).toBe(31);
  });
});
