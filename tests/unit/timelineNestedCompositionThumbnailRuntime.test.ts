import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { seekVideo } from '../../src/engine/export/VideoSeeker';
import { vectorAnimationRuntimeManager } from '../../src/services/vectorAnimation/VectorAnimationRuntimeManager';
import {
  generateTimelineNestedClipSegmentThumbnails,
  generateTimelineNestedCompositionFallbackVideoThumbnails,
} from '../../src/services/timeline/timelineNestedCompositionThumbnailRuntime';

vi.mock('../../src/engine/export/VideoSeeker', () => ({
  seekVideo: vi.fn(async () => undefined),
}));

vi.mock('../../src/services/vectorAnimation/VectorAnimationRuntimeManager', () => ({
  vectorAnimationRuntimeManager: {
    renderClipAtTime: vi.fn(),
  },
}));

const seekVideoMock = vi.mocked(seekVideo);
const renderClipAtTimeMock = vi.mocked(vectorAnimationRuntimeManager.renderClipAtTime);

function defineMediaProperty<T>(target: object, key: string, value: T): void {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });
}

function createReadyVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  defineMediaProperty(video, 'readyState', 2);
  defineMediaProperty(video, 'duration', 100);
  defineMediaProperty(video, 'videoWidth', 1920);
  defineMediaProperty(video, 'videoHeight', 1080);
  return video;
}

function createClip(source: NonNullable<TimelineClip['source']>): TimelineClip {
  return {
    id: 'nested-clip',
    name: 'Nested Clip',
    trackId: 'track-video',
    startTime: 3,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    effects: [],
    opacity: 1,
    source,
    file: null,
  } as TimelineClip;
}

describe('timeline nested composition thumbnail runtime', () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let clearRect: ReturnType<typeof vi.fn>;
  let getContextSpy: ReturnType<typeof vi.spyOn>;
  let toDataURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    drawImage = vi.fn();
    clearRect = vi.fn();
    seekVideoMock.mockClear();
    renderClipAtTimeMock.mockClear();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect,
      drawImage,
    }) as unknown as CanvasRenderingContext2D);
    toDataURLSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,thumb');
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    toDataURLSpy.mockRestore();
  });

  it('does not seek active legacy video handles while preparing timeline thumbnails', async () => {
    const video = createReadyVideo();
    const clip = createClip({ type: 'video', videoElement: video });

    const thumbnails = await generateTimelineNestedClipSegmentThumbnails({
      clip,
      clipId: 'serialized-video',
      clipDuration: 60,
      inPoint: 5,
      maxCount: 2,
    });

    expect(thumbnails).toEqual([]);
    expect(seekVideoMock).not.toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('generates segment thumbnails from image handles', async () => {
    const image = document.createElement('img');
    const clip = createClip({ type: 'image', imageElement: image });

    const thumbnails = await generateTimelineNestedClipSegmentThumbnails({
      clip,
      clipId: 'serialized-image',
      clipDuration: 10,
      inPoint: 0,
      maxCount: 1,
    });

    expect(thumbnails).toEqual(['data:image/jpeg;base64,thumb']);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 160, 90);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 160, 90);
  });

  it('renders vector canvas clips before generating segment thumbnails', async () => {
    const canvas = document.createElement('canvas');
    const clip = createClip({ type: 'lottie', textCanvas: canvas });

    const thumbnails = await generateTimelineNestedClipSegmentThumbnails({
      clip,
      clipId: 'serialized-vector',
      clipDuration: 10,
      inPoint: 0,
      maxCount: 1,
    });

    expect(thumbnails).toEqual(['data:image/jpeg;base64,thumb']);
    expect(renderClipAtTimeMock).toHaveBeenCalledWith(clip, clip.startTime);
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 160, 90);
  });

  it('returns null for fallback thumbnails until the nested video is ready', async () => {
    const video = document.createElement('video');
    defineMediaProperty(video, 'readyState', 1);
    const clip = createClip({ type: 'video', videoElement: video });

    await expect(generateTimelineNestedCompositionFallbackVideoThumbnails(clip, 10)).resolves.toBeNull();
    expect(seekVideoMock).not.toHaveBeenCalled();
  });

  it('generates fallback composition thumbnails from ready legacy video handles', async () => {
    const video = createReadyVideo();
    const clip = createClip({ type: 'video', videoElement: video });

    const thumbnails = await generateTimelineNestedCompositionFallbackVideoThumbnails(clip, 10);

    expect(thumbnails).toEqual(['data:image/jpeg;base64,thumb']);
    expect(seekVideoMock).toHaveBeenCalledWith(video, 0);
  });
});
