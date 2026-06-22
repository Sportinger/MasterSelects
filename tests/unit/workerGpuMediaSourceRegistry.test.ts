import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types';
import { WorkerGpuMediaSourceRegistry } from '../../src/services/render/workerGpuMediaSourceRegistry';

function createVideoLayer(effects: Layer['effects'], opacity = 0.8): Layer {
  const file = new File(['video-source'], 'worker-video.mp4', { type: 'video/mp4' });
  return {
    id: 'layer-video',
    name: 'Worker Video',
    sourceClipId: 'clip-video',
    visible: true,
    opacity,
    blendMode: 'normal',
    source: {
      type: 'video',
      file,
      mediaFileId: 'media-video',
      mediaTime: 2,
      targetMediaTime: 2,
      runtimeSourceId: 'media:media-video',
      runtimeSessionKey: 'interactive:clip-video',
    },
    effects,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  } as Layer;
}

describe('WorkerGpuMediaSourceRegistry', () => {
  it('serializes full render layer metadata for the worker compositor', () => {
    const registry = new WorkerGpuMediaSourceRegistry();
    const layer = {
      ...createVideoLayer([
        {
          id: 'fx-brightness',
          name: 'Brightness',
          type: 'brightness',
          enabled: true,
          params: { amount: 0.25 },
        },
        {
          id: 'fx-blur',
          name: 'Gaussian Blur',
          type: 'gaussian-blur',
          enabled: true,
          params: { radius: 6 },
        },
      ], 0.65),
      blendMode: 'screen',
      position: { x: 120, y: -40, z: 3 },
      scale: { x: 0.75, y: 1.2 },
      rotation: { x: 0, y: 0, z: 12 },
      sourceRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    } as Layer;

    const sources = registry.resolveVideoPresentationSources([layer], []);

    expect(sources).toHaveLength(1);
    expect(sources[0].renderLayer).toMatchObject({
      id: 'layer-video',
      name: 'Worker Video',
      sourceClipId: 'clip-video',
      visible: true,
      opacity: 0.65,
      blendMode: 'screen',
      position: { x: 120, y: -40, z: 3 },
      scale: { x: 0.75, y: 1.2 },
      rotation: { x: 0, y: 0, z: 12 },
      sourceRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    });
    expect(sources[0].renderLayer.effects).toHaveLength(2);
    expect(sources[0].renderLayer.effects[1]).toMatchObject({
      id: 'fx-blur',
      type: 'gaussian-blur',
      params: { radius: 6 },
    });
    expect(sources[0].renderLayer.effects[1]?.params).not.toBe(layer.effects[1]?.params);
  });

  it('uses an explicit opacity-envelope fallback for worker-unsupported particle render effects', () => {
    const registry = new WorkerGpuMediaSourceRegistry();
    const layer = createVideoLayer([
      {
        id: 'fx-brightness',
        name: 'Brightness',
        type: 'brightness',
        enabled: true,
        params: { amount: 0.2 },
      },
      {
        id: 'fx-particle',
        name: 'Pixel Particle Disintegrate',
        type: 'pixel-particle-disintegrate',
        enabled: true,
        params: { progress: 0.35 },
      },
      {
        id: 'fx-blur',
        name: 'Gaussian Blur',
        type: 'gaussian-blur',
        enabled: true,
        params: { radius: 8 },
      },
    ]);

    const sources = registry.resolveVideoPresentationSources([layer], []);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      layerId: 'layer-video',
      renderEffectFallback: 'opacity-envelope',
      unsupportedRenderEffectTypes: ['pixel-particle-disintegrate'],
      ignoredAfterRenderEffectTypes: ['gaussian-blur'],
      inlineBrightness: 0.2,
    });
    expect(sources[0].renderEffectFallbackOpacity).toBeCloseTo(0.5, 5);
    expect(sources[0].opacity).toBeCloseTo(0.4, 5);
    expect(sources[0].complexEffectCount).toBe(1);
    expect(registry.unsupportedRenderEffectFallbackCount).toBe(1);
    expect(registry.lastUnsupportedRenderEffectFallbacks).toMatchObject([
      {
        layerId: 'layer-video',
        effectTypes: ['pixel-particle-disintegrate'],
        ignoredAfterRenderEffectTypes: ['gaussian-blur'],
        fallback: 'opacity-envelope',
      },
    ]);
    expect(registry.lastUnsupportedRenderEffectFallbacks[0]?.opacity).toBeCloseTo(0.5, 5);
  });
});
