import { beforeEach, describe, expect, it, vi } from 'vitest';

const initWebCodecsPlayerMock = vi.fn();
const invalidateCacheMock = vi.fn();
const resetVideoSyncMock = vi.fn();
const requestRenderMock = vi.fn();
const requestNewFrameRenderMock = vi.fn();
const preCacheVideoFrameMock = vi.fn();
let mediaState: Record<string, unknown>;

vi.mock('../../src/stores/timeline/helpers/webCodecsHelpers', () => ({
  initWebCodecsPlayer: (...args: unknown[]) => initWebCodecsPlayerMock(...args),
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: vi.fn(() => false),
    getAnalysis: vi.fn(),
    getAllAnalysisMerged: vi.fn(),
  },
}));

vi.mock('../../src/services/layerBuilder', () => ({
  layerBuilder: {
    invalidateCache: () => invalidateCacheMock(),
    getVideoSyncManager: () => ({
      reset: resetVideoSyncMock,
    }),
  },
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    requestRender: () => requestRenderMock(),
    requestNewFrameRender: () => requestNewFrameRenderMock(),
    preCacheVideoFrame: (...args: unknown[]) => preCacheVideoFrameMock(...args),
    clearCaches: vi.fn(),
  },
}));

vi.mock('../../src/services/thumbnailCacheService', () => ({
  thumbnailCacheService: {
    generateForSource: vi.fn(),
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => mediaState,
    setState: (update: unknown) => {
      if (typeof update === 'function') {
        mediaState = (update as (state: Record<string, unknown>) => Record<string, unknown>)(mediaState);
        return;
      }
      mediaState = {
        ...mediaState,
        ...(update as Record<string, unknown>),
      };
    },
    subscribe: vi.fn(),
  },
}));

import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';

const initialTimelineState = useTimelineStore.getState();

describe('timeline restore preview startup', () => {
  beforeEach(() => {
    initWebCodecsPlayerMock.mockReset();
    invalidateCacheMock.mockReset();
    resetVideoSyncMock.mockReset();
    requestRenderMock.mockReset();
    requestNewFrameRenderMock.mockReset();
    preCacheVideoFrameMock.mockReset();

    useTimelineStore.setState(initialTimelineState);
    mediaState = {
      files: [],
      compositions: [],
      folders: [],
      textItems: [],
      solidItems: [],
      activeCompositionId: null,
      openCompositionIds: [],
      slotAssignments: {},
      slotDeckStates: {},
      previewCompositionId: null,
      sourceMonitorFileId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      selectedIds: [],
      expandedFolderIds: [],
      currentProjectId: null,
      currentProjectName: 'Test Project',
      isLoading: false,
      proxyEnabled: false,
      proxyGenerationQueue: [],
      currentlyGeneratingProxyId: null,
      fileSystemSupported: false,
      proxyFolderName: null,
    };

    vi.stubGlobal('VideoDecoder', function VideoDecoder() {});
    vi.stubGlobal('VideoFrame', function VideoFrame() {});

    URL.createObjectURL = vi.fn(() => 'blob:test-video');
  });

  it('starts WebCodecs restore init before canplaythrough fires', async () => {
    const realCreateElement = document.createElement.bind(document);
    const fakeVideo = {
      src: '',
      muted: false,
      playsInline: false,
      preload: '',
      crossOrigin: '',
      duration: 12,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'video') {
        return fakeVideo as unknown as HTMLElement;
      }
      return realCreateElement(tagName);
    }) as typeof document.createElement);

    const webCodecsPlayer = {
      ready: true,
      currentTime: 0,
      seek: vi.fn(),
      hasFrame: vi.fn(() => false),
      getPendingSeekTime: vi.fn(() => null),
      isDestroyed: vi.fn(() => false),
      isFullMode: vi.fn(() => true),
    };
    initWebCodecsPlayerMock.mockResolvedValue(webCodecsPlayer);

    const file = new File(['video'], 'restored.mp4', { type: 'video/mp4' });

    useMediaStore.setState({
      files: [
        {
          id: 'media-restore',
          type: 'video',
          name: 'restored.mp4',
          parentId: null,
          createdAt: 0,
          url: 'blob:test-video',
          file,
          duration: 12,
        },
      ],
    } as any);

    await useTimelineStore.getState().loadState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [
        {
          id: 'clip-1',
          trackId: 'track-v1',
          name: 'restored.mp4',
          startTime: 0,
          duration: 12,
          inPoint: 0,
          outPoint: 12,
          sourceType: 'video',
          mediaFileId: 'media-restore',
          naturalDuration: 12,
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          effects: [],
        },
      ],
      playheadPosition: 1.25,
      duration: 12,
      durationLocked: false,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
      markers: [],
    } as any);

    for (let i = 0; i < 10 && initWebCodecsPlayerMock.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(initWebCodecsPlayerMock).toHaveBeenCalledWith(
      fakeVideo,
      'restored.mp4',
      file
    );
    expect(webCodecsPlayer.seek).toHaveBeenCalledWith(1.25);
    expect(requestNewFrameRenderMock).toHaveBeenCalled();

    const restoredClip = useTimelineStore.getState().clips.find((clip) => clip.id === 'clip-1');
    expect(restoredClip?.isLoading).toBe(false);
    expect(restoredClip?.source?.videoElement).toBe(fakeVideo);
  });

  it('resets stale internal playhead state to the restored paused position', async () => {
    playheadState.position = 66.82;
    playheadState.isUsingInternalPosition = true;
    playheadState.playbackJustStarted = true;
    playheadState.heldPlaybackPosition = 70;
    playheadState.heldPlaybackClipId = 'stale-clip';

    await useTimelineStore.getState().loadState({
      tracks: [
        {
          id: 'track-v1',
          name: 'Video 1',
          type: 'video',
          visible: true,
          muted: false,
          solo: false,
        },
      ],
      clips: [],
      playheadPosition: 58.8,
      duration: 120,
      durationLocked: false,
      zoom: 50,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
      markers: [],
    } as any);

    expect(useTimelineStore.getState().playheadPosition).toBe(58.8);
    expect(playheadState.position).toBe(58.8);
    expect(playheadState.isUsingInternalPosition).toBe(false);
    expect(playheadState.playbackJustStarted).toBe(false);
    expect(playheadState.heldPlaybackPosition).toBeNull();
    expect(playheadState.heldPlaybackClipId).toBeNull();
  });
});
