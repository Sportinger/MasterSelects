import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createFrameContext: vi.fn(),
  syncBackground: vi.fn(),
}));

vi.mock('../../src/services/layerBuilder/FrameContext', () => ({
  createFrameContext: () => hoisted.createFrameContext(),
  getClipTimeInfo: vi.fn(),
  getMediaFileForClip: vi.fn(),
}));

vi.mock('../../src/services/layerPlaybackManager', () => ({
  layerPlaybackManager: {
    syncVideoElements: (...args: unknown[]) => hoisted.syncBackground(...args),
  },
}));

vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  canUseSharedPreviewRuntimeSession: vi.fn(() => true),
  ensureRuntimeFrameProvider: vi.fn(),
  getPreviewRuntimeSource: vi.fn((source: unknown) => source),
  getRuntimeFrameProvider: vi.fn(() => null),
  getScrubRuntimeSource: vi.fn((source: unknown) => source),
  peekRuntimeFrameProvider: vi.fn(() => null),
  updateRuntimePlaybackTime: vi.fn(),
}));

vi.mock('../../src/services/vfPipelineMonitor', () => ({
  vfPipelineMonitor: {
    record: vi.fn(),
  },
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import { VideoSyncManager } from '../../src/services/layerBuilder/VideoSyncManager';
import { getClipTimeInfo } from '../../src/services/layerBuilder/FrameContext';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import { ensureRuntimeFrameProvider, getRuntimeFrameProvider } from '../../src/services/mediaRuntime/runtimePlayback';
import { releaseAllLazyTimelineMediaElements } from '../../src/services/timeline/lazyMediaElements';
import type { TimelineClip } from '../../src/types/timeline';

type VideoSyncManagerTestAccess = VideoSyncManager & {
  syncClipVideo(clip: TimelineClip, ctx: FrameContext): void;
  syncFullWebCodecs(clip: TimelineClip, ctx: FrameContext): void;
  warmupUpcomingClips(ctx: FrameContext): void;
  preBufferUpcomingVideoAudio(ctx: FrameContext): void;
};

describe('VideoSyncManager same-frame sync gate', () => {
  beforeEach(() => {
    hoisted.createFrameContext.mockReset();
    hoisted.syncBackground.mockReset();
    vi.mocked(getClipTimeInfo).mockReset();
    vi.mocked(ensureRuntimeFrameProvider).mockReset();
    vi.mocked(getRuntimeFrameProvider).mockReset();
    vi.mocked(getRuntimeFrameProvider).mockReturnValue(null);
  });

  afterEach(() => {
    releaseAllLazyTimelineMediaElements();
    vi.restoreAllMocks();
  });

  it('does not skip a same-frame playback sync when clip references changed asynchronously', () => {
    const manager = new VideoSyncManager() as unknown as VideoSyncManagerTestAccess;
    const syncClipVideo = vi.spyOn(manager, 'syncClipVideo').mockImplementation(() => {});
    vi.spyOn(manager, 'warmupUpcomingClips').mockImplementation(() => {});
    vi.spyOn(manager, 'preBufferUpcomingVideoAudio').mockImplementation(() => {});

    const mediaFile = { id: 'media-1', name: 'clip.mp4', url: 'blob:clip-video', duration: 10 };

    const clipA = {
      id: 'clip-1',
      trackId: 'track-v1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      mediaFileId: 'media-1',
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        naturalDuration: 10,
      },
    } as unknown as TimelineClip;

    const clipB = {
      ...clipA,
      source: {
        ...clipA.source,
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      },
    } as unknown as TimelineClip;

    const createContext = (clip: TimelineClip): FrameContext => ({
      isPlaying: true,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      frameNumber: 10,
      playheadPosition: 1,
      now: 1000,
      playbackSpeed: 1,
      clips: [clip],
      clipsAtTime: [clip],
      clipsByTrackId: new Map([['track-v1', clip]]),
      tracks: [{ id: 'track-v1', type: 'video', visible: true }],
      videoTracks: [{ id: 'track-v1', type: 'video', visible: true }],
      audioTracks: [],
      visibleVideoTrackIds: new Set(['track-v1']),
      unmutedAudioTrackIds: new Set(),
      mediaFiles: [mediaFile],
      mediaFileById: new Map([['media-1', mediaFile]]),
      mediaFileByName: new Map([[mediaFile.name, mediaFile]]),
      compositionById: new Map(),
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 1,
    } as unknown as FrameContext);

    hoisted.createFrameContext
      .mockReturnValueOnce(createContext(clipA))
      .mockReturnValueOnce(createContext(clipB));

    manager.syncVideoElements();
    manager.syncVideoElements();

    expect(syncClipVideo).toHaveBeenCalledTimes(2);
  });

  it('uses a supplied producer context without resampling the playback clock', () => {
    const manager = new VideoSyncManager();
    const exactContext = {
      isPlaying: false,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      frameNumber: 123,
      playheadPosition: 4.1,
      now: 1_800,
      playbackSpeed: 1,
      clips: [],
      clipsAtTime: [],
      clipsByTrackId: new Map(),
      tracks: [],
      videoTracks: [],
      audioTracks: [],
      visibleVideoTrackIds: new Set(),
      unmutedAudioTrackIds: new Set(),
      mediaFiles: [],
      mediaFileById: new Map(),
      mediaFileByName: new Map(),
      compositionById: new Map(),
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 0,
    } as unknown as FrameContext;

    manager.syncVideoElements(exactContext);

    expect(hoisted.createFrameContext).not.toHaveBeenCalled();
    expect(hoisted.syncBackground).toHaveBeenCalledWith(4.1, false);
  });

  it('opts into worker WebCodecs only for reverse playback', () => {
    const manager = new VideoSyncManager() as unknown as VideoSyncManagerTestAccess;
    const provider = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      advanceToTime: vi.fn(),
      advanceReverseToTime: vi.fn(),
      scrubSeek: vi.fn(),
      seek: vi.fn(),
      pause: vi.fn(),
    };
    const clip = {
      id: 'clip-worker-reverse',
      trackId: 'track-v1',
      startTime: 0,
      inPoint: 0,
      outPoint: 10,
      duration: 10,
      reversed: false,
      source: {
        type: 'video',
        mediaFileId: 'media-worker-reverse',
        naturalDuration: 10,
        runtimeSourceId: 'media:media-worker-reverse',
        runtimeSessionKey: 'interactive:clip-worker-reverse',
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      },
    } as unknown as TimelineClip;
    vi.mocked(getRuntimeFrameProvider).mockReturnValue(provider);
    const createContext = (playbackSpeed: number): FrameContext => ({
      isPlaying: true,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      frameNumber: 10,
      playheadPosition: 1,
      now: 1000,
      playbackSpeed,
      clips: [clip],
      clipsAtTime: [clip],
      clipsByTrackId: new Map([['track-v1', clip]]),
      tracks: [{ id: 'track-v1', type: 'video', visible: true }],
      videoTracks: [{ id: 'track-v1', type: 'video', visible: true }],
      audioTracks: [],
      visibleVideoTrackIds: new Set(['track-v1']),
      unmutedAudioTrackIds: new Set(),
      mediaFiles: [],
      mediaFileById: new Map(),
      mediaFileByName: new Map(),
      compositionById: new Map(),
      hasKeyframes: () => false,
      getInterpolatedSpeed: () => playbackSpeed,
      getSourceTimeForClip: () => 2,
    } as unknown as FrameContext);

    vi.mocked(getClipTimeInfo).mockReturnValue({
      clipTime: 2,
      speed: 1,
      absSpeed: 1,
    } as ReturnType<typeof getClipTimeInfo>);
    manager.syncFullWebCodecs(clip, createContext(1));
    expect(ensureRuntimeFrameProvider).not.toHaveBeenCalled();
    expect(provider.advanceToTime).toHaveBeenCalledWith(2);
    expect(provider.seek).not.toHaveBeenCalled();

    vi.mocked(getClipTimeInfo).mockReturnValue({
      clipTime: 2,
      speed: -1,
      absSpeed: 1,
    } as ReturnType<typeof getClipTimeInfo>);
    provider.advanceToTime.mockClear();
    provider.advanceReverseToTime.mockClear();
    provider.scrubSeek.mockClear();
    manager.syncFullWebCodecs(clip, createContext(-1));

    expect(ensureRuntimeFrameProvider).toHaveBeenCalledWith(
      clip.source,
      'interactive',
      2,
      { preferWorkerWebCodecs: true }
    );
    expect(provider.advanceReverseToTime).toHaveBeenCalledWith(2);
    expect(provider.scrubSeek).not.toHaveBeenCalled();
    expect(provider.advanceToTime).not.toHaveBeenCalled();
    expect(provider.seek).not.toHaveBeenCalled();
  });
});
