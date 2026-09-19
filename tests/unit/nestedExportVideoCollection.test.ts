import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/engine/core/types';
import type { TextureManager } from '../../src/engine/texture/TextureManager';
import type { ScrubbingCache } from '../../src/engine/texture/ScrubbingCache';
import { NestedLayerCollector } from '../../src/engine/render/nestedComp/NestedLayerCollector';

function createVideo() {
  return {
    readyState: 4, seeking: false, paused: true, currentTime: 2.8,
    videoWidth: 1920, videoHeight: 1080, src: 'blob:dedicated-export-video',
  } as HTMLVideoElement;
}

function createLayer(video: HTMLVideoElement): Layer {
  return {
    id: 'nested-export-split-b', sourceClipId: 'split-b', visible: true,
    opacity: 1, effects: [], blendMode: 'normal',
    source: { type: 'video', videoElement: video, mediaTime: 2.8 },
  } as Layer;
}

function createCollector(importVideoTexture: ReturnType<typeof vi.fn>, cache: object) {
  const collector = new NestedLayerCollector(
    { importVideoTexture } as unknown as TextureManager,
    cache as ScrubbingCache, null, () => null,
  );
  return (layer: Layer) => collector.collect([layer], undefined, undefined, 0, false, 'export');
}

describe('nested export HTML frames', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('imports the sought export video without preview owner metadata or cached hold frames', () => {
    vi.stubGlobal('navigator', { userAgent: 'Chrome/153.0.0.0' });
    const externalTexture = {} as GPUExternalTexture;
    const importVideoTexture = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(externalTexture);
    const cache = {
      preloadAroundTime: vi.fn(),
      getLastPresentedTime: vi.fn(() => undefined),
      getLastPresentedOwner: vi.fn(() => 'previous-split-a'),
      getCachedFrame: vi.fn(() => ({ label: 'stale-preview-frame' })),
      getLastFrameNearTime: vi.fn(() => ({ view: {}, mediaTime: 2.7333333333 })),
    };
    const collect = createCollector(importVideoTexture, cache);
    const video = createVideo();
    const layer = createLayer(video);

    // An import gap defers the composition; retry at the SAME time succeeds
    // even though this dedicated export video has never appeared in preview.
    expect(collect(layer)).toEqual([]);
    expect(collect(layer)).toEqual([expect.objectContaining({
      layer, externalTexture, isVideo: true, textureView: null,
      displayedMediaTime: 2.8, targetMediaTime: 2.8, previewPath: 'live-import',
    })]);
    expect(importVideoTexture).toHaveBeenNthCalledWith(1, video);
    expect(importVideoTexture).toHaveBeenNthCalledWith(2, video);
    for (const previewMethod of Object.values(cache)) expect(previewMethod).not.toHaveBeenCalled();
  });

  it.each([{ readyState: 1, seeking: false }, { readyState: 4, seeking: true }])(
    'defers a video that is not ready for exact export: %j', (state) => {
      const importVideoTexture = vi.fn();
      const collect = createCollector(importVideoTexture, {});
      expect(collect(createLayer(Object.assign(createVideo(), state)))).toEqual([]);
      expect(importVideoTexture).not.toHaveBeenCalled();
    },
  );

  it('does not return an older copied frame after capture fails on Android or Firefox', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Firefox/153.0' });
    const staleFrame = { view: { label: 'split-a' }, width: 1920, height: 1080, mediaTime: 2.7333333333 };
    const freshFrame = { view: { label: 'split-b' }, width: 1920, height: 1080, mediaTime: 2.8 };
    const cache = {
      captureVideoFrame: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      getLastFrameNearTime: vi.fn(() => staleFrame),
    };
    const importVideoTexture = vi.fn(() => null);
    const collect = createCollector(importVideoTexture, cache);
    const video = createVideo();
    const layer = createLayer(video);

    expect(collect(layer)).toEqual([]);
    expect(cache.getLastFrameNearTime).not.toHaveBeenCalled();
    cache.getLastFrameNearTime.mockReturnValue(freshFrame);
    expect(collect(layer)).toEqual([expect.objectContaining({
      layer, isVideo: false, textureView: freshFrame.view,
      displayedMediaTime: 2.8, targetMediaTime: 2.8,
    })]);
    expect(cache.captureVideoFrame).toHaveBeenCalledTimes(2);
    expect(cache.captureVideoFrame).toHaveBeenLastCalledWith(video, 'split-b');
    expect(importVideoTexture).toHaveBeenCalledTimes(1);
  });
});
