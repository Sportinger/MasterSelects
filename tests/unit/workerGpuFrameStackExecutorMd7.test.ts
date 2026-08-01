import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerRenderData } from '../../src/engine/core/types';
import type { Layer, LayerSource } from '../../src/types/layers';
import {
  buildWorkerGpuAdjustmentExecutionPlan,
  type WorkerGpuAdjustmentSourceBinding,
} from '../../src/services/render/workerGpuAdjustmentPlanAdapter';
import type { MotionAdjustmentWorkerGpuExecutionPlan } from '../../src/services/motionDesign/adjustment/workerGpuAdjustmentPlan';
import type { WorkerGpuWebCodecsRenderLayer } from '../../src/services/render/workerGpuRuntimeCommands';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  createWorkerGpuNestedOccurrenceNamespace,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackIdentity,
  type WorkerGpuFrameStackSourceBinding,
} from '../../src/services/render/workerGpuFrameStackContract';
import type {
  WorkerGpuAdjustmentExecutorResources,
  WorkerGpuAdjustmentSourceResolveRequest,
} from '../../src/services/render/workerGpuAdjustmentPlanExecutor';
import {
  WorkerGpuFrameStackExecutorError,
  encodeWorkerGpuFrameStack,
  type WorkerGpuFrameStackAdjustmentEncoder,
} from '../../src/services/render/workerGpuFrameStackExecutor';

const REQUEST_ID = 'request:executor';
const TARGET_ID = 'preview';
const FRAME_INDEX = 7;
const SUBMIT_BY_MS = 1_000;
const EXPIRE_AFTER_MS = 2_000;

class FakeImageBitmap {
  readonly width: number;
  readonly height: number;
  closeCount = 0;

  constructor(width = 64, height = 36) {
    this.width = width;
    this.height = height;
  }

  close(): void {
    this.closeCount += 1;
  }
}

class FakeTexture {
  readonly view: GPUTextureView;
  destroyCount = 0;

  constructor(
    readonly label: string,
    private readonly events: string[],
  ) {
    this.view = { label: `${label}:view` } as unknown as GPUTextureView;
  }

  createView(): GPUTextureView {
    this.events.push(`view:${this.label}`);
    return this.view;
  }

  destroy(): void {
    this.destroyCount += 1;
    this.events.push(`destroy:${this.label}`);
  }
}

class FakeCommandEncoder {
  finishCount = 0;

  constructor(
    private readonly events: string[],
    private readonly finishThrows: boolean,
  ) {}

  finish(): GPUCommandBuffer {
    this.finishCount += 1;
    this.events.push('finish');
    if (this.finishThrows) throw new Error('finish failed');
    return { fake: 'command-buffer' } as unknown as GPUCommandBuffer;
  }
}

interface FakeGpuOptions {
  readonly fenceThrows?: boolean;
  readonly submitThrows?: boolean;
  readonly finishThrows?: boolean;
}

interface FakeGpu {
  readonly device: GPUDevice;
  readonly events: string[];
  readonly textures: FakeTexture[];
  readonly encoders: FakeCommandEncoder[];
  readonly fenceCount: () => number;
}

function fakeGpu(options: FakeGpuOptions = {}): FakeGpu {
  const events: string[] = [];
  const textures: FakeTexture[] = [];
  const encoders: FakeCommandEncoder[] = [];
  let fenceCount = 0;
  const queue = {
    copyExternalImageToTexture(): void {
      events.push('copy');
    },
    writeTexture(): void {
      events.push('write');
    },
    submit(): void {
      events.push('submit');
      if (options.submitThrows) throw new Error('submit failed');
    },
    async onSubmittedWorkDone(): Promise<void> {
      fenceCount += 1;
      events.push('fence');
      if (options.fenceThrows) throw new Error('fence failed');
    },
  };
  const device = {
    queue,
    createCommandEncoder(): GPUCommandEncoder {
      events.push('create-encoder');
      const encoder = new FakeCommandEncoder(events, options.finishThrows ?? false);
      encoders.push(encoder);
      return encoder as unknown as GPUCommandEncoder;
    },
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
      const texture = new FakeTexture(String(descriptor.label), events);
      events.push(`create:${texture.label}`);
      textures.push(texture);
      return texture as unknown as GPUTexture;
    },
  } as unknown as GPUDevice;
  return {
    device,
    events,
    textures,
    encoders,
    fenceCount: () => fenceCount,
  };
}

interface CompositeCall {
  readonly layers: readonly LayerRenderData[];
  readonly namespace: string | undefined;
  readonly pingView: GPUTextureView;
}

function fakeResources(input: {
  readonly compositeCalls?: CompositeCall[];
  readonly compositeThrows?: boolean;
} = {}): WorkerGpuAdjustmentExecutorResources {
  const calls = input.compositeCalls ?? [];
  return {
    compositorPipeline: {
      beginFrame: vi.fn(),
    },
    compositor: {
      composite: (
        layers: LayerRenderData[],
        _commandEncoder: GPUCommandEncoder,
        state: { readonly resourceNamespace?: string; readonly pingView: GPUTextureView },
      ) => {
        calls.push({
          layers: [...layers],
          namespace: state.resourceNamespace,
          pingView: state.pingView,
        });
        if (input.compositeThrows) throw new Error('compositor failed');
        return { finalView: state.pingView, usedPing: true, layerCount: layers.length };
      },
    },
    maskTextureManager: {},
    sampler: { fake: 'sampler' },
  } as unknown as WorkerGpuAdjustmentExecutorResources;
}

function frame(
  compositionId: string,
  timelineTime = 2,
): WorkerGpuFrameStackIdentity {
  return {
    requestId: REQUEST_ID,
    targetId: TARGET_ID,
    compositionId,
    timelineTime,
    frameIndex: FRAME_INDEX,
    intent: 'preview',
    submitByMs: SUBMIT_BY_MS,
    expireAfterMs: EXPIRE_AFTER_MS,
    graphVersion: FRAME_INDEX,
    exact: true,
  };
}

function admission(nowMs = 1_500): WorkerGpuFrameStackAdmission {
  return {
    nowMs,
    requestId: REQUEST_ID,
    targetId: TARGET_ID,
    intent: 'preview',
    graphVersion: FRAME_INDEX,
  };
}

function renderLayer(layerId: string): WorkerGpuWebCodecsRenderLayer {
  return {
    id: `runtime:${layerId}`,
    name: layerId,
    sourceClipId: layerId,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    effects: [],
  };
}

function solidBinding(layerId: string): WorkerGpuFrameStackSourceBinding {
  return {
    layerId,
    runtimeSourceKind: 'solid',
    sourceKind: 'timeline-media',
    sourceId: `timeline:${layerId}`,
    renderLayer: renderLayer(layerId),
    payload: { kind: 'solid', color: '#12345678', width: 64, height: 36 },
  };
}

function bitmapBinding(
  layerId: string,
  bitmap: FakeImageBitmap,
): WorkerGpuFrameStackSourceBinding {
  return {
    layerId,
    runtimeSourceKind: 'image',
    sourceKind: 'timeline-media',
    sourceId: `timeline:${layerId}`,
    renderLayer: renderLayer(layerId),
    payload: {
      kind: 'bitmap',
      bitmap: bitmap as unknown as ImageBitmap,
      width: bitmap.width,
      height: bitmap.height,
      ownership: 'transferred-once',
    },
  };
}

function orderedStack(input: {
  readonly namespace: string;
  readonly compositionId: string;
  readonly bindings?: readonly WorkerGpuFrameStackSourceBinding[];
  readonly order?: readonly string[];
  readonly timelineTime?: number;
}): WorkerGpuFrameStackContractV1 {
  const bindings = input.bindings ?? [];
  return {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: input.namespace,
    dimensions: { width: 640, height: 360 },
    frame: frame(input.compositionId, input.timelineTime),
    execution: {
      kind: 'ordered-sources',
      bottomToTopLayerIds: input.order ?? bindings.map((entry) => entry.layerId),
    },
    bindings,
  };
}

function nestedBinding(
  parentNamespace: string,
  layerId: string,
  child: WorkerGpuFrameStackContractV1,
): WorkerGpuFrameStackSourceBinding {
  const sourceId = `nested-composition:${child.frame.compositionId}`;
  return {
    layerId,
    runtimeSourceKind: 'nestedComposition',
    sourceKind: 'nested-composition',
    sourceId,
    renderLayer: renderLayer(layerId),
    payload: {
      kind: 'nested-stack',
      reference: {
        sourceId,
        compositionId: child.frame.compositionId,
        localTimelineTime: child.frame.timelineTime,
        occurrenceNamespace: createWorkerGpuNestedOccurrenceNamespace(
          parentNamespace,
          layerId,
        ),
      },
      stack: child,
    },
  };
}

function layer(id: string, source: LayerSource): Layer {
  return {
    id: `runtime:${id}`,
    sourceClipId: `clip:${id}`,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source,
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function adjustmentLayer(): Layer {
  return {
    ...layer('adjustment', { type: 'motion-adjustment' }),
    effects: [{
      id: 'effect:adjustment:brightness',
      name: 'Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.2 },
    }],
  };
}

function frozenPlan(): MotionAdjustmentWorkerGpuExecutionPlan {
  const sourceBinding: WorkerGpuAdjustmentSourceBinding = {
    layerId: 'runtime:video',
    sourceKind: 'video',
    sourceId: 'timeline:video',
  };
  const plan = buildWorkerGpuAdjustmentExecutionPlan({
    layers: [adjustmentLayer(), layer('video', { type: 'video', mediaTime: 2 })],
    sourceBindings: [sourceBinding],
    frameContext: { compositionId: 'composition:frozen', timelineTimeSeconds: 2 },
    requestId: REQUEST_ID,
    targetId: TARGET_ID,
    frameIndex: FRAME_INDEX,
    intent: 'preview',
    nowMs: SUBMIT_BY_MS,
    resourceNamespace: 'occurrence:frozen',
  });
  if (!plan) throw new Error('Expected frozen Adjustment plan');
  return plan;
}

function frozenStack(plan: MotionAdjustmentWorkerGpuExecutionPlan): WorkerGpuFrameStackContractV1 {
  return {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: plan.resourceNamespace,
    dimensions: { width: 640, height: 360 },
    frame: { ...plan.frame, exact: true },
    execution: { kind: 'frozen-adjustment', plan },
    bindings: [{
      layerId: 'clip:video',
      runtimeSourceKind: 'video',
      sourceKind: 'timeline-media',
      sourceId: 'timeline:video',
      renderLayer: renderLayer('clip:video'),
      payload: { kind: 'webcodecs', mediaTime: 2, width: 640, height: 360 },
    }],
  };
}

function videoResult(layerValue: Layer): LayerRenderData {
  return {
    layer: layerValue,
    isVideo: true,
    externalTexture: { fake: 'external' } as unknown as GPUExternalTexture,
    textureView: null,
    sourceWidth: 640,
    sourceHeight: 360,
  };
}

function expectExecutorCode(
  callback: () => unknown,
  code: WorkerGpuFrameStackExecutorError['code'],
): void {
  expect(callback).toThrowError(
    expect.objectContaining<Partial<WorkerGpuFrameStackExecutorError>>({ code }),
  );
}

describe('Worker GPU recursive FrameStack executor MD7', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 1,
      TEXTURE_BINDING: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates required root admission before creating command resources', () => {
    const gpu = fakeGpu();
    const stack = orderedStack({
      namespace: 'occurrence:root',
      compositionId: 'composition:root',
    });

    expect(() => encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack,
      admission: { ...admission(), graphVersion: FRAME_INDEX + 1 },
      clock: () => 1_500,
      resources: fakeResources(),
    })).toThrowError(expect.objectContaining({ code: 'MD7_FRAME_STACK_ADMISSION_MISMATCH' }));
    expect(gpu.encoders).toHaveLength(0);
  });

  it('rechecks root expiry at encode start before creating command resources', () => {
    const gpu = fakeGpu();
    const image = new FakeImageBitmap();
    const stack = orderedStack({
      namespace: 'occurrence:encode-expired',
      compositionId: 'composition:encode-expired',
      bindings: [bitmapBinding('expired-image', image)],
    });

    expectExecutorCode(() => encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack,
      admission: admission(),
      clock: () => EXPIRE_AFTER_MS,
      resources: fakeResources(),
    }), 'MD7_FRAME_STACK_EXECUTOR_EXPIRED');
    expect(gpu.encoders).toHaveLength(0);
    expect(image.closeCount).toBe(1);
  });

  it('composites ordered sources bottom-to-top and releases everything after one fence', async () => {
    const gpu = fakeGpu();
    const compositeCalls: CompositeCall[] = [];
    const stack = orderedStack({
      namespace: 'occurrence:root',
      compositionId: 'composition:root',
      bindings: [solidBinding('bottom'), solidBinding('top')],
      order: ['bottom', 'top'],
    });
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack,
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources({ compositeCalls }),
    });

    expect(compositeCalls).toHaveLength(1);
    expect(compositeCalls[0]?.layers.map((entry) => entry.layer.sourceClipId)).toEqual([
      'bottom',
      'top',
    ]);
    expect(execution.finalView).toBe(compositeCalls[0]?.pingView);
    expect(execution.executedPassIds).toHaveLength(3);
    expect(execution.trace.map((entry) => entry.event)).toEqual([
      'enter-stack',
      'execute-pass',
      'execute-pass',
      'execute-pass',
      'leave-stack',
    ]);
    expect(execution.snapshot()).toMatchObject({ state: 'encoded', transientResourceCount: 4 });

    const firstSubmission = execution.submit();
    const secondSubmission = execution.submit();
    expect(secondSubmission).toBe(firstSubmission);
    await firstSubmission;

    expect(gpu.fenceCount()).toBe(1);
    expect(gpu.encoders[0]?.finishCount).toBe(1);
    expect(gpu.textures).toHaveLength(6);
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    expect(execution.snapshot()).toEqual({ state: 'finalized', transientResourceCount: 0 });
  });

  it('runs the shared compositor with an empty list for transparent output', () => {
    const gpu = fakeGpu();
    const compositeCalls: CompositeCall[] = [];
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: orderedStack({
        namespace: 'occurrence:empty',
        compositionId: 'composition:empty',
      }),
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources({ compositeCalls }),
    });

    expect(compositeCalls).toHaveLength(1);
    expect(compositeCalls[0]?.layers).toEqual([]);
    expect(execution.finalView).toBe(compositeCalls[0]?.pingView);
    execution.dispose();
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
  });

  it('executes nested stacks depth-first and injects the child view atomically', () => {
    const gpu = fakeGpu();
    const compositeCalls: CompositeCall[] = [];
    const parentNamespace = 'occurrence:parent';
    const childNamespace = createWorkerGpuNestedOccurrenceNamespace(parentNamespace, 'nested');
    const child = orderedStack({
      namespace: childNamespace,
      compositionId: 'composition:child',
      timelineTime: 1.5,
      bindings: [solidBinding('child-solid')],
    });
    const parent = orderedStack({
      namespace: parentNamespace,
      compositionId: 'composition:parent',
      bindings: [
        nestedBinding(parentNamespace, 'nested', child),
        solidBinding('parent-solid'),
      ],
    });
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: parent,
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources({ compositeCalls }),
    });

    expect(compositeCalls.map((call) => call.namespace)).toEqual([
      childNamespace,
      parentNamespace,
    ]);
    expect(compositeCalls[0]?.layers.map((entry) => entry.layer.sourceClipId)).toEqual([
      'child-solid',
    ]);
    expect(compositeCalls[1]?.layers.map((entry) => entry.layer.sourceClipId)).toEqual([
      'nested',
      'parent-solid',
    ]);
    expect(compositeCalls[1]?.layers[0]?.textureView).toBe(compositeCalls[0]?.pingView);
    expect(execution.trace.map((entry) => [
      entry.event,
      entry.occurrenceNamespace,
      entry.layerId ?? null,
    ])).toEqual([
      ['enter-stack', parentNamespace, null],
      ['execute-pass', parentNamespace, 'nested'],
      ['enter-stack', childNamespace, null],
      ['execute-pass', childNamespace, 'child-solid'],
      ['execute-pass', childNamespace, null],
      ['leave-stack', childNamespace, null],
      ['execute-pass', parentNamespace, 'parent-solid'],
      ['execute-pass', parentNamespace, null],
      ['leave-stack', parentNamespace, null],
    ]);
    execution.dispose();
  });

  it('rechecks expiry immediately before nested execution and cleans the root', () => {
    const gpu = fakeGpu();
    const compositeCalls: CompositeCall[] = [];
    const parentNamespace = 'occurrence:expiry-parent';
    const child = orderedStack({
      namespace: createWorkerGpuNestedOccurrenceNamespace(parentNamespace, 'nested'),
      compositionId: 'composition:expiry-child',
      bindings: [solidBinding('child-solid')],
    });
    const parent = orderedStack({
      namespace: parentNamespace,
      compositionId: 'composition:expiry-parent',
      bindings: [nestedBinding(parentNamespace, 'nested', child)],
    });
    const clockValues = [1_500, 1_500, EXPIRE_AFTER_MS];

    expectExecutorCode(() => encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: parent,
      admission: admission(),
      clock: () => clockValues.shift() ?? EXPIRE_AFTER_MS,
      resources: fakeResources({ compositeCalls }),
    }), 'MD7_FRAME_STACK_EXECUTOR_EXPIRED');

    expect(compositeCalls).toEqual([]);
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
  });

  it('uses the frozen Adjustment encoder with a lazy materializer resolver', () => {
    const gpu = fakeGpu();
    const plan = frozenPlan();
    const resolved: WorkerGpuAdjustmentSourceResolveRequest[] = [];
    const adjustmentResource = { destroy: vi.fn() };
    const finalView = { fake: 'adjustment-final' } as unknown as GPUTextureView;
    const encodeAdjustmentPlan: WorkerGpuFrameStackAdjustmentEncoder = vi.fn((input) => {
      for (const pass of input.plan.passes) {
        if (pass.kind !== 'resolve-source') continue;
        const request = {
          passId: pass.passId,
          layerId: pass.layerId,
          sourceId: pass.sourceId,
          sourceKind: pass.sourceKind,
        };
        resolved.push(request);
        const source = input.resolveSource(request);
        expect(source.layerId).toBe(pass.layerId);
        expect(Object.isFrozen(source.data)).toBe(true);
        expect(Object.isFrozen(source.data.layer.position)).toBe(true);
        expect(Object.isFrozen(source.data.layer.effects)).toBe(true);
      }
      return {
        finalView,
        transientResources: [adjustmentResource],
        executedPassIds: input.plan.passes.map((pass) => pass.passId),
      };
    });
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: frozenStack(plan),
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources(),
      sourceResolvers: {
        resolveWebCodecs: (input) => videoResult(input.layer),
      },
      dependencies: { encodeAdjustmentPlan },
    });

    expect(resolved).toHaveLength(1);
    expect(execution.finalView).toBe(finalView);
    expect(execution.executedPassIds).toEqual(plan.passes.map((pass) => pass.passId));
    expect(execution.trace.filter((entry) => entry.event === 'execute-pass')
      .map((entry) => entry.passId)).toEqual(plan.passes.map((pass) => pass.passId));
    expect(execution.snapshot().transientResourceCount).toBe(1);
    execution.dispose();
    expect(adjustmentResource.destroy).toHaveBeenCalledOnce();
  });

  it('inserts a nested child depth-first at the frozen parent resolve pass', () => {
    const gpu = fakeGpu();
    const compositeCalls: CompositeCall[] = [];
    const parentNamespace = 'occurrence:frozen-nested';
    const parentLayerId = 'clip:nested';
    const childNamespace = createWorkerGpuNestedOccurrenceNamespace(
      parentNamespace,
      parentLayerId,
    );
    const child = orderedStack({
      namespace: childNamespace,
      compositionId: 'composition:frozen-child',
      timelineTime: 1.5,
      bindings: [solidBinding('child-solid')],
    });
    const nestedSourceId = `nested-composition:${child.frame.compositionId}`;
    const plan = buildWorkerGpuAdjustmentExecutionPlan({
      layers: [
        adjustmentLayer(),
        layer('nested', {
          type: 'image',
          nestedComposition: {
            compositionId: child.frame.compositionId,
            layers: [],
            width: 640,
            height: 360,
          },
        }),
      ],
      sourceBindings: [{
        layerId: 'runtime:nested',
        sourceKind: 'nestedComposition',
        sourceId: nestedSourceId,
      }],
      frameContext: { compositionId: 'composition:frozen-parent', timelineTimeSeconds: 2 },
      requestId: REQUEST_ID,
      targetId: TARGET_ID,
      frameIndex: FRAME_INDEX,
      intent: 'preview',
      nowMs: SUBMIT_BY_MS,
      resourceNamespace: parentNamespace,
    });
    if (!plan) throw new Error('Expected frozen nested Adjustment plan');
    const parent: WorkerGpuFrameStackContractV1 = {
      contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
      frameMode: 'exact-one-shot',
      occurrenceNamespace: parentNamespace,
      dimensions: { width: 640, height: 360 },
      frame: { ...plan.frame, exact: true },
      execution: { kind: 'frozen-adjustment', plan },
      bindings: [nestedBinding(parentNamespace, parentLayerId, child)],
    };
    const encodeAdjustmentPlan: WorkerGpuFrameStackAdjustmentEncoder = (input) => {
      for (const pass of input.plan.passes) {
        if (pass.kind === 'resolve-source') {
          input.resolveSource({
            passId: pass.passId,
            layerId: pass.layerId,
            sourceId: pass.sourceId,
            sourceKind: pass.sourceKind,
          });
        }
      }
      return {
        finalView: { fake: 'frozen-parent-final' } as unknown as GPUTextureView,
        transientResources: [],
        executedPassIds: input.plan.passes.map((pass) => pass.passId),
      };
    };
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: parent,
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources({ compositeCalls }),
      dependencies: { encodeAdjustmentPlan },
    });

    const parentResolvePassId = plan.passes.find(
      (pass) => pass.kind === 'resolve-source',
    )?.passId;
    const parentCompositePassId = plan.passes.find(
      (pass) => pass.kind === 'composite-source',
    )?.passId;
    const parentResolveIndex = execution.executedPassIds.indexOf(parentResolvePassId ?? '');
    const parentCompositeIndex = execution.executedPassIds.indexOf(parentCompositePassId ?? '');
    const childPassIndexes = execution.trace
      .filter((entry) => entry.event === 'execute-pass'
        && entry.occurrenceNamespace === childNamespace)
      .map((entry) => execution.executedPassIds.indexOf(entry.passId ?? ''));
    expect(parentResolveIndex).toBeGreaterThanOrEqual(0);
    expect(childPassIndexes.every((index) => index > parentResolveIndex)).toBe(true);
    expect(childPassIndexes.every((index) => index < parentCompositeIndex)).toBe(true);
    expect(compositeCalls[0]?.namespace).toBe(childNamespace);
    execution.dispose();
  });

  it('rechecks frozen expiry before calling the Adjustment encoder', () => {
    const gpu = fakeGpu();
    const encodeAdjustmentPlan = vi.fn<WorkerGpuFrameStackAdjustmentEncoder>();
    const clockValues = [1_500, 1_500, EXPIRE_AFTER_MS];

    expectExecutorCode(() => encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: frozenStack(frozenPlan()),
      admission: admission(),
      clock: () => clockValues.shift() ?? EXPIRE_AFTER_MS,
      resources: fakeResources(),
      dependencies: { encodeAdjustmentPlan },
    }), 'MD7_FRAME_STACK_EXECUTOR_EXPIRED');
    expect(encodeAdjustmentPlan).not.toHaveBeenCalled();
  });

  it('canonicalizes and freezes adversarial lazy layer identity and transforms', () => {
    const gpu = fakeGpu();
    const plan = frozenPlan();
    const encodeAdjustmentPlan: WorkerGpuFrameStackAdjustmentEncoder = (input) => {
      const pass = input.plan.passes.find((entry) => entry.kind === 'resolve-source');
      if (!pass || pass.kind !== 'resolve-source') throw new Error('Missing resolve pass');
      const source = input.resolveSource({
        passId: pass.passId,
        layerId: pass.layerId,
        sourceId: pass.sourceId,
        sourceKind: pass.sourceKind,
      });
      expect(source.data.layer.id).toBe('runtime:clip:video');
      expect(source.data.layer.sourceClipId).toBe('clip:video');
      expect(source.data.layer.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(() => {
        source.data.layer.sourceClipId = 'clip:other';
      }).toThrow();
      expect(() => {
        source.data.layer.position.x = 999;
      }).toThrow();
      return {
        finalView: { fake: 'adversarial-final' } as unknown as GPUTextureView,
        transientResources: [],
        executedPassIds: input.plan.passes.map((entry) => entry.passId),
      };
    };

    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: frozenStack(plan),
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources(),
      sourceResolvers: {
        resolveWebCodecs: (input) => {
          const adversarialLayer = {
            ...input.layer,
            position: { x: 999, y: 999, z: 999 },
            effects: [{
              id: 'effect:foreign',
              name: 'Foreign',
              type: 'invert' as const,
              enabled: true,
              params: {},
            }],
          };
          return videoResult(adversarialLayer);
        },
      },
      dependencies: { encodeAdjustmentPlan },
    });
    execution.dispose();
  });

  it('rejects an injected Adjustment encoder that claims success without consuming sources', () => {
    const gpu = fakeGpu();
    const plan = frozenPlan();
    const leakedResource = { destroy: vi.fn() };
    const encodeAdjustmentPlan: WorkerGpuFrameStackAdjustmentEncoder = () => ({
      finalView: { fake: 'untrusted-final' } as unknown as GPUTextureView,
      transientResources: [leakedResource],
      executedPassIds: plan.passes.map((pass) => pass.passId),
    });

    expectExecutorCode(() => encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: frozenStack(plan),
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources(),
      dependencies: { encodeAdjustmentPlan },
    }), 'MD7_FRAME_STACK_EXECUTOR_SOURCE_CONSUMPTION_MISMATCH');
    expect(leakedResource.destroy).toHaveBeenCalledOnce();
  });

  it('cleans materialized and compositor resources when ordered execution fails', () => {
    const gpu = fakeGpu();
    const image = new FakeImageBitmap();
    const stack = orderedStack({
      namespace: 'occurrence:failure',
      compositionId: 'composition:failure',
      bindings: [bitmapBinding('image', image)],
    });

    expect(() => encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack,
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources({ compositeThrows: true }),
    })).toThrowError('compositor failed');

    expect(image.closeCount).toBe(1);
    expect(gpu.textures).toHaveLength(5);
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    expect(gpu.events).not.toContain('submit');
    expect(gpu.fenceCount()).toBe(0);
  });

  it('cleans all resources when the single after-submit fence fails', async () => {
    const gpu = fakeGpu({ fenceThrows: true });
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: orderedStack({
        namespace: 'occurrence:fence-failure',
        compositionId: 'composition:fence-failure',
        bindings: [solidBinding('solid')],
      }),
      admission: admission(),
      clock: () => 1_500,
      resources: fakeResources(),
    });

    await expect(execution.submit()).rejects.toMatchObject({
      code: 'MD7_FRAME_STACK_EXECUTOR_AFTER_SUBMIT_FAILED',
    });
    expect(gpu.fenceCount()).toBe(1);
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    expect(execution.snapshot()).toEqual({ state: 'finalized', transientResourceCount: 0 });
  });

  it('rechecks expiry immediately before queue submission and aborts without a fence', async () => {
    const gpu = fakeGpu();
    const clockValues = [1_500, 1_500, 1_500, EXPIRE_AFTER_MS];
    const execution = encodeWorkerGpuFrameStack({
      device: gpu.device,
      stack: orderedStack({
        namespace: 'occurrence:submit-expired',
        compositionId: 'composition:submit-expired',
        bindings: [solidBinding('solid')],
      }),
      admission: admission(),
      clock: () => clockValues.shift() ?? EXPIRE_AFTER_MS,
      resources: fakeResources(),
    });

    await expect(execution.submit()).rejects.toMatchObject({
      code: 'MD7_FRAME_STACK_EXECUTOR_EXPIRED',
    });
    expect(gpu.events).not.toContain('submit');
    expect(gpu.fenceCount()).toBe(0);
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    expect(execution.snapshot()).toEqual({ state: 'disposed', transientResourceCount: 0 });
  });
});
