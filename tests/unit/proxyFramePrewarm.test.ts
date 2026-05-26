import { describe, expect, it, vi } from 'vitest';
import {
  collectProxyFramePrewarmRequests,
  prewarmProxyFramesForTimelinePosition,
} from '../../src/services/proxyFramePrewarm';
import { proxyFrameCache } from '../../src/services/proxyFrameCache';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types';

vi.mock('../../src/services/proxyFrameCache', () => ({
  proxyFrameCache: {
    getCachedFrame: vi.fn(() => null),
    getFrame: vi.fn(() => Promise.resolve(null)),
  },
}));

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip 1',
    file: new File([], 'clip.mp4'),
    startTime: 10,
    duration: 20,
    inPoint: 2,
    outPoint: 22,
    mediaFileId: 'media-1',
    source: {
      type: 'video',
      videoElement: {} as HTMLVideoElement,
      mediaFileId: 'media-1',
    },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      blendMode: 'normal',
    },
    effects: [],
    ...overrides,
  } as TimelineClip;
}

function createMedia(overrides: Partial<MediaFile> = {}): MediaFile {
  return {
    id: 'media-1',
    name: 'Clip 1',
    type: 'video',
    url: 'blob://clip',
    proxyStatus: 'ready',
    proxyFps: 30,
    ...overrides,
  } as MediaFile;
}

function createState(clips: TimelineClip[] = [createClip()]) {
  return {
    clips,
    getInterpolatedSpeed: vi.fn(() => 1),
    getSourceTimeForClip: vi.fn((_clipId: string, clipLocalTime: number) => clipLocalTime),
  };
}

describe('proxy frame prewarm', () => {
  it('collects the active video proxy frame at the current timeline position', () => {
    const state = createState();

    const requests = collectProxyFramePrewarmRequests(state, [createMedia()], 13.25);

    expect(requests).toEqual([
      {
        mediaFileId: 'media-1',
        mediaTime: 5.25,
        frameIndex: 157,
        fps: 30,
      },
    ]);
  });

  it('uses the out point as the reverse-speed source anchor', () => {
    const state = createState();
    state.getInterpolatedSpeed.mockReturnValue(-1);
    state.getSourceTimeForClip.mockReturnValue(-3);

    const requests = collectProxyFramePrewarmRequests(state, [createMedia()], 13);

    expect(requests[0]?.mediaTime).toBe(19);
    expect(requests[0]?.frameIndex).toBe(570);
  });

  it('skips clips without ready or partially generated proxies', () => {
    const state = createState();

    expect(
      collectProxyFramePrewarmRequests(state, [createMedia({ proxyStatus: 'none' })], 13)
    ).toEqual([]);
  });

  it('deduplicates repeated prewarm calls for the same media frame', () => {
    const state = createState();

    prewarmProxyFramesForTimelinePosition(state, [createMedia()], 13.25);
    prewarmProxyFramesForTimelinePosition(state, [createMedia()], 13.26);

    expect(proxyFrameCache.getCachedFrame).toHaveBeenCalledTimes(1);
    expect(proxyFrameCache.getFrame).toHaveBeenCalledTimes(1);
  });
});
