import { afterEach, expect, it, vi } from 'vitest';
import { tryCollectHtmlVideoPreview } from '../../src/engine/render/nestedComp/htmlVideoPreview';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Layer } from '../../src/types/layers';
import type { ScrubbingCache } from '../../src/engine/texture/ScrubbingCache';
import type { TextureManager } from '../../src/engine/texture/TextureManager';

const initial = useTimelineStore.getState();
afterEach(() => {
  useTimelineStore.setState(initial);
  vi.restoreAllMocks();
});

it('replaces a paused nested GPU hold with decoded pixels and retains them while seeking', () => {
  useTimelineStore.setState({ isPlaying: false, isDraggingPlayhead: false });
  const video = document.createElement('video');
  Object.defineProperties(video, {
    videoWidth: { value: 1920 }, videoHeight: { value: 1080 },
    readyState: { value: 4 }, paused: { value: true },
    seeking: { value: false, configurable: true },
    currentTime: { value: 2.82 },
  });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const staleView = {} as GPUTextureView;
  const freshView = {} as GPUTextureView;
  const cache = {
    getLastPresentedTime: () => 2.82,
    getLastPresentedOwner: () => 'nested-video:split-b',
    getLastFrame: () => ({ view: staleView, mediaTime: 0, width: 1920, height: 1080 }),
    getLastFrameNearTime: () => null,
  } as unknown as ScrubbingCache;
  const createCanvasTexture = vi.fn(() => ({} as GPUTexture));
  const textures = { createCanvasTexture, getImageView: () => freshView } as unknown as TextureManager;
  const layer = {
    sourceClipId: 'nested-video:split-b', effects: [],
    source: { type: 'video', videoElement: video, mediaTime: 2.82 },
  } as Layer;
  const options = {
    layer, runtimeProvider: null, clipProvider: null, textureManager: textures,
    scrubbingCache: cache, htmlHoldUntil: new Map(), stableCanvasFrames: new Map(),
    debug: vi.fn(), warn: vi.fn(),
  };
  const frame = tryCollectHtmlVideoPreview(options);
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
  expect(frame?.textureView).toBe(freshView);
  expect(frame?.displayedMediaTime).toBe(2.82);
  expect(frame?.previewPath).toBe('stable-canvas');

  Object.defineProperty(video, 'seeking', { value: true });
  const held = tryCollectHtmlVideoPreview(options);
  expect(drawImage).toHaveBeenCalledTimes(1);
  expect(held?.textureView).toBe(freshView);
  expect(held?.previewPath).toBe('stable-canvas-hold');
});

it('never reports a cached scrub frame with the 0x0 size of a video element that has no metadata yet (NESTED_SMALL_COMP_PREVIEW)', () => {
  // A composition nested right after its clip played inside it: the new element shares the
  // src, so frames cached by the other element are found before this one has loaded.
  useTimelineStore.setState({ isPlaying: false, isDraggingPlayhead: false });
  const video = document.createElement('video');
  Object.defineProperties(video, {
    videoWidth: { value: 0 }, videoHeight: { value: 0 },
    readyState: { value: 0 }, paused: { value: false },
    seeking: { value: false }, currentTime: { value: 0 },
  });
  const cachedView = {} as GPUTextureView;
  const cache = {
    getLastPresentedTime: () => undefined,
    getLastPresentedOwner: () => undefined,
    getLastFrame: () => null,
    getLastFrameNearTime: () => null,
    // No size anywhere: neither the element, the layer nor the cache entry knows one.
    getCachedFrameEntry: () => ({ view: cachedView, mediaTime: 0.5 }),
    getNearestCachedFrameEntry: () => ({ view: cachedView, mediaTime: 0.5 }),
  } as unknown as ScrubbingCache;
  const layer = {
    sourceClipId: 'nested-video:inner', effects: [],
    source: { type: 'video', videoElement: video, mediaTime: 0.5 },
  } as Layer;
  const frame = tryCollectHtmlVideoPreview({
    layer, runtimeProvider: null, clipProvider: null, textureManager: {} as TextureManager,
    scrubbingCache: cache, htmlHoldUntil: new Map(), stableCanvasFrames: new Map(),
    debug: vi.fn(), warn: vi.fn(),
  });
  if (frame?.textureView) {
    expect(frame.sourceWidth).toBeGreaterThan(0);
    expect(frame.sourceHeight).toBeGreaterThan(0);
  }
  expect(frame?.textureView).not.toBe(cachedView);
});

it('places a cached scrub frame for a 0x0 element with the layer intrinsic size, else the cached texture size', () => {
  useTimelineStore.setState({ isPlaying: false, isDraggingPlayhead: false });
  const video = document.createElement('video');
  Object.defineProperties(video, {
    videoWidth: { value: 0 }, videoHeight: { value: 0 },
    readyState: { value: 0 }, paused: { value: false },
    seeking: { value: false }, currentTime: { value: 0 },
  });
  const cachedView = {} as GPUTextureView;
  const cache = {
    getLastPresentedTime: () => undefined,
    getLastPresentedOwner: () => undefined,
    getLastFrame: () => null,
    getLastFrameNearTime: () => null,
    getCachedFrameEntry: () => ({ view: cachedView, mediaTime: 0.5, width: 640, height: 360 }),
    getNearestCachedFrameEntry: () => null,
  } as unknown as ScrubbingCache;
  const collect = (source: Record<string, unknown>) => tryCollectHtmlVideoPreview({
    layer: { sourceClipId: 'nested-video:inner', effects: [], source: { type: 'video', videoElement: video, mediaTime: 0.5, ...source } } as Layer,
    runtimeProvider: null, clipProvider: null, textureManager: {} as TextureManager,
    scrubbingCache: cache, htmlHoldUntil: new Map(), stableCanvasFrames: new Map(),
    debug: vi.fn(), warn: vi.fn(),
  });
  expect(collect({ intrinsicWidth: 1920, intrinsicHeight: 1080 })).toMatchObject({ textureView: cachedView, sourceWidth: 1920, sourceHeight: 1080 });
  expect(collect({})).toMatchObject({ textureView: cachedView, sourceWidth: 640, sourceHeight: 360 });
});
