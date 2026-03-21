import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { flags } from '../../src/engine/featureFlags';
import { getClipTimeInfo } from '../../src/services/layerBuilder/FrameContext';
import {
  ensureRuntimeFrameProvider,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
  updateRuntimePlaybackTime,
} from '../../src/services/mediaRuntime/runtimePlayback';
import { scrubSettleState } from '../../src/services/scrubSettleState';

describe('VideoSyncManager same-frame sync gate', () => {
  beforeEach(() => {
    flags.useFullWebCodecsPlayback = true;
    scrubSettleState.clear();
    hoisted.createFrameContext.mockReset();
    hoisted.syncBackground.mockReset();
    vi.mocked(getClipTimeInfo).mockReset();
    vi.mocked(ensureRuntimeFrameProvider).mockReset();
    vi.mocked(getPreviewRuntimeSource).mockReset();
    vi.mocked(getRuntimeFrameProvider).mockReset();
    vi.mocked(getScrubRuntimeSource).mockReset();
    vi.mocked(updateRuntimePlaybackTime).mockReset();
  });

  it('does not skip a same-frame playback sync when clip references changed asynchronously', () => {
    const manager = new VideoSyncManager() as any;
    const syncClipVideo = vi.spyOn(manager, 'syncClipVideo').mockImplementation(() => {});
    vi.spyOn(manager, 'warmupUpcomingClips').mockImplementation(() => {});
    vi.spyOn(manager, 'preBufferUpcomingVideoAudio').mockImplementation(() => {});
    vi.spyOn(manager, 'updateLastTrackState').mockImplementation(() => {});

    const video = {
      paused: true,
      played: { length: 1 },
      currentTime: 1,
    } as unknown as HTMLVideoElement;

    const clipA = {
      id: 'clip-1',
      trackId: 'track-v1',
      inPoint: 0,
      outPoint: 10,
      source: {
        type: 'video',
        videoElement: video,
      },
    };

    const clipB = {
      ...clipA,
      source: {
        ...clipA.source,
        webCodecsPlayer: {
          isFullMode: () => true,
        },
      },
    };

    hoisted.createFrameContext
      .mockReturnValueOnce({
        isPlaying: true,
        isDraggingPlayhead: false,
        frameNumber: 10,
        playheadPosition: 1,
        clips: [clipA],
        clipsAtTime: [clipA],
        clipsByTrackId: new Map([['track-v1', clipA]]),
      })
      .mockReturnValueOnce({
        isPlaying: true,
        isDraggingPlayhead: false,
        frameNumber: 10,
        playheadPosition: 1,
        clips: [clipB],
        clipsAtTime: [clipB],
        clipsByTrackId: new Map([['track-v1', clipB]]),
      });

    manager.syncVideoElements();
    manager.syncVideoElements();

    expect(syncClipVideo).toHaveBeenCalledTimes(2);
  });

  it('hydrates the paused playback runtime provider even when not dragging', () => {
    const manager = new VideoSyncManager() as any;
    const playbackRuntimeSource = {
      runtimeSourceId: 'media:test',
      runtimeSessionKey: 'interactive-track:track-v1:media:test',
      webCodecsPlayer: {
        currentTime: 2,
        isFullMode: () => true,
        hasFrame: () => false,
        getCurrentFrame: () => null,
        getPendingSeekTime: () => null,
        isDecodePending: () => false,
        seek: vi.fn(),
      },
    };
    const scrubRuntimeSource = {
      ...playbackRuntimeSource,
      runtimeSessionKey: 'interactive-scrub:track-v1:media:test',
    };
    const playbackProvider = {
      currentTime: 2,
      isFullMode: () => true,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
      pause: vi.fn(),
      seek: vi.fn(),
    };

    vi.mocked(getClipTimeInfo).mockReturnValue({
      clipTime: 2,
      localTime: 2,
      speed: 1,
      absSpeed: 1,
      isReversed: false,
    } as any);
    vi.mocked(getPreviewRuntimeSource).mockReturnValue(playbackRuntimeSource as any);
    vi.mocked(getScrubRuntimeSource).mockReturnValue(scrubRuntimeSource as any);
    vi.mocked(getRuntimeFrameProvider).mockImplementation((source: unknown) =>
      source === playbackRuntimeSource ? (playbackProvider as any) : null
    );

    (manager as any).syncFullWebCodecs(
      {
        id: 'clip-1',
        trackId: 'track-v1',
        source: playbackRuntimeSource,
      },
      {
        isPlaying: false,
        isDraggingPlayhead: false,
        playbackSpeed: 1,
      }
    );

    expect(updateRuntimePlaybackTime).toHaveBeenCalledWith(playbackRuntimeSource, 2);
    expect(ensureRuntimeFrameProvider).toHaveBeenCalledWith(
      playbackRuntimeSource,
      'interactive',
      2
    );
  });

  it('keeps hydrating the scrub runtime while scrub-stop settle is pending', () => {
    const manager = new VideoSyncManager() as any;
    const playbackRuntimeSource = {
      runtimeSourceId: 'media:test',
      runtimeSessionKey: 'interactive-track:track-v1:media:test',
      webCodecsPlayer: {
        currentTime: 3,
        isFullMode: () => true,
        hasFrame: () => false,
        getCurrentFrame: () => null,
        getPendingSeekTime: () => null,
        isDecodePending: () => false,
        seek: vi.fn(),
      },
    };
    const scrubRuntimeSource = {
      ...playbackRuntimeSource,
      runtimeSessionKey: 'interactive-scrub:track-v1:media:test',
    };
    const scrubProvider = {
      currentTime: 3,
      isFullMode: () => true,
      hasFrame: () => false,
      getCurrentFrame: () => null,
      getPendingSeekTime: () => null,
      isDecodePending: () => false,
      pause: vi.fn(),
      seek: vi.fn(),
    };

    vi.mocked(getClipTimeInfo).mockReturnValue({
      clipTime: 3,
      localTime: 3,
      speed: 1,
      absSpeed: 1,
      isReversed: false,
    } as any);
    vi.mocked(getPreviewRuntimeSource).mockReturnValue(playbackRuntimeSource as any);
    vi.mocked(getScrubRuntimeSource).mockReturnValue(scrubRuntimeSource as any);
    vi.mocked(getRuntimeFrameProvider).mockImplementation((source: unknown) =>
      source === scrubRuntimeSource ? (scrubProvider as any) : null
    );

    scrubSettleState.begin('clip-1', 3, 250, 'scrub-stop');

    (manager as any).syncFullWebCodecs(
      {
        id: 'clip-1',
        trackId: 'track-v1',
        source: playbackRuntimeSource,
      },
      {
        isPlaying: false,
        isDraggingPlayhead: false,
        playbackSpeed: 1,
      }
    );

    expect(updateRuntimePlaybackTime).toHaveBeenCalledWith(scrubRuntimeSource, 3);
    expect(ensureRuntimeFrameProvider).toHaveBeenCalledWith(
      scrubRuntimeSource,
      'interactive',
      3
    );
  });
});
