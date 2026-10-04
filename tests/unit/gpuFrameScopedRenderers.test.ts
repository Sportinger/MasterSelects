import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplatVisibilityPass } from '../../src/engine/gaussian/core/SplatVisibilityPass';
import { SplatSortPass } from '../../src/engine/gaussian/core/SplatSortPass';
import { ParticleCompute } from '../../src/engine/gaussian/effects/ParticleCompute';
import { EffectorCompute, type LocalSplatEffectorData } from '../../src/engine/native3d/passes/EffectorCompute';
import { SlicePipeline } from '../../src/engine/pipeline/SlicePipeline';
import { PixelParticleDisintegrateRenderer } from '../../src/engine/particles/PixelParticleDisintegrateRenderer';
import { RenderOutputRouterAdapter } from '../../src/engine/render/RenderOutputRouterAdapter';
import type { RenderTargetSnapshot } from '../../src/engine/render/contracts';
import type { GaussianSplatParticleSettings } from '../../src/engine/gaussian/types';
import type { Effect } from '../../src/types/effects';
import { createDefaultMask, createDefaultSlice, type OutputSlice } from '../../src/types/outputSlice';

// Every scenario renders two layers/targets into ONE command encoder. queue.writeBuffer is
// staged before that encoder is submitted, so each draw/dispatch must bind its own buffer
// and no buffer referenced earlier in the encoder may be destroyed before the next frame.

interface FakeBuffer { label?: string; size: number; destroy: ReturnType<typeof vi.fn>; bytes?: Uint8Array }
interface BindGroupDescriptorLike { entries: Array<{ binding: number; resource: unknown }> }

function fakeGpu() {
  const buffers: FakeBuffer[] = [];
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn((descriptor: BindGroupDescriptorLike) => descriptor),
    createBuffer: vi.fn((descriptor: { label?: string; size: number }) => {
      const buffer: FakeBuffer = {
        label: descriptor.label,
        size: descriptor.size,
        destroy: vi.fn(),
        getMappedRange: () => new ArrayBuffer(descriptor.size),
        unmap: () => {},
      } as FakeBuffer;
      buffers.push(buffer);
      return buffer;
    }),
    queue: {
      writeBuffer: vi.fn((buffer: FakeBuffer, _offset: number, data: ArrayBuffer | ArrayBufferView) => {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
          : new Uint8Array(data.slice(0));
        buffer.bytes = bytes;
      }),
    },
  };
  const computeBindings: Array<Map<number, BindGroupDescriptorLike>> = [];
  const renderPasses: Array<{ bindings: Map<number, BindGroupDescriptorLike>; vertexBuffer?: unknown; draws: unknown[][] }> = [];
  const encoder = {
    copyBufferToBuffer: vi.fn(),
    beginComputePass: vi.fn(() => {
      const bindings = new Map<number, BindGroupDescriptorLike>();
      computeBindings.push(bindings);
      return {
        setPipeline: vi.fn(),
        setBindGroup: (index: number, group: BindGroupDescriptorLike) => bindings.set(index, group),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      };
    }),
    beginRenderPass: vi.fn(() => {
      const record = { bindings: new Map<number, BindGroupDescriptorLike>(), vertexBuffer: undefined as unknown, draws: [] as unknown[][] };
      renderPasses.push(record);
      return {
        setPipeline: vi.fn(),
        setBindGroup: (index: number, group: BindGroupDescriptorLike) => record.bindings.set(index, group),
        setVertexBuffer: (_slot: number, buffer: unknown) => { record.vertexBuffer = buffer; },
        draw: (...args: unknown[]) => record.draws.push(args),
        end: vi.fn(),
      };
    }),
  };
  return {
    device: device as unknown as GPUDevice,
    encoder: encoder as unknown as GPUCommandEncoder,
    buffers,
    computeBindings,
    renderPasses,
  };
}

function boundBuffer(group: BindGroupDescriptorLike | undefined, binding = 0): FakeBuffer {
  const entry = group?.entries.find((candidate) => candidate.binding === binding);
  return (entry?.resource as { buffer: FakeBuffer }).buffer;
}

const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128 });
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SplatVisibilityPass frame scoping', () => {
  it('culls two splat layers in one encoder with their own uniforms and keeps grown buffers alive until the next frame', () => {
    const gpu = fakeGpu();
    const pass = new SplatVisibilityPass();
    pass.initialize(gpu.device);
    pass.beginFrame();

    const layerA = pass.execute(gpu.device, gpu.encoder, {} as GPUBuffer, 2000, identity(), identity(), identity());
    const layerB = pass.execute(gpu.device, gpu.encoder, {} as GPUBuffer, 5000, identity(), identity(), identity());

    const uniformA = boundBuffer(gpu.computeBindings[0].get(1));
    const uniformB = boundBuffer(gpu.computeBindings[1].get(1));
    expect(uniformA).not.toBe(uniformB);
    expect(new Uint32Array(uniformA.bytes!.buffer)[32]).toBe(2000);
    expect(new Uint32Array(uniformB.bytes!.buffer)[32]).toBe(5000);

    // Layer B needed a larger index buffer; layer A's buffer is still referenced by the encoder.
    const indicesA = layerA!.visibleIndexBuffer as unknown as FakeBuffer;
    const indicesB = layerB!.visibleIndexBuffer as unknown as FakeBuffer;
    expect(indicesB).not.toBe(indicesA);
    expect(indicesA.destroy).not.toHaveBeenCalled();
    expect(layerB!.counterBuffer).toBe(layerA!.counterBuffer);

    pass.beginFrame();
    expect(indicesA.destroy).toHaveBeenCalledTimes(1);
    expect(indicesB.destroy).not.toHaveBeenCalled();

    pass.execute(gpu.device, gpu.encoder, {} as GPUBuffer, 2000, identity(), identity(), identity());
    expect(boundBuffer(gpu.computeBindings[2].get(1))).toBe(uniformA);
    pass.dispose();
  });
});

describe('SplatSortPass frame scoping', () => {
  it('grows sort buffers mid-frame without destroying the buffers earlier layers were sorted into', () => {
    const gpu = fakeGpu();
    const sort = new SplatSortPass();
    sort.initialize(gpu.device, 8);
    sort.beginFrame();

    const sortedA = sort.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 600, identity(), identity()) as unknown as FakeBuffer;
    const sortedB = sort.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 3000, identity(), identity()) as unknown as FakeBuffer;

    expect(sortedB).not.toBe(sortedA);
    expect(sortedA.destroy).not.toHaveBeenCalled();

    // A scene upload between layers grows capacity in place instead of disposing the pass.
    const uniformBuffers = gpu.buffers.filter((buffer) => buffer.label?.startsWith('sort-uniforms-'));
    sort.initialize(gpu.device, 100_000);
    expect(uniformBuffers.every((buffer) => buffer.destroy.mock.calls.length === 0)).toBe(true);
    expect(sortedB.destroy).not.toHaveBeenCalled();

    sort.beginFrame();
    expect(sortedA.destroy).toHaveBeenCalledTimes(1);
    expect(sortedB.destroy).toHaveBeenCalledTimes(1);
    sort.dispose();
  });
});

describe('ParticleCompute frame scoping', () => {
  const settings = (intensity: number): GaussianSplatParticleSettings => ({
    enabled: true, effectType: 'explode', intensity, speed: 1, seed: 7,
  });

  it('dispatches two particle layers in one encoder with their own settings', () => {
    const gpu = fakeGpu();
    const particles = new ParticleCompute();
    particles.initialize(gpu.device);

    particles.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 100, 0.5, settings(0.25));
    particles.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 100, 0.5, settings(0.75));

    const first = boundBuffer(gpu.computeBindings[0].get(1));
    const second = boundBuffer(gpu.computeBindings[1].get(1));
    expect(first).not.toBe(second);
    expect(new Float32Array(first.bytes!.buffer)[1]).toBeCloseTo(0.25);
    expect(new Float32Array(second.bytes!.buffer)[1]).toBeCloseTo(0.75);

    particles.beginFrame();
    particles.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 100, 0.5, settings(0.5));
    expect(boundBuffer(gpu.computeBindings[2].get(1))).toBe(first);
    particles.dispose();
  });
});

describe('EffectorCompute frame scoping', () => {
  const effector = (radius: number): LocalSplatEffectorData => ({
    position: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, radius, strength: 1,
    falloff: 1, speed: 1, seed: 0, time: 0, mode: 0,
  });

  it('dispatches two effector layers in one encoder with their own local-space settings', () => {
    const gpu = fakeGpu();
    const effectors = new EffectorCompute();
    effectors.initialize(gpu.device);

    effectors.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 10, [effector(2)]);
    effectors.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 10, [effector(9)]);

    const first = boundBuffer(gpu.computeBindings[0].get(1));
    const second = boundBuffer(gpu.computeBindings[1].get(1));
    expect(first).not.toBe(second);
    expect(new Float32Array(first.bytes!.buffer)[3]).toBe(2);
    expect(new Float32Array(second.bytes!.buffer)[3]).toBe(9);

    effectors.beginFrame();
    effectors.execute(gpu.device, gpu.encoder, {} as GPUBuffer, {} as GPUBuffer, 10, [effector(4)]);
    expect(boundBuffer(gpu.computeBindings[2].get(1))).toBe(first);
    effectors.dispose();
  });
});

describe('SlicePipeline per-target vertex buffers', () => {
  function readySlicePipeline(device: GPUDevice) {
    const pipeline = new SlicePipeline(device);
    Object.assign(pipeline as unknown as Record<string, unknown>, { pipeline: {}, bindGroupLayout: {} });
    return pipeline;
  }
  const context = { getCurrentTexture: () => ({ createView: () => ({}) }) } as unknown as GPUCanvasContext;
  const slice = (): OutputSlice => createDefaultSlice('Slice');
  const mask = (): OutputSlice => createDefaultMask('Mask');

  it('draws each output target from its own buffer and vertex count within one encoder', () => {
    const gpu = fakeGpu();
    const pipeline = readySlicePipeline(gpu.device);

    pipeline.buildVertexBuffer([slice()], 'target-a');
    pipeline.renderSlicedOutput(gpu.encoder, context, {} as GPUTextureView, {} as GPUSampler, 'target-a');
    pipeline.buildVertexBuffer([mask()], 'target-b');
    pipeline.renderSlicedOutput(gpu.encoder, context, {} as GPUTextureView, {} as GPUSampler, 'target-b');

    const [passA, passB] = gpu.renderPasses;
    expect(passA.vertexBuffer).not.toBe(passB.vertexBuffer);
    expect(passA.draws).toEqual([[1536]]);
    expect(passB.draws).toEqual([[6]]);
    expect((passA.vertexBuffer as FakeBuffer).bytes!.byteLength).toBe(1536 * 20);
  });

  it('retires a grown target buffer until the next render section instead of destroying it mid-frame', async () => {
    const gpu = fakeGpu();
    const pipeline = readySlicePipeline(gpu.device);

    pipeline.buildVertexBuffer([mask()], 'target-a');
    const small = (pipeline as unknown as { vertexBuffers: { get(key: string): FakeBuffer } }).vertexBuffers.get('target-a');
    pipeline.buildVertexBuffer([slice(), slice()], 'target-a');
    expect(small.destroy).not.toHaveBeenCalled();

    await Promise.resolve();
    pipeline.buildVertexBuffer([mask()], 'target-b');
    expect(small.destroy).toHaveBeenCalledTimes(1);

    pipeline.releaseTarget('target-b');
    pipeline.renderSlicedOutput(gpu.encoder, context, {} as GPUTextureView, {} as GPUSampler, 'target-b');
    expect(gpu.renderPasses).toHaveLength(0);
    pipeline.destroy();
  });
});

describe('RenderOutputRouterAdapter sliced targets', () => {
  it('builds and draws slices per target id so targets in one encoder do not share vertices', () => {
    const sliceConfigs = {
      'target-a': { targetId: 'target-a', slices: [createDefaultSlice('A')], selectedSliceId: null },
      'target-b': { targetId: 'target-b', slices: [createDefaultMask('B')], selectedSliceId: null },
    };
    const target = (id: string) => ({ id, name: id, source: { type: 'activeComp' }, destinationType: 'canvas',
      enabled: true, showTransparencyGrid: false, isFullscreen: false });
    const snapshot = {
      resolution: { width: 1280, height: 720 }, targets: [target('target-a'), target('target-b')],
      activeCompositionTargetIds: ['target-a', 'target-b'], independentTargetIds: [], sliceConfigs,
      outputPreview: { activeTab: 'output', previewingTargetId: null },
    } as unknown as RenderTargetSnapshot;
    const slicePipeline = { buildVertexBuffer: vi.fn(), renderSlicedOutput: vi.fn() };
    const context = {} as GPUCanvasContext;
    const adapter = new RenderOutputRouterAdapter({
      canvasTargets: { registerTargetCanvas: vi.fn(), unregisterTargetCanvas: vi.fn(), getTargetContext: vi.fn(() => context) },
      getPreviewContext: () => null,
      getOutputPipeline: () => ({ updateResolution: vi.fn(), createOutputBindGroup: vi.fn(), renderToCanvas: vi.fn() }) as never,
      getSlicePipeline: () => slicePipeline as never,
      getResolution: () => null,
      shouldSkipPreviewOutput: () => false,
      getExportCanvasContext: () => null,
      isExporting: () => false,
    });
    const commandEncoder = {} as GPUCommandEncoder;

    adapter.routeCompositeFrame({ commandEncoder, sourceView: {} as GPUTextureView, sampler: {} as GPUSampler, snapshot });

    expect(slicePipeline.buildVertexBuffer.mock.calls.map((call) => call[1])).toEqual(['target-a', 'target-b']);
    expect(slicePipeline.renderSlicedOutput.mock.calls.map((call) => call[4])).toEqual(['target-a', 'target-b']);
  });
});

describe('PixelParticleDisintegrateRenderer frame scoping', () => {
  it('renders two particle layers in one synchronous section with their own uniforms', async () => {
    const gpu = fakeGpu();
    const renderer = new PixelParticleDisintegrateRenderer(gpu.device);
    const render = (progress: number) => renderer.render({
      commandEncoder: gpu.encoder, sampler: {} as GPUSampler, sourceView: {} as GPUTextureView,
      accumulationView: {} as GPUTextureView, outputView: {} as GPUTextureView, outputWidth: 64, outputHeight: 36,
      effect: { id: `fx-${progress}`, type: 'pixel-particle-disintegrate', name: 'Particles', enabled: true,
        params: { progress } } as unknown as Effect,
      motionTime: 0, quality: 'preview',
    });

    render(0.2);
    render(0.8);
    const uniforms = gpu.renderPasses.map((pass) => boundBuffer(pass.bindings.get(0), 2));
    const distinct = [...new Set(uniforms)];
    expect(distinct).toHaveLength(2);
    expect(distinct[0].bytes).not.toEqual(distinct[1].bytes);

    await Promise.resolve();
    render(0.5);
    expect(boundBuffer(gpu.renderPasses.at(-1)!.bindings.get(0), 2)).toBe(distinct[0]);
    renderer.destroy();
  });
});
