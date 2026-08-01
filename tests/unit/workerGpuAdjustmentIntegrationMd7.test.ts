import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerRenderData } from '../../src/engine/core/types';
import type { Layer } from '../../src/types/layers';
import { buildWorkerGpuAdjustmentExecutionPlan } from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import {
  encodeWorkerGpuAdjustmentPlan,
  type WorkerGpuAdjustmentExecutorResources,
} from '../../src/services/render/workerGpuAdjustmentPlanExecutor';
import {
  encodeWorkerGpuAdjustmentMasks,
  packWorkerGpuAdjustmentMasks,
  workerGpuAdjustmentMaskLookupId,
} from '../../src/services/render/workerGpuAdjustmentMaskRenderer';

function videoLayer(
  id = 'video-runtime-layer',
  sourceClipId = 'video-clip',
): Layer {
  return {
    id,
    sourceClipId,
    name: 'Video',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: { type: 'video', mediaTime: 2 },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function adjustmentLayer(withMask = false): Layer {
  return {
    id: 'adjustment-runtime-layer',
    sourceClipId: 'adjustment-clip',
    name: 'Adjustment',
    visible: true,
    opacity: 0.6,
    blendMode: 'overlay',
    source: { type: 'motion-adjustment' },
    effects: [
      {
        id: 'contrast-1',
        name: 'Contrast',
        type: 'contrast',
        enabled: true,
        params: { amount: 1.2 },
      },
      {
        id: 'blur-1',
        name: 'Gaussian Blur',
        type: 'gaussian-blur',
        enabled: true,
        params: { radius: 8, samples: 5 },
      },
    ],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    ...(withMask ? {
      masks: [{
        id: 'mask-1',
        name: 'Mask 1',
        vertices: [
          { id: 'a', x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'b', x: 1, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
          { id: 'c', x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        ],
        closed: true,
        opacity: 1,
        feather: 0,
        featherQuality: 0,
        inverted: false,
        mode: 'add' as const,
        expanded: true,
        position: { x: 0, y: 0 },
        enabled: true,
        visible: true,
      }],
    } : {}),
  };
}

function plan(withMask = false) {
  return buildWorkerGpuAdjustmentExecutionPlan({
    layers: [adjustmentLayer(withMask), videoLayer()],
    videoSources: [{ layerId: 'video-runtime-layer', sourceId: 'gpu-video:video-clip' }],
    frameContext: { compositionId: 'comp-1', timelineTimeSeconds: 2 },
    requestId: 'request-1',
    targetId: 'preview',
    frameIndex: 12,
    intent: 'preview',
    nowMs: 100,
    resourceNamespace: 'comp-1:preview',
  });
}

function twoSourcePlan() {
  return buildWorkerGpuAdjustmentExecutionPlan({
    layers: [
      adjustmentLayer(),
      videoLayer('upper-runtime-layer', 'upper-clip'),
      videoLayer('lower-runtime-layer', 'lower-clip'),
    ],
    videoSources: [
      { layerId: 'upper-runtime-layer', sourceId: 'gpu-video:upper-clip' },
      { layerId: 'lower-runtime-layer', sourceId: 'gpu-video:lower-clip' },
    ],
    frameContext: { compositionId: 'comp-1', timelineTimeSeconds: 2 },
    requestId: 'request-1',
    targetId: 'preview',
    frameIndex: 12,
    intent: 'preview',
    nowMs: 100,
    resourceNamespace: 'comp-1:preview',
  });
}

function sourceFrame(layerId: string): LayerRenderData {
  return {
    layer: videoLayer(`${layerId}-runtime`, layerId),
    isVideo: true,
    externalTexture: null,
    textureView: null,
    sourceWidth: 1920,
    sourceHeight: 1080,
  } as LayerRenderData;
}

function executorHarness(events: string[] = []) {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
  vi.stubGlobal('GPUTextureUsage', {
    RENDER_ATTACHMENT: 8,
    TEXTURE_BINDING: 16,
    COPY_SRC: 32,
    COPY_DST: 64,
  });
  const destroyed: string[] = [];
  const device = {
    queue: { writeBuffer: vi.fn() },
    createShaderModule: vi.fn(() => ({ kind: 'shader-module' })),
    createBindGroupLayout: vi.fn(() => ({ kind: 'bind-group-layout' })),
    createPipelineLayout: vi.fn(() => ({ kind: 'pipeline-layout' })),
    createRenderPipeline: vi.fn((descriptor: { readonly label?: string }) => ({
      label: descriptor.label ?? 'effect',
    })),
    createBuffer: vi.fn(() => ({ destroy: () => destroyed.push('buffer') })),
    createTexture: vi.fn((descriptor: { readonly label?: string }) => {
      const label = descriptor.label ?? 'texture';
      events.push(`allocate:${label}`);
      const view = { label: `${label}:view` };
      return {
        createView: vi.fn(() => view),
        destroy: () => destroyed.push(label),
      };
    }),
    createBindGroup: vi.fn(() => ({ kind: 'bind-group' })),
  } as unknown as GPUDevice;
  const commandEncoder = {
    beginRenderPass: vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    })),
  } as unknown as GPUCommandEncoder;
  const compositor = {
    composite: vi.fn((data: readonly LayerRenderData[]) => {
      events.push(`pre-render:${data[0]?.layer.sourceClipId ?? 'missing'}`);
      return {
        finalView: { label: `pre-rendered:${data[0]?.layer.sourceClipId ?? 'missing'}` },
        usedPing: true,
        layerCount: data.length,
      };
    }),
  };
  const compositorPipeline = {
    beginFrame: vi.fn(() => events.push('begin-frame')),
    getOrCreateUniformBuffer: vi.fn(() => ({ label: 'uniform' })),
    updateLayerUniforms: vi.fn(),
    getCompositePipeline: vi.fn(() => ({ label: 'composite' })),
    invalidateBindGroupCache: vi.fn(),
    createCompositeBindGroup: vi.fn(() => ({ label: 'composite-bind-group' })),
  };
  const resources = {
    compositor,
    compositorPipeline,
    maskTextureManager: {
      getMaskInfo: vi.fn(() => ({ hasMask: false, view: { label: 'white-mask' } })),
    },
    sampler: { label: 'sampler' },
  } as unknown as WorkerGpuAdjustmentExecutorResources;
  return { commandEncoder, compositor, compositorPipeline, destroyed, device, resources };
}

describe('MD7 strict worker GPU adjustment integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adapts top-to-bottom runtime layers into one exact frozen worker plan', () => {
    const result = plan();
    expect(result).not.toBeNull();
    expect(result?.frame).toMatchObject({
      compositionId: 'comp-1',
      timelineTime: 2,
      frameIndex: 12,
      exact: true,
    });
    expect(result?.passes.map((pass) => pass.kind)).toEqual([
      'initialize-accumulator',
      'resolve-source',
      'composite-source',
      'snapshot-accumulator',
      'apply-adjustment-effect',
      'apply-adjustment-effect',
      'apply-adjustment-effect',
      'mix-adjustment-result',
    ]);
  });

  it('executes the exact frozen pass order without reconstructing a second effect model', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 8,
      TEXTURE_BINDING: 16,
      COPY_SRC: 32,
      COPY_DST: 64,
    });
    const result = plan();
    if (!result) throw new Error('Expected adjustment plan');
    const sourceLayer = videoLayer();
    const sourceData = {
      layer: sourceLayer,
      isVideo: true,
      externalTexture: null,
      textureView: null,
      sourceWidth: 1920,
      sourceHeight: 1080,
    } as LayerRenderData;
    const pipelineLabels: string[] = [];
    const destroyed: string[] = [];
    let textureSequence = 0;
    const device = {
      queue: { writeBuffer: vi.fn() },
      createShaderModule: vi.fn(() => ({ kind: 'shader-module' })),
      createBindGroupLayout: vi.fn(() => ({ kind: 'bind-group-layout' })),
      createPipelineLayout: vi.fn(() => ({ kind: 'pipeline-layout' })),
      createRenderPipeline: vi.fn((descriptor: { readonly label?: string }) => ({
        label: descriptor.label ?? 'effect',
      })),
      createBuffer: vi.fn(() => ({ destroy: () => destroyed.push('buffer') })),
      createTexture: vi.fn((descriptor: { readonly label?: string }) => {
        const label = descriptor.label ?? `texture-${textureSequence++}`;
        const view = { label: `${label}:view` };
        return {
          createView: vi.fn(() => view),
          destroy: () => destroyed.push(label),
        };
      }),
      createBindGroup: vi.fn(() => ({ kind: 'bind-group' })),
    } as unknown as GPUDevice;
    const commandEncoder = {
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn((pipeline: { readonly label?: string }) => {
          pipelineLabels.push(pipeline.label ?? 'unknown');
        }),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      })),
    } as unknown as GPUCommandEncoder;
    const compositor = {
      composite: vi.fn(() => ({
        finalView: { label: 'pre-rendered-source' },
        usedPing: true,
        layerCount: 1,
      })),
    };
    const compositorPipeline = {
      beginFrame: vi.fn(),
      getOrCreateUniformBuffer: vi.fn(() => ({ label: 'uniform' })),
      updateLayerUniforms: vi.fn(),
      getCompositePipeline: vi.fn(() => ({ label: 'composite' })),
      invalidateBindGroupCache: vi.fn(),
      createCompositeBindGroup: vi.fn(() => ({ label: 'composite-bind-group' })),
    };
    const resources = {
      compositor,
      compositorPipeline,
      maskTextureManager: {
        getMaskInfo: vi.fn(() => ({ hasMask: false, view: { label: 'white-mask' } })),
      },
      sampler: { label: 'sampler' },
    } as unknown as WorkerGpuAdjustmentExecutorResources;

    const executed = encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device,
      commandEncoder,
      resources,
      sources: [{
        layerId: 'video-clip',
        sourceId: 'gpu-video:video-clip',
        data: sourceData,
      }],
      width: 1920,
      height: 1080,
    });

    expect(executed.executedPassIds).toEqual(result.passes.map((pass) => pass.passId));
    expect(pipelineLabels).toEqual([
      'composite',
      'worker-gpu-adjustment-color-matrix-pipeline',
      'worker-gpu-adjustment-separable-blur-pipeline',
      'worker-gpu-adjustment-separable-blur-pipeline',
      'composite',
    ]);
    expect(compositor.composite).toHaveBeenCalledOnce();
    expect(compositorPipeline.beginFrame).toHaveBeenCalledOnce();

    executed.transientResources.forEach((resource) => resource.destroy());
    expect(destroyed.length).toBe(executed.transientResources.length);
  });

  it('fails closed on a stale source binding and destroys resources allocated before rejection', () => {
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 8,
      TEXTURE_BINDING: 16,
      COPY_SRC: 32,
      COPY_DST: 64,
    });
    const result = plan();
    if (!result) throw new Error('Expected adjustment plan');
    const destroy = vi.fn();
    const device = {
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({ label: 'accumulator-view' })),
        destroy,
      })),
    } as unknown as GPUDevice;
    const commandEncoder = {
      beginRenderPass: vi.fn(() => ({ end: vi.fn() })),
    } as unknown as GPUCommandEncoder;
    const compositor = { composite: vi.fn() };
    const resources = {
      compositorPipeline: { beginFrame: vi.fn() },
      compositor,
    } as unknown as WorkerGpuAdjustmentExecutorResources;

    expect(() => encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device,
      commandEncoder,
      resources,
      sources: [{
        layerId: 'video-clip',
        sourceId: 'gpu-video:stale-source',
        data: {
          layer: videoLayer(),
          isVideo: true,
          externalTexture: null,
          textureView: null,
          sourceWidth: 1920,
          sourceHeight: 1080,
        } as LayerRenderData,
      }],
      width: 1920,
      height: 1080,
    })).toThrow('Worker GPU adjustment source binding mismatch: video-clip');
    expect(destroy).toHaveBeenCalledOnce();
    expect(compositor.composite).not.toHaveBeenCalled();
  });

  it('resolves lazy sources only at their exact resolve passes and in frozen plan order', () => {
    const result = twoSourcePlan();
    if (!result) throw new Error('Expected two-source adjustment plan');
    const events: string[] = [];
    const harness = executorHarness(events);
    let extraResolverBranchUsed = false;
    const resolveSource = vi.fn((request: {
      readonly passId: string;
      readonly layerId: string;
      readonly sourceId: string;
      readonly sourceKind: string;
    }) => {
      events.push(`resolve:${request.layerId}`);
      if (request.layerId === 'unplanned-extra-clip') extraResolverBranchUsed = true;
      return {
        layerId: request.layerId,
        sourceId: request.sourceId,
        data: sourceFrame(request.layerId),
      };
    });
    const resolvePasses = result.passes.filter((pass) => pass.kind === 'resolve-source');

    const executed = encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device: harness.device,
      commandEncoder: harness.commandEncoder,
      resources: harness.resources,
      resolveSource,
      width: 1920,
      height: 1080,
    });

    expect(resolveSource.mock.calls.map(([request]) => request)).toEqual(
      resolvePasses.map((pass) => ({
        passId: pass.passId,
        layerId: pass.layerId,
        sourceId: pass.sourceId,
        sourceKind: pass.sourceKind,
      })),
    );
    expect(events.slice(0, 3)).toEqual([
      'begin-frame',
      `allocate:${result.passes[0]?.outputResourceId}`,
      `resolve:${resolvePasses[0]?.layerId}`,
    ]);
    expect(events.filter((event) => event.startsWith('resolve:'))).toEqual(
      resolvePasses.map((pass) => `resolve:${pass.layerId}`),
    );
    expect(extraResolverBranchUsed).toBe(false);
    expect(executed.executedPassIds).toEqual(result.passes.map((pass) => pass.passId));
  });

  it('stops later passes and destroys earlier allocations when lazy resolution fails', () => {
    const result = twoSourcePlan();
    if (!result) throw new Error('Expected two-source adjustment plan');
    const events: string[] = [];
    const harness = executorHarness(events);
    const resolvePasses = result.passes.filter((pass) => pass.kind === 'resolve-source');
    const resolveSource = vi.fn((request: { readonly layerId: string; readonly sourceId: string }) => {
      if (request.layerId === resolvePasses[1]?.layerId) {
        throw new Error('lazy source unavailable');
      }
      return {
        layerId: request.layerId,
        sourceId: request.sourceId,
        data: sourceFrame(request.layerId),
      };
    });

    expect(() => encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device: harness.device,
      commandEncoder: harness.commandEncoder,
      resources: harness.resources,
      resolveSource,
      width: 1920,
      height: 1080,
    })).toThrow('lazy source unavailable');

    expect(resolveSource.mock.calls.map(([request]) => request.layerId)).toEqual(
      resolvePasses.map((pass) => pass.layerId),
    );
    expect(harness.compositor.composite).toHaveBeenCalledOnce();
    expect(harness.compositorPipeline.getCompositePipeline).toHaveBeenCalledOnce();
    expect(harness.device.createRenderPipeline).not.toHaveBeenCalled();
    expect(harness.destroyed).toHaveLength(harness.device.createTexture.mock.calls.length);
  });

  it('fails closed for missing, mismatched, duplicate, and unconsumed source bindings', () => {
    const result = plan();
    if (!result) throw new Error('Expected adjustment plan');
    const expectedSource = {
      layerId: 'video-clip',
      sourceId: 'gpu-video:video-clip',
      data: sourceFrame('video-clip'),
    };

    const duplicateHarness = executorHarness();
    expect(() => encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device: duplicateHarness.device,
      commandEncoder: duplicateHarness.commandEncoder,
      resources: duplicateHarness.resources,
      sources: [expectedSource, expectedSource],
      width: 1920,
      height: 1080,
    })).toThrow('Worker GPU adjustment duplicate source binding: video-clip');
    expect(duplicateHarness.compositorPipeline.beginFrame).not.toHaveBeenCalled();

    const extraHarness = executorHarness();
    expect(() => encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device: extraHarness.device,
      commandEncoder: extraHarness.commandEncoder,
      resources: extraHarness.resources,
      sources: [{ ...expectedSource, layerId: 'unplanned-extra-clip' }],
      width: 1920,
      height: 1080,
    })).toThrow('Worker GPU adjustment source is not consumed by plan: unplanned-extra-clip');
    expect(extraHarness.compositorPipeline.beginFrame).not.toHaveBeenCalled();

    const missingHarness = executorHarness();
    expect(() => encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device: missingHarness.device,
      commandEncoder: missingHarness.commandEncoder,
      resources: missingHarness.resources,
      resolveSource: () => undefined,
      width: 1920,
      height: 1080,
    })).toThrow('Worker GPU adjustment source binding mismatch: video-clip');
    expect(missingHarness.destroyed).toHaveLength(1);

    const mismatchedHarness = executorHarness();
    expect(() => encodeWorkerGpuAdjustmentPlan({
      plan: result,
      device: mismatchedHarness.device,
      commandEncoder: mismatchedHarness.commandEncoder,
      resources: mismatchedHarness.resources,
      resolveSource: (request) => ({
        layerId: 'wrong-layer',
        sourceId: request.sourceId,
        data: sourceFrame('wrong-layer'),
      }),
      width: 1920,
      height: 1080,
    })).toThrow('Worker GPU adjustment source binding mismatch: video-clip');
    expect(mismatchedHarness.destroyed).toHaveLength(1);
  });

  it('preserves vector masks for the dedicated GPU mask pass', () => {
    const result = plan(true);
    if (!result) throw new Error('Expected masked adjustment plan');
    expect(workerGpuAdjustmentMaskLookupId(result, 'adjustment-clip')).toBe(
      JSON.stringify(['comp-1:preview', 'worker-gpu-mask', 'adjustment-clip']),
    );
    const mixPass = result.passes.find((pass) => (
      pass.kind === 'mix-adjustment-result' && pass.layerId === 'adjustment-clip'
    ));
    if (!mixPass || mixPass.kind !== 'mix-adjustment-result') {
      throw new Error('Expected masked mix pass');
    }
    const packed = packWorkerGpuAdjustmentMasks(mixPass.mix);
    const metadata = new DataView(packed.metadata);
    expect(metadata.getUint32(0, true)).toBe(0);
    expect(metadata.getUint32(4, true)).toBe(3);
    expect(metadata.getUint32(8, true)).toBe(0);
    expect(metadata.getUint32(12, true)).toBe(0);
    expect(metadata.getFloat32(16, true)).toBe(1);
    expect(packed.points).toEqual(new Float32Array([0, 0, 1, 0, 1, 1]));
  });

  it('encodes the admitted mask as a GPU pass before compositor sampling', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 8, TEXTURE_BINDING: 16 });
    const result = plan(true);
    if (!result) throw new Error('Expected masked adjustment plan');

    const destroyed: string[] = [];
    const writes: Array<{ readonly offset: number; readonly size: number }> = [];
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    let bufferSequence = 0;
    const device = {
      queue: {
        writeBuffer: vi.fn((_: unknown, offset: number, data: ArrayBuffer, dataOffset = 0, size?: number) => {
          writes.push({ offset, size: size ?? data.byteLength - dataOffset });
        }),
      },
      createShaderModule: vi.fn(() => ({ kind: 'shader-module' })),
      createBindGroupLayout: vi.fn(() => ({ kind: 'bind-group-layout' })),
      createPipelineLayout: vi.fn(() => ({ kind: 'pipeline-layout' })),
      createRenderPipeline: vi.fn(() => ({ kind: 'render-pipeline' })),
      createBuffer: vi.fn(() => {
        const label = `buffer-${bufferSequence++}`;
        return { destroy: () => destroyed.push(label) };
      }),
      createTexture: vi.fn(() => ({
        createView: vi.fn(() => ({ kind: 'mask-view' })),
        destroy: () => destroyed.push('texture'),
      })),
      createBindGroup: vi.fn(() => ({ kind: 'bind-group' })),
    } as unknown as GPUDevice;
    const encoder = {
      beginRenderPass: vi.fn(() => pass),
    } as unknown as GPUCommandEncoder;

    const encoded = encodeWorkerGpuAdjustmentMasks(result, device, encoder, 1920, 1080);

    expect(encoded.bindings).toEqual([expect.objectContaining({
      layerId: 'adjustment-clip',
      maskLookupId: workerGpuAdjustmentMaskLookupId(result, 'adjustment-clip'),
    })]);
    expect(encoded.transientResources).toHaveLength(4);
    expect(writes).toEqual([
      { offset: 0, size: 32 },
      { offset: 0, size: 24 },
      { offset: 0, size: 16 },
    ]);
    expect(pass.setPipeline).toHaveBeenCalledOnce();
    expect(pass.setBindGroup).toHaveBeenCalledWith(0, expect.anything());
    expect(pass.draw).toHaveBeenCalledWith(6);
    expect(pass.end).toHaveBeenCalledOnce();

    encoded.transientResources.forEach((resource) => resource.destroy());
    expect(destroyed).toEqual(['buffer-0', 'buffer-1', 'buffer-2', 'texture']);
  });

  it('destroys already allocated mask buffers when a later GPU allocation fails', () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 8, TEXTURE_BINDING: 16 });
    const result = plan(true);
    if (!result) throw new Error('Expected masked adjustment plan');

    const destroyed: string[] = [];
    let bufferSequence = 0;
    const device = {
      createShaderModule: vi.fn(() => ({ kind: 'shader-module' })),
      createBindGroupLayout: vi.fn(() => ({ kind: 'bind-group-layout' })),
      createPipelineLayout: vi.fn(() => ({ kind: 'pipeline-layout' })),
      createRenderPipeline: vi.fn(() => ({ kind: 'render-pipeline' })),
      createBuffer: vi.fn(() => {
        const label = `buffer-${bufferSequence++}`;
        return { destroy: () => destroyed.push(label) };
      }),
      createTexture: vi.fn(() => {
        throw new Error('GPU texture allocation failed');
      }),
    } as unknown as GPUDevice;

    expect(() => encodeWorkerGpuAdjustmentMasks(
      result,
      device,
      {} as GPUCommandEncoder,
      1920,
      1080,
    )).toThrow('GPU texture allocation failed');
    expect(destroyed).toEqual(['buffer-2', 'buffer-1', 'buffer-0']);
  });
});
