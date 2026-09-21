import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureImageOperatorPreviews } from '../../src/services/nodePreview/imageOperatorTexturePreviews';
import { imageOperatorPreviewStage } from '../../src/services/nodePreview/imageOperatorPreviewStages';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultScanlinesGraph, createDefaultVignetteGraph } from '../../src/services/operators/contextualEffectGraphs';
import type { Effect } from '../../src/types/effects';
import { createDefaultPixelateGraph } from '../../src/services/operators/samplingEffectGraphs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const stage = imageOperatorPreviewStage({ effectId: 'vignette-preview', nodeId: 'shade', direction: 'output', portId: 'value' });
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage, request: {} as never }]);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() } as unknown as GPURenderPassEncoder;
    vi.spyOn(nodePreviewTextureTap, 'draw').mockImplementation((_stage, _device, _encoder, _width, _height, encode) => encode(pass));
    let shader = '';
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
    const writeBuffer = vi.fn(), createBuffer = vi.fn(() => ({}));
    const device = { lost: new Promise(() => {}), queue: { writeBuffer }, createBuffer,
      createShaderModule: vi.fn(({ code }: { code: string }) => { shader = code; return {}; }),
      createRenderPipeline: vi.fn(() => pipeline), createBindGroup: vi.fn(() => ({})) } as unknown as GPUDevice;
    const vignetteEffect = { id: 'vignette-preview', type: 'vignette', name: 'Vignette', enabled: true, params: {},
      operatorGraph: createDefaultVignetteGraph() } as Effect;
    expect(captureImageOperatorPreviews({ effect: vignetteEffect, device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 640, height: 360 })).toBe(1);
    expect(shader).toContain('evaluateImageGraph(textureSample(imagePreviewSource, imagePreviewSampler, input.uv), input.uv, imageParameters)');
    expect(createBuffer).toHaveBeenCalledTimes(1);
    expect(writeBuffer).toHaveBeenCalledTimes(1);
  });

  it('uploads the render composition clock after preview parameter slots', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const stage = imageOperatorPreviewStage({ effectId: 'scanlines-preview', nodeId: 'shade', direction: 'output', portId: 'value' });
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage, request: {} as never }]);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() } as unknown as GPURenderPassEncoder;
    vi.spyOn(nodePreviewTextureTap, 'draw').mockImplementation((_stage, _device, _encoder, _width, _height, encode) => encode(pass));
    const writes: Float32Array[] = [];
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
    const device = { lost: new Promise(() => {}), queue: { writeBuffer: vi.fn((_buffer: GPUBuffer, _offset: number, data: Float32Array) => writes.push(data)) },
      createBuffer: vi.fn(() => ({})), createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => pipeline),
      createBindGroup: vi.fn(() => ({})) } as unknown as GPUDevice;
    const scanlinesEffect = { id: 'scanlines-preview', type: 'scanlines', name: 'Scanlines', enabled: true, params: {},
      operatorGraph: createDefaultScanlinesGraph() } as Effect;
    expect(captureImageOperatorPreviews({ effect: scanlinesEffect, device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 640, height: 360, timelineTimeSeconds: 4.25 })).toBe(1);
    expect(writes[0]).toHaveLength(68);
    expect(writes[0][64]).toBe(4.25);
  });

  it('uses the existing external source helper and uploads preview resolution for sampling graphs', () => {
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const stage = imageOperatorPreviewStage({ effectId: 'pixelate-preview', nodeId: 'sample', direction: 'output', portId: 'image' });
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage, request: {} as never }]);
    const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() } as unknown as GPURenderPassEncoder;
    vi.spyOn(nodePreviewTextureTap, 'draw').mockImplementation((_stage, _device, _encoder, _width, _height, encode) => encode(pass));
    let shader = ''; const writes: Float32Array[] = [];
    const pipeline = { getBindGroupLayout: vi.fn(() => ({})) } as unknown as GPURenderPipeline;
    const device = { lost: new Promise(() => {}), queue: { writeBuffer: vi.fn((_buffer: GPUBuffer, _offset: number, data: Float32Array) => writes.push(data)) },
      createBuffer: vi.fn(() => ({})), createShaderModule: vi.fn(({ code }: { code: string }) => { shader = code; return {}; }),
      createRenderPipeline: vi.fn(() => pipeline), createBindGroup: vi.fn(() => ({})) } as unknown as GPUDevice;
    const pixelateEffect = { id: 'pixelate-preview', type: 'pixelate', name: 'Pixelate', enabled: true, params: {},
      operatorGraph: createDefaultPixelateGraph() } as Effect;
    expect(captureImageOperatorPreviews({ effect: pixelateEffect, device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'external', texture: {} as GPUExternalTexture }, width: 854, height: 480 })).toBe(1);
    expect(shader).toContain('fn sampleImageGraphSource(uv: vec2f) -> vec4f { return textureSampleBaseClampToEdge');
    expect(writes[0].slice(64)).toEqual(new Float32Array([0, 0, 854, 480]));
  });
});
