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
