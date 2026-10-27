import { describe, expect, it, vi } from 'vitest';

import type { Layer } from '../../src/engine/core/types';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import { TargetPreviewLayerCollector } from '../../src/engine/render/dispatcher/targetPreviewLayerCollector';
import { useTimelineStore } from '../../src/stores/timeline';

describe('TargetPreviewLayerCollector', () => {
  it('keeps native 3D sources for the shared scene pass', () => {
    const collector = new TargetPreviewLayerCollector({} as RenderDeps);
    const layer = {
      id: 'model-layer',
      visible: true,
      opacity: 1,
      is3D: true,
      source: { type: 'model' },
    } as Layer;

    expect(collector.collect([layer])).toEqual([{
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: null,
      sourceWidth: 0,
      sourceHeight: 0,
    }]);
  });

  it('keeps textureless motion adjustments in bottom-to-top stack order', () => {
    const collector = new TargetPreviewLayerCollector({} as RenderDeps);
    const makeLayer = (id: string, type: 'model' | 'motion-adjustment') => ({
      id,
      visible: true,
      opacity: 1,
      source: type === 'motion-adjustment'
        ? { type, intrinsicWidth: 1280, intrinsicHeight: 720 }
        : { type },
    }) as Layer;
    const result = collector.collect([
      makeLayer('top', 'model'),
      makeLayer('adjustment', 'motion-adjustment'),
      makeLayer('bottom', 'model'),
    ]);

    expect(result.map((entry) => entry.layer.id)).toEqual([
      'bottom',
      'adjustment',
      'top',
    ]);
    expect(result[1]).toMatchObject({
      textureView: null,
      externalTexture: null,
      sourceWidth: 1280,
      sourceHeight: 720,
    });
  });

  it('holds a cached scrub frame while the video element has metadata only', () => {
    useTimelineStore.setState({ isDraggingPlayhead: true, isPlaying: false });
    const cachedFrame = { view: { label: 'cached-frame' }, mediaTime: 2 };
    const scrubbingCache = {
      preloadAroundTime: vi.fn(),
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => null),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => cachedFrame),
      getNearestCachedFrameEntry: vi.fn(() => null),
    };
    const collector = new TargetPreviewLayerCollector({
      cacheManager: { getScrubbingCache: () => scrubbingCache },
      exportCanvasManager: { getIsExporting: () => false },
      renderLoop: { getIsPlaying: () => false },
    } as unknown as RenderDeps);
    const video = {
      readyState: 1,
      currentTime: 2,
      seeking: true,
      paused: true,
      src: 'blob:video',
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;
    const layer = {
      id: 'video-layer',
      sourceClipId: 'video-clip',
      visible: true,
      opacity: 1,
      source: { type: 'video', videoElement: video, mediaTime: 2 },
    } as Layer;

    expect(collector.collect([layer])).toEqual([expect.objectContaining({
      layer,
      textureView: cachedFrame.view,
      displayedMediaTime: 2,
      targetMediaTime: 2,
      previewPath: 'not-ready-scrub-cache',
    })]);
  });

  it('places a cached scrub frame with the layer intrinsic size while a fresh element still reports 0x0', () => {
    // The scrub cache is keyed by src: a recreated element (split clip, pool eviction) finds
    // frames another element cached before it has loaded metadata itself.
    useTimelineStore.setState({ isDraggingPlayhead: false, isPlaying: false });
    const cachedFrame = { view: { label: 'cached-frame' }, mediaTime: 2, width: 960, height: 540 };
    const scrubbingCache = {
      preloadAroundTime: vi.fn(),
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => undefined),
      getLastFrame: vi.fn(() => null),
      getLastFrameNearTime: vi.fn(() => null),
      getCachedFrameEntry: vi.fn(() => cachedFrame),
      getNearestCachedFrameEntry: vi.fn(() => null),
    };
    const collector = new TargetPreviewLayerCollector({
      cacheManager: { getScrubbingCache: () => scrubbingCache },
      exportCanvasManager: { getIsExporting: () => false },
      renderLoop: { getIsPlaying: () => false },
    } as unknown as RenderDeps);
    const video = {
      readyState: 0, currentTime: 0, seeking: false, paused: true,
      src: 'blob:video', videoWidth: 0, videoHeight: 0,
    } as HTMLVideoElement;
    const layer = {
      id: 'video-layer', sourceClipId: 'video-clip', visible: true, opacity: 1,
      source: { type: 'video', videoElement: video, mediaTime: 2, intrinsicWidth: 1280, intrinsicHeight: 720 },
    } as Layer;

    expect(collector.collect([layer])).toEqual([expect.objectContaining({
      textureView: cachedFrame.view,
      sourceWidth: 1280,
      sourceHeight: 720,
      previewPath: 'not-ready-scrub-cache',
    })]);
  });
});
