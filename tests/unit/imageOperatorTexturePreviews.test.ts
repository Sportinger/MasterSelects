import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureImageOperatorPreviews } from '../../src/services/nodePreview/imageOperatorTexturePreviews';
import { imageOperatorPreviewStage } from '../../src/services/nodePreview/imageOperatorPreviewStages';
import { nodePreviewTextureTap } from '../../src/services/nodePreview/NodePreviewTextureTap';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { createDefaultScanlinesGraph, createDefaultVignetteGraph } from '../../src/services/operators/contextualEffectGraphs';
import type { Effect } from '../../src/types/effects';
import { createDefaultPixelateGraph } from '../../src/services/operators/samplingEffectGraphs';
import * as graphOwner from '../../src/services/operators/effectGraphOwner';
import * as glyphAtlas from '../../src/effects/_shared/glyphAtlas';
import { createDefaultMemoryLeakGraph } from '../../src/services/operators/memoryLeakEffectGraph';
import { memoryImageOperatorPreviewTap } from '../../src/services/nodePreview/memoryImageOperatorPreviews';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const effect = (): Effect => ({ id: 'invert-preview', type: 'invert', name: 'Invert', enabled: true, params: {}, operatorGraph: createDefaultInvertImageGraph() });

describe('image operator texture previews', () => {
  it('reports raw uint resources as text with their live dimensions', async () => {
    const target = { effectId: 'memory-text', nodeId: 'memory', direction: 'output' as const, portId: 'memory' };
    const stage = imageOperatorPreviewStage(target);
    const request = { key: 'memory-text', revision: '1', time: 2, clipId: 'clip', node: {}, width: 160, height: 90,
      interval: 0, priority: 1 } as never;
    const pending = memoryImageOperatorPreviewTap.request(target, request);
    memoryImageOperatorPreviewTap.resolve(stage, { view: {} as GPUTextureView, identity: 'memory:2', width: 9, height: 4, available: true }, false);
    await expect(pending).resolves.toMatchObject({ status: 'live', label: 'Memory words', presentation: 'text',
      drawing: { kind: 'text', lines: ['Raw unsigned 32-bit texture', 'Available: yes', 'Word width: 9', 'Rows: 4'] } });
  });

  it('settles an unavailable raw uint diagnostic explicitly', async () => {
    const target = { effectId: 'memory-missing', nodeId: 'memory', direction: 'output' as const, portId: 'memory' };
    const stage = imageOperatorPreviewStage(target);
    const request = { key: 'memory-missing', revision: '1', time: 0, clipId: 'clip', node: {}, width: 160, height: 90,
      interval: 0, priority: 1 } as never;
    const pending = memoryImageOperatorPreviewTap.request(target, request);
    memoryImageOperatorPreviewTap.reject(stage);
    await expect(pending).resolves.toMatchObject({ status: 'missing', label: 'Memory resource unavailable', presentation: 'text' });
  });

  it('resolves a disconnected memory source with the owner clock provider', () => {
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([]);
    const stage = imageOperatorPreviewStage({ effectId: 'memory-preview', nodeId: 'memory', direction: 'output', portId: 'metadata' });
    vi.spyOn(memoryImageOperatorPreviewTap, 'matching').mockReturnValue([{ stage, target: {
      effectId: 'memory-preview', nodeId: 'memory', direction: 'output', portId: 'metadata',
    }, demand: {} as never }]);
    const resolve = vi.spyOn(memoryImageOperatorPreviewTap, 'resolve').mockImplementation(() => {});
    const resource = { view: {} as GPUTextureView, identity: 'memory:1', width: 12, height: 7, available: true };
    const graph = createDefaultMemoryLeakGraph();
    graph.edges = [...graph.edges.filter(edge => edge.to !== 'output'),
      { id: 'frame-output-direct', from: 'frame', output: 'image', to: 'output', input: 'image' }];
    const effect = { id: 'memory-preview', type: 'memory-leak', name: 'Memory Leak', enabled: true, params: {}, operatorGraph: graph } as Effect;
    const device = { lost: new Promise(() => {}) } as unknown as GPUDevice;
    const resolveMemoryWindow = vi.fn(() => resource);
    expect(captureImageOperatorPreviews({ effect, device, encoder: {} as GPUCommandEncoder, sampler: {} as GPUSampler,
      source: { kind: 'texture', view: {} as GPUTextureView }, width: 64, height: 32, resolveMemoryWindow })).toBe(1);
    expect(resolveMemoryWindow).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(stage, resource, true);
  });

  it('renders a demanded atlas port through the shared resource runtime', () => {
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const graph: NonNullable<Effect['operatorGraph']> = { version: 1, schemaVersion: 1, domain: 'image', layout: {}, nodes: [
      { id: 'atlas', operator: 'glyph.atlas', operatorVersion: 1, bindings: { rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' } },
      { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} },
    ], edges: [{ id: 'atlas-output', from: 'atlas', output: 'image', to: 'output', input: 'image' }] };
    // Owner registration is deliberately separate from resource-runtime coverage.
    vi.spyOn(graphOwner, 'effectOperatorGraph').mockReturnValue(graph);
    const stage = imageOperatorPreviewStage({ effectId: 'ascii-preview', nodeId: 'atlas', direction: 'output', portId: 'image' });
    vi.spyOn(nodePreviewTextureTap, 'matching').mockReturnValue([{ stage, request: {} as never }]);
    const atlasView = {} as GPUTextureView;
    vi.spyOn(glyphAtlas, 'getGlyphAtlas').mockReturnValue({ view: atlasView } as glyphAtlas.GlyphAtlasTexture);
    const capture = vi.spyOn(nodePreviewTextureTap, 'capture').mockImplementation(() => {});
    const draw = vi.fn(), createBindGroup = vi.fn(() => ({}));
    const device = { lost: new Promise(() => {}), limits: { maxSampledTexturesPerShaderStage: 16 }, queue: { writeBuffer: vi.fn() },
      createBuffer: () => ({}), createTexture: () => ({ createView: () => ({}), destroy() {} }), createShaderModule: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createBindGroup } as unknown as GPUDevice;
    const encoder = { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw, end() {} }) } as unknown as GPUCommandEncoder;
    expect(captureImageOperatorPreviews({ effect: { id: 'ascii-preview', type: 'ascii', params: {}, operatorGraph: graph }, device, encoder,
      sampler: {} as GPUSampler, source: { kind: 'texture', view: {} as GPUTextureView }, width: 64, height: 32 })).toBe(1);
    expect(draw).toHaveBeenCalledOnce(); expect(capture).toHaveBeenCalledOnce();
    expect(createBindGroup).toHaveBeenCalledWith(expect.objectContaining({ entries: expect.arrayContaining([{ binding: 3, resource: atlasView }]) }));
  });
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
