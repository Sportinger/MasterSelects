import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureImageOperatorPreviews } from '../../src/services/nodePreview/imageOperatorTexturePreviews';
import { imageOperatorPreviewStage } from '../../src/services/nodePreview/imageOperatorPreviewStages';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultVignetteGraph } from '../../src/services/operators/contextualEffectGraphs';
import type { Effect } from '../../src/types/effects';

afterEach(() => vi.restoreAllMocks());

const effect = (): Effect => ({ id: 'invert-preview', type: 'invert', name: 'Invert', enabled: true, params: {}, operatorGraph: createDefaultInvertImageGraph() });

describe('image operator texture previews', () => {
  it('does no compiler or GPU work without an active preview demand', () => {
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([]);
    const device = new Proxy({}, { get: () => { throw new Error('GPU must stay idle'); } }) as GPUDevice;
    expect(captureImageOperatorPreviews({ effect: effect(), device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 1920, height: 1080 })).toBe(0);
  });

  it('lowers a demanded intermediate port and draws it through the existing texture tap', () => {
    const stage = imageOperatorPreviewStage({ effectId: 'invert-preview', nodeId: 'split', direction: 'output', portId: 'x' });
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage, request: {} as never }]);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() } as unknown as GPURenderPassEncoder;
    const draw = vi.spyOn(nodePreviewTextureTap, 'draw').mockImplementation((_stage, _device, _encoder, _width, _height, encode) => encode(pass));
    let shader = '';
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
    const device = {
      lost: new Promise(() => {}),
      createShaderModule: vi.fn(({ code }: { code: string }) => { shader = code; return {}; }),
      createRenderPipeline: vi.fn(() => pipeline),
      createBindGroup: vi.fn(() => ({})),
    } as unknown as GPUDevice;
    expect(captureImageOperatorPreviews({ effect: effect(), device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 640, height: 360 })).toBe(1);
    expect(draw).toHaveBeenCalledWith(stage, device, expect.anything(), 640, 360, expect.any(Function));
    expect(shader).toContain('evaluateImageGraph');
    expect(shader).toContain('textureSample(imagePreviewSource');
    expect((pass.draw as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(3);
  });

  it('supplies normalized fragment coordinates to a demanded UV-dependent port', () => {
    const stage = imageOperatorPreviewStage({ effectId: 'vignette-preview', nodeId: 'shade', direction: 'output', portId: 'value' });
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage, request: {} as never }]);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() } as unknown as GPURenderPassEncoder;
    vi.spyOn(nodePreviewTextureTap, 'draw').mockImplementation((_stage, _device, _encoder, _width, _height, encode) => encode(pass));
    let shader = '';
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
    const device = { lost: new Promise(() => {}), createShaderModule: vi.fn(({ code }: { code: string }) => { shader = code; return {}; }),
      createRenderPipeline: vi.fn(() => pipeline), createBindGroup: vi.fn(() => ({})) } as unknown as GPUDevice;
    const vignetteEffect = { id: 'vignette-preview', type: 'vignette', name: 'Vignette', enabled: true, params: {},
      operatorGraph: createDefaultVignetteGraph() } as Effect;
    expect(captureImageOperatorPreviews({ effect: vignetteEffect, device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 640, height: 360 })).toBe(1);
    expect(shader).toContain('evaluateImageGraph(textureSample(imagePreviewSource, imagePreviewSampler, input.uv), input.uv)');
  });
});
