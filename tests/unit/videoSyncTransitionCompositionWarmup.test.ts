import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getUpcomingBakedTransitionVideoWarmupTargets: vi.fn(),
}));

vi.mock('../../src/services/layerBuilder/videoSyncTransitionCompositionCoordinator', () => ({
  getUpcomingBakedTransitionVideoWarmupTargets: hoisted.getUpcomingBakedTransitionVideoWarmupTargets,
}));

import { flags } from '../../src/engine/featureFlags';
import { VideoSyncWarmupCoordinator } from '../../src/services/layerBuilder/videoSyncWarmupCoordinator';
import { VideoSyncWarmupState } from '../../src/services/layerBuilder/videoSyncWarmupState';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import type { TimelineClip } from '../../src/types/timeline';

const initialFullWebCodecsPlayback = flags.useFullWebCodecsPlayback;

afterEach(() => {
  flags.useFullWebCodecsPlayback = initialFullWebCodecsPlayback;
  hoisted.getUpcomingBakedTransitionVideoWarmupTargets.mockReset();
});

describe('transition composition video warmup', () => {
  it('starts targeted warmup for the upcoming baked datamosh video', () => {
    flags.useFullWebCodecsPlayback = false;
    const bakedClip = {
      id: 'transition-comp:mosh:datamosh',
      trackId: 'baked-track',
      source: { type: 'video' },
    } as TimelineClip;
    const video = document.createElement('video');
    video.src = 'blob:datamosh';
    hoisted.getUpcomingBakedTransitionVideoWarmupTargets.mockReturnValue([
      { clip: bakedClip, sourceTime: 0 },
    ]);
    const startTargetedWarmup = vi.fn();
    const coordinator = new VideoSyncWarmupCoordinator({
      warmups: new VideoSyncWarmupState(),
      getClipHtmlVideoElement: clip => clip.id === bakedClip.id ? video : null,
      getClipRuntimeProvider: () => null,
      getHandoffVideoElement: () => null,
      isVideoGpuReady: () => false,
      safeSeekTime: (_video, time) => time,
      clearHtmlSeekState: vi.fn(),
      isCompletingPlaybackStop: () => false,
      prewarmUpcomingWebCodecsClip: vi.fn(),
      usesFullWebCodecsPreview: () => false,
      startTargetedWarmup,
      clearWarmupState: vi.fn(),
    });
    const ctx = {
      clips: [],
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      playheadPosition: 2,
    } as unknown as FrameContext;

    coordinator.warmupUpcomingClips(ctx);

    expect(startTargetedWarmup).toHaveBeenCalledWith(
      bakedClip.id,
      video,
      0,
      { proactive: true, requestRender: false },
    );
  });
});

describe('video warmup scan bounds', () => {
  function createCoordinator(overrides: {
    getClipHtmlVideoElement?: (clip: TimelineClip) => HTMLVideoElement | null;
    prewarmUpcomingWebCodecsClip?: (ctx: FrameContext, clip: TimelineClip, clipTime: number) => void;
  } = {}): VideoSyncWarmupCoordinator {
    return new VideoSyncWarmupCoordinator({
      warmups: new VideoSyncWarmupState(),
      getClipHtmlVideoElement: overrides.getClipHtmlVideoElement ?? (() => null),
      getClipRuntimeProvider: () => null,
      getHandoffVideoElement: () => null,
      isVideoGpuReady: () => false,
      safeSeekTime: (_video, time) => time,
      clearHtmlSeekState: vi.fn(),
      isCompletingPlaybackStop: () => false,
      prewarmUpcomingWebCodecsClip: overrides.prewarmUpcomingWebCodecsClip ?? vi.fn(),
      usesFullWebCodecsPreview: () => false,
      startTargetedWarmup: vi.fn(),
      clearWarmupState: vi.fn(),
    });
  }

  function createScanContext(
    clips: TimelineClip[],
    getInterpolatedSpeed: FrameContext['getInterpolatedSpeed'],
    getSourceTimeForClip: FrameContext['getSourceTimeForClip'],
  ): FrameContext {
    return {
      clips,
      clipsAtTime: [],
      isPlaying: true,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      playbackSpeed: 1,
      playheadPosition: 0,
      visibleVideoTrackIds: new Set(['video-track']),
      mediaFileById: new Map(),
      getInterpolatedSpeed,
      getSourceTimeForClip,
    } as unknown as FrameContext;
  }

  function createScanClip(id: string, sourceType: 'video' | 'motion-shape', startTime: number): TimelineClip {
    return {
      id,
      trackId: 'video-track',
      startTime,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
      source: { type: sourceType },
    } as TimelineClip;
  }

  it('skips timing and media resolution for 1,682 graphic clips in the warmup window', () => {
    flags.useFullWebCodecsPlayback = false;
    hoisted.getUpcomingBakedTransitionVideoWarmupTargets.mockReturnValue([]);
    const getClipHtmlVideoElement = vi.fn(() => null);
    const getInterpolatedSpeed = vi.fn(() => 1);
    const getSourceTimeForClip = vi.fn(() => 0);
    const clips = Array.from({ length: 1682 }, (_, index) =>
      createScanClip(`shape-${index}`, 'motion-shape', 0.5)
    );
    const coordinator = createCoordinator({ getClipHtmlVideoElement });

    coordinator.warmupUpcomingClips(createScanContext(
      clips,
      getInterpolatedSpeed,
      getSourceTimeForClip,
    ));

    expect(getInterpolatedSpeed).not.toHaveBeenCalled();
    expect(getSourceTimeForClip).not.toHaveBeenCalled();
    expect(getClipHtmlVideoElement).not.toHaveBeenCalled();
  });

  it('rejects distant video clips before calculating source time', () => {
    flags.useFullWebCodecsPlayback = false;
    hoisted.getUpcomingBakedTransitionVideoWarmupTargets.mockReturnValue([]);
    const getClipHtmlVideoElement = vi.fn(() => null);
    const getInterpolatedSpeed = vi.fn(() => 1);
    const getSourceTimeForClip = vi.fn(() => 0);
    const clips = Array.from({ length: 1682 }, (_, index) =>
      createScanClip(`video-${index}`, 'video', 10 + index)
    );
    const coordinator = createCoordinator({ getClipHtmlVideoElement });

    coordinator.warmupUpcomingClips(createScanContext(
      clips,
      getInterpolatedSpeed,
      getSourceTimeForClip,
    ));

    expect(getInterpolatedSpeed).not.toHaveBeenCalled();
    expect(getSourceTimeForClip).not.toHaveBeenCalled();
    expect(getClipHtmlVideoElement).not.toHaveBeenCalled();
  });
});
