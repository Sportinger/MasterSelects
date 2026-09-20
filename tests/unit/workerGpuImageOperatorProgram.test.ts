import { describe, expect, it, vi } from 'vitest';
import { resolveWorkerGpuVideoPresentationLayerStyle } from '../../src/services/render/workerGpuMediaSourceRegistry';
import { VIDEO_FRAME_LAYER_COMPOSITE_SHADER, specializeVideoFrameLayerCompositeShader } from '../../src/services/render/workerGpuVideoFrameLayerShaderSource';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import type { Layer } from '../../src/types';
import { shouldUseLayerVideoFramePresenter } from '../../src/services/render/workerRenderHostRuntimeHandlers';
import { uploadWorkerVideoFrameTexture, workerGpuOperatorProgramCacheKey, workerVideoFrameNeedsStraightAlphaUpload } from '../../src/services/render/workerGpuOperatorPipeline';

function layerWithEditedInvert(): Layer {
  const graph = createDefaultInvertImageGraph();
  graph.nodes.find(node => node.id === 'one')!.constants = { value: 0.75 };
  return { opacity: 1, blendMode: 'normal', effects: [{ id: 'invert', name: 'Invert', type: 'invert', enabled: true, params: {}, operatorGraph: graph }] } as unknown as Layer;
}

describe('worker GPU image operator program', () => {
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
