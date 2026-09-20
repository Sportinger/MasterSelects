import { describe, expect, it, vi } from 'vitest';
import { resolveWorkerGpuVideoPresentationLayerStyle } from '../../src/services/render/workerGpuMediaSourceRegistry';
import { VIDEO_FRAME_LAYER_COMPOSITE_SHADER, specializeVideoFrameLayerCompositeShader } from '../../src/services/render/workerGpuVideoFrameLayerShaderSource';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import type { Layer } from '../../src/types';
import { shouldUseLayerVideoFramePresenter } from '../../src/services/render/workerRenderHostRuntimeHandlers';
import { uploadWorkerVideoFrameTexture, workerGpuOperatorProgramCacheKey, workerVideoFrameNeedsStraightAlphaUpload } from '../../src/services/render/workerGpuOperatorPipeline';
import { hasCompositorRenderLayer } from '../../src/services/render/workerGpuVideoFrameCompositor';
import { createDefaultVignetteGraph } from '../../src/services/operators/contextualEffectGraphs';

function layerWithEditedInvert(): Layer {
  const graph = createDefaultInvertImageGraph();
  graph.nodes.find(node => node.id === 'one')!.constants = { value: 0.75 };
  return { opacity: 1, blendMode: 'normal', effects: [{ id: 'invert', name: 'Invert', type: 'invert', enabled: true, params: {}, operatorGraph: graph }] } as unknown as Layer;
}

describe('worker GPU image operator program', () => {
  it.each([
    ['brightness', { amount: 0.2 }],
    ['contrast', { amount: 0 }],
    ['saturation', { amount: 0 }],
    ['exposure', { exposure: 0.5, offset: 0.1, gamma: 1.2 }],
    ['levels', { inputBlack: 0.1, inputWhite: 0.9, gamma: 1.2, outputBlack: 0, outputWhite: 1 }],
    ['hue-shift', { shift: 0.75 }],
    ['temperature', { temperature: -0.4, tint: 0.2 }],
    ['vibrance', { amount: 1 }],
    ['threshold', { level: 0.5 }],
    ['posterize', { levels: 6 }],
  ])('transports a single %s graph without legacy scalar duplication', (type, params) => {
    const layer = { opacity: 1, blendMode: 'normal', effects: [
      { id: type, name: type, type, enabled: true, params },
    ] } as unknown as Layer;
    const style = resolveWorkerGpuVideoPresentationLayerStyle(layer);
    expect(style.operatorProgram?.key).toMatch(/^image-v1-/);
    expect(style.inlineBrightness).toBe(0);
    expect(style.inlineContrast).toBe(1);
    expect(style.inlineSaturation).toBe(1);
  });

  it('does not fold an ordered multi-effect stack into worker inline uniforms', () => {
    const layer = { opacity: 1, blendMode: 'normal', effects: [
      { id: 'brightness', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.2 } },
      { id: 'exposure', name: 'Exposure', type: 'exposure', enabled: true, params: { exposure: 1.5, offset: 0, gamma: 1 } },
    ] } as unknown as Layer;
    const style = resolveWorkerGpuVideoPresentationLayerStyle(layer);
    expect(style.operatorProgram).toBeUndefined();
    expect(style.inlineBrightness).toBe(0);
    expect(style.inlineContrast).toBe(1);
    expect(style.exposure).toBe(0);
    expect(style.complexEffectCount).toBe(2);
    expect(hasCompositorRenderLayer([{
      sourceId: 'video',
      frame: {} as VideoFrame,
      opacity: 1,
      blendMode: 'normal',
      renderLayer: {
        id: 'layer', name: 'Layer', visible: true, opacity: 1, blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
        effects: layer.effects!,
      },
    }])).toBe(true);
  });

  it('does not transport a UV-capable edited pixel effect as an inline operator', () => {
    const layer = { opacity: 1, blendMode: 'normal', effects: [
      { id: 'brightness-uv', name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.2 },
        operatorGraph: createDefaultVignetteGraph() },
    ] } as unknown as Layer;
    const style = resolveWorkerGpuVideoPresentationLayerStyle(layer);
    expect(style.operatorProgram).toBeUndefined();
    expect(style.complexEffectCount).toBe(1);
  });

  it('leaves Vignette to the full worker compositor without legacy scalar duplication', () => {
    const layer = { opacity: 1, blendMode: 'normal', effects: [
      { id: 'vignette', name: 'Vignette', type: 'vignette', enabled: true,
        params: { amount: 0.9, size: 0.2, softness: 0.1, roundness: 1.7 } },
    ] } as unknown as Layer;
    const style = resolveWorkerGpuVideoPresentationLayerStyle(layer);
    expect(style.operatorProgram).toBeUndefined();
    expect(style.complexEffectCount).toBe(1);
    expect(style.vignetteAmount).toBe(0);
    expect(style.vignetteSize).toBe(0.5);
  });

  it('preserves the compiled edited graph as a serializable layer style', () => {
    const style = resolveWorkerGpuVideoPresentationLayerStyle(layerWithEditedInvert());
    expect(style.operatorProgram?.key).toMatch(/^image-v1-/);
    expect(style.operatorProgram?.wgsl).toContain('0.75');
    expect(JSON.parse(JSON.stringify(style.operatorProgram))).toEqual(style.operatorProgram);
    expect(style.inlineInvert).toBe(false);
  });

  it('uploads alpha-capable and unknown frames while preserving opaque zero-copy formats', () => {
    expect(workerVideoFrameNeedsStraightAlphaUpload({ format: 'RGBA' } as VideoFrame)).toBe(true);
    expect(workerVideoFrameNeedsStraightAlphaUpload({ format: 'I420A' } as VideoFrame)).toBe(true);
    expect(workerVideoFrameNeedsStraightAlphaUpload({ format: null } as VideoFrame)).toBe(true);
    expect(workerVideoFrameNeedsStraightAlphaUpload({ format: 'NV12' } as VideoFrame)).toBe(false);
    expect(workerVideoFrameNeedsStraightAlphaUpload({ format: 'RGBX' } as VideoFrame)).toBe(false);
  });

  it('uploads straight alpha with the production texture usage and destroys failed uploads', () => {
    const previousUsage = globalThis.GPUTextureUsage;
    Object.defineProperty(globalThis, 'GPUTextureUsage', { configurable: true,
      value: { COPY_DST: 1, TEXTURE_BINDING: 2, RENDER_ATTACHMENT: 4 } });
    const destroy = vi.fn(), texture = { destroy } as unknown as GPUTexture;
    const createTexture = vi.fn(() => texture), copyExternalImageToTexture = vi.fn();
    const device = { createTexture, queue: { copyExternalImageToTexture } } as unknown as GPUDevice;
    const frame = { displayWidth: 3, displayHeight: 2, codedWidth: 4, codedHeight: 4 } as VideoFrame;
    try {
      expect(uploadWorkerVideoFrameTexture(device, frame, 'srgb')).toBe(texture);
      expect(createTexture).toHaveBeenCalledWith(expect.objectContaining({
        size: { width: 3, height: 2 }, usage: 7,
      }));
      expect(copyExternalImageToTexture).toHaveBeenCalledWith({ source: frame },
        { texture, colorSpace: 'srgb', premultipliedAlpha: false }, { width: 3, height: 2 });
      copyExternalImageToTexture.mockImplementationOnce(() => { throw new Error('device lost'); });
      expect(() => uploadWorkerVideoFrameTexture(device, frame, 'srgb')).toThrow('device lost');
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      if (previousUsage === undefined) delete (globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage;
      else Object.defineProperty(globalThis, 'GPUTextureUsage', { configurable: true, value: previousUsage });
    }
  });

  it('specializes the existing worker composite shader in the same color-effect position', () => {
    const program = resolveWorkerGpuVideoPresentationLayerStyle(layerWithEditedInvert()).operatorProgram!;
    const shader = specializeVideoFrameLayerCompositeShader(VIDEO_FRAME_LAYER_COMPOSITE_SHADER, program.wgsl);
    expect(shader).toContain('fn evaluateImageGraph');
    expect(shader).toContain('let operatorColor = evaluateImageGraph(vec4f(rgb, alpha));');
    expect(shader.indexOf('operatorColor')).toBeLessThan(shader.indexOf('layer.inlineInvert == 1u'));
    expect((shader.match(/@fragment/g) ?? [])).toHaveLength(1);
  });

  it('routes graph-only layers through the layer presenter and keys caches by compiled program', () => {
    const program = resolveWorkerGpuVideoPresentationLayerStyle(layerWithEditedInvert()).operatorProgram!;
    expect(shouldUseLayerVideoFramePresenter([{ sourceId: 'video', mediaTime: 0, opacity: 1, blendMode: 'normal', operatorProgram: program }])).toBe(true);
    expect(workerGpuOperatorProgramCacheKey(program)).toBe(program.key);
    expect(workerGpuOperatorProgramCacheKey({ key: `${program.key}-edited` })).not.toBe(workerGpuOperatorProgramCacheKey(program));
  });
});
