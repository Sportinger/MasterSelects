import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerRenderData } from '../../src/engine/core/types';
import type { MotionLayerDefinition } from '../../src/types/motionDesign';
import type { WorkerGpuWebCodecsRenderLayer } from '../../src/services/render/workerGpuRuntimeCommands';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackSourceBinding,
} from '../../src/services/render/workerGpuFrameStackContract';
import {
  WorkerGpuFrameStackMaterializerError,
  createWorkerGpuFrameStackMaterializer as createWorkerGpuFrameStackMaterializerRaw,
  type WorkerGpuFrameStackMaterializer,
} from '../../src/services/render/workerGpuFrameStackMaterializer';

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
  readonly view = { fake: 'texture-view' } as unknown as GPUTextureView;
  destroyCount = 0;

  constructor(
    readonly label: string,
    private readonly events: string[],
  ) {}

  createView(): GPUTextureView {
    this.events.push(`view:${this.label}`);
    return this.view;
  }

  destroy(): void {
    this.destroyCount += 1;
    this.events.push(`destroy:${this.label}`);
  }
}

interface FakeGpuOptions {
  readonly copyThrows?: boolean;
  readonly writeThrows?: boolean;
  readonly fenceThrows?: boolean;
  readonly onCopy?: () => void;
}

interface FakeGpu {
  readonly device: GPUDevice;
  readonly encoder: GPUCommandEncoder;
  readonly events: string[];
  readonly textures: FakeTexture[];
  readonly writtenColors: number[][];
}

function fakeGpu(options: FakeGpuOptions = {}): FakeGpu {
  const events: string[] = [];
  const textures: FakeTexture[] = [];
  const writtenColors: number[][] = [];
  const queue = {
    copyExternalImageToTexture(): void {
      events.push('copy');
      options.onCopy?.();
      if (options.copyThrows) throw new Error('copy failed');
    },
    writeTexture(
      _destination: GPUImageCopyTexture,
      data: GPUAllowSharedBufferSource,
    ): void {
      events.push('write');
      const bytes = data instanceof ArrayBuffer || data instanceof SharedArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      writtenColors.push([...bytes]);
      if (options.writeThrows) throw new Error('write failed');
    },
    async onSubmittedWorkDone(): Promise<void> {
      events.push('fence');
      if (options.fenceThrows) throw new Error('fence failed');
    },
  };
  const device = {
    queue,
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
      const label = String(descriptor.label ?? `texture:${textures.length}`);
      events.push(`create:${label}`);
      const texture = new FakeTexture(label, events);
      textures.push(texture);
      return texture as unknown as GPUTexture;
    },
  } as unknown as GPUDevice;
  return {
    device,
    encoder: {} as GPUCommandEncoder,
    events,
    textures,
    writtenColors,
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

function binding(
  layerId: string,
  overrides: Partial<WorkerGpuFrameStackSourceBinding> = {},
): WorkerGpuFrameStackSourceBinding {
  return {
    layerId,
    runtimeSourceKind: 'video',
    sourceKind: 'timeline-media',
    sourceId: `source:${layerId}`,
    renderLayer: renderLayer(layerId),
    payload: { kind: 'webcodecs', mediaTime: 2, width: 64, height: 36 },
    ...overrides,
  };
}

function stack(
  bindings: readonly WorkerGpuFrameStackSourceBinding[],
  namespace = 'root',
): WorkerGpuFrameStackContractV1 {
  return {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: namespace,
    dimensions: { width: 640, height: 360 },
    frame: {
      requestId: 'request:materializer',
      targetId: 'preview',
      compositionId: `composition:${namespace}`,
      timelineTime: 2,
      frameIndex: 48,
      intent: 'preview',
      submitByMs: 1_000,
      expireAfterMs: 2_000,
      graphVersion: 7,
      exact: true,
    },
    execution: {
      kind: 'ordered-sources',
      bottomToTopLayerIds: bindings.map((entry) => entry.layerId),
    },
    bindings,
  };
}

function createWorkerGpuFrameStackMaterializer(
  input: Omit<Parameters<typeof createWorkerGpuFrameStackMaterializerRaw>[0], 'admission' | 'clock'> & {
    readonly clock?: () => number;
  },
): WorkerGpuFrameStackMaterializer {
  const { clock = () => 1_500, ...rest } = input;
  return createWorkerGpuFrameStackMaterializerRaw({
    ...rest,
    admission: {
      requestId: input.stack.frame.requestId,
      targetId: input.stack.frame.targetId,
      intent: input.stack.frame.intent,
      graphVersion: input.stack.frame.graphVersion,
    },
    clock,
  });
}

function bitmapBinding(
  layerId: string,
  image: FakeImageBitmap,
): WorkerGpuFrameStackSourceBinding {
  return binding(layerId, {
    runtimeSourceKind: 'image',
    payload: {
      kind: 'bitmap',
      bitmap: image as unknown as ImageBitmap,
      width: image.width,
      height: image.height,
      ownership: 'transferred-once',
    },
  });
}

function textureResult(
  layer: LayerRenderData['layer'],
  width = 64,
  height = 36,
  textureView = { fake: 'injected-view' } as unknown as GPUTextureView,
): LayerRenderData {
  return {
    layer,
    isVideo: false,
    externalTexture: null,
    textureView,
    sourceWidth: width,
    sourceHeight: height,
  };
}

function videoResult(
  layer: LayerRenderData['layer'],
  width = 64,
  height = 36,
): LayerRenderData {
  return {
    layer,
    isVideo: true,
    externalTexture: { fake: 'injected-external-texture' } as unknown as GPUExternalTexture,
    textureView: null,
    sourceWidth: width,
    sourceHeight: height,
  };
}

function expectCode(
  callback: () => unknown,
  code: WorkerGpuFrameStackMaterializerError['code'],
): void {
  expect(callback).toThrowError(
    expect.objectContaining<Partial<WorkerGpuFrameStackMaterializerError>>({ code }),
  );
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Worker GPU FrameStack materializer MD7', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUTextureUsage', { COPY_DST: 1, TEXTURE_BINDING: 2 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a transferred bitmap, registers before copy, and closes it once in finally', async () => {
    const image = new FakeImageBitmap();
    const gpu = fakeGpu({
      onCopy: () => {
        expect(materializer.snapshot().transientResourceCount).toBe(1);
      },
    });
    const materializer: WorkerGpuFrameStackMaterializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([bitmapBinding('bitmap', image)]),
    });

    const result = materializer.resolve('bitmap', gpu.encoder);

    expect(result).toMatchObject({
      layerId: 'bitmap',
      sourceKind: 'timeline-media',
      sourceId: 'source:bitmap',
      data: {
        isVideo: false,
        isDynamic: true,
        sourceWidth: 64,
        sourceHeight: 36,
      },
    });
    expect(result.data.layer.source).toMatchObject({ type: 'image' });
    expect(gpu.events.slice(0, 3)).toEqual([
      'create:worker-gpu-frame-stack-bitmap:bitmap',
      'copy',
      'view:worker-gpu-frame-stack-bitmap:bitmap',
    ]);
    expect(image.closeCount).toBe(1);
    expect(materializer.snapshot().openTransferredBitmapCount).toBe(0);

    await materializer.markSubmitted(gpu.device.queue.onSubmittedWorkDone());

    expect(gpu.events).toContain('fence');
    expect(gpu.textures[0]?.destroyCount).toBe(1);
    expect(image.closeCount).toBe(1);
    expect(materializer.snapshot().state).toBe('finalized');
  });

  it('makes bitmap upload failure terminal and cleans the registered texture immediately', async () => {
    const image = new FakeImageBitmap();
    const gpu = fakeGpu({ copyThrows: true });
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([bitmapBinding('bitmap', image)]),
    });

    expectCode(
      () => materializer.resolve('bitmap', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_BITMAP_UPLOAD_FAILED',
    );
    expect(image.closeCount).toBe(1);
    expect(materializer.snapshot()).toMatchObject({
      state: 'disposed',
      transientResourceCount: 0,
      openTransferredBitmapCount: 0,
    });
    expect(gpu.textures[0]?.destroyCount).toBe(1);
    expectCode(
      () => materializer.resolve('bitmap', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_FINALIZED',
    );

    await materializer.dispose();
    await materializer.dispose();

    expect(gpu.textures[0]?.destroyCount).toBe(1);
    expect(image.closeCount).toBe(1);
  });

  it('uploads canonical solid RGBA into one texel while preserving authored dimensions', () => {
    const gpu = fakeGpu();
    const solid = binding('solid', {
      runtimeSourceKind: 'solid',
      payload: { kind: 'solid', color: '#11223344', width: 1920, height: 1080 },
    });
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([solid]),
    });

    const result = materializer.resolve('solid', gpu.encoder);

    expect(gpu.writtenColors).toEqual([[17, 34, 51, 68]]);
    expect(result.data).toMatchObject({
      isVideo: false,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    expect(result.data.layer.source).toEqual({
      type: 'solid',
      color: '#11223344',
      intrinsicWidth: 1920,
      intrinsicHeight: 1080,
    });
  });

  it('fails closed on non-canonical solid colors before allocating GPU resources', () => {
    const gpu = fakeGpu();
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([
        binding('solid', {
          runtimeSourceKind: 'solid',
          payload: { kind: 'solid', color: 'red', width: 10, height: 10 },
        }),
      ]),
    });

    expectCode(
      () => materializer.resolve('solid', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_SOLID_COLOR_INVALID',
    );
    expect(gpu.textures).toHaveLength(0);
  });

  it('uses injected WebCodecs and Motion resolvers with reconstructed source layers', () => {
    const gpu = fakeGpu();
    const web = binding('web', {
      payload: { kind: 'webcodecs', mediaTime: 3.25, width: 1920, height: 1080 },
    });
    const motion = binding('motion', {
      runtimeSourceKind: 'motion',
      sourceKind: 'motion-media',
      payload: {
        kind: 'motion',
        definition: {} as MotionLayerDefinition,
        timelineTime: 4.5,
        width: 640,
        height: 360,
      },
    });
    const resolveWebCodecs = vi.fn((input) => {
      expect(input.payload.mediaTime).toBe(3.25);
      expect(input.layer.source).toEqual({ type: 'video', mediaTime: 3.25 });
      return {
        layer: {
          ...input.layer,
          opacity: 0.125,
          effects: [{
            id: 'provider-effect',
            name: 'Provider effect must not escape',
            type: 'brightness',
            enabled: true,
            params: { amount: 10 },
          }],
        },
        isVideo: true,
        externalTexture: { fake: 'external' } as unknown as GPUExternalTexture,
        textureView: null,
        sourceWidth: 1920,
        sourceHeight: 1080,
      };
    });
    const renderMotion = vi.fn((input) => {
      expect(input.payload.timelineTime).toBe(4.5);
      expect(input.layer.source).toMatchObject({ type: 'motion', mediaTime: 4.5 });
      return textureResult(input.layer, 640, 360);
    });
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([web, motion]),
      resolvers: { resolveWebCodecs, renderMotion },
    });

    const webResult = materializer.resolve('web', gpu.encoder).data;
    expect(webResult.isVideo).toBe(true);
    expect(webResult.layer.opacity).toBe(1);
    expect(webResult.layer.effects).toEqual([]);
    expect(materializer.resolve('motion', gpu.encoder).data.isVideo).toBe(false);
    expect(resolveWebCodecs).toHaveBeenCalledOnce();
    expect(renderMotion).toHaveBeenCalledOnce();
  });

  it('injects a recursive child materializer sharing root lifetime cleanup', async () => {
    const gpu = fakeGpu();
    const childImage = new FakeImageBitmap(32, 18);
    const childStack = stack([bitmapBinding('child-bitmap', childImage)], 'child');
    const nested = binding('nested', {
      runtimeSourceKind: 'nestedComposition',
      sourceKind: 'nested-composition',
      payload: {
        kind: 'nested-stack',
        reference: {
          sourceId: 'source:nested',
          compositionId: childStack.frame.compositionId,
          localTimelineTime: childStack.frame.timelineTime,
          occurrenceNamespace: childStack.occurrenceNamespace,
        },
        stack: childStack,
      },
    });
    const resolveNested = vi.fn((input) => {
      const child = input.childMaterializer.resolve('child-bitmap', input.commandEncoder);
      expect(childImage.closeCount).toBe(1);
      expect(input.layer.source).toMatchObject({
        type: 'image',
        intrinsicWidth: 640,
        intrinsicHeight: 360,
      });
      return textureResult(input.layer, 640, 360, child.data.textureView ?? undefined);
    });
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([nested]),
      resolvers: { resolveNested },
    });

    materializer.resolve('nested', gpu.encoder);
    expect(materializer.snapshot()).toMatchObject({
      transientResourceCount: 1,
      openTransferredBitmapCount: 0,
    });

    await materializer.markSubmitted(gpu.device.queue.onSubmittedWorkDone());

    expect(resolveNested).toHaveBeenCalledOnce();
    expect(gpu.textures[0]?.destroyCount).toBe(1);
    expect(childImage.closeCount).toBe(1);
  });

  it('runs injected lifecycle hooks after the queue fence and exactly once', async () => {
    const gpu = fakeGpu();
    const injectedResource = {
      destroy: vi.fn(() => gpu.events.push('destroy:injected')),
    };
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
      resolvers: {
        resolveWebCodecs: (input) => {
          input.registerTransientResource(injectedResource);
          input.registerAfterSubmitCleanup(() => gpu.events.push('after-submit'));
          input.registerDisposeCleanup(() => gpu.events.push('dispose-cleanup'));
          return videoResult(input.layer);
        },
      },
    });

    materializer.resolve('web', gpu.encoder);
    await materializer.markSubmitted(gpu.device.queue.onSubmittedWorkDone());
    await materializer.markSubmitted(Promise.resolve());

    expect(gpu.events).toEqual([
      'fence',
      'after-submit',
      'destroy:injected',
      'dispose-cleanup',
    ]);
    expect(injectedResource.destroy).toHaveBeenCalledOnce();
  });

  it('explicit disposal closes unconsumed bitmaps and drains every registered cleanup once', async () => {
    const gpu = fakeGpu();
    const image = new FakeImageBitmap();
    const disposeCleanup = vi.fn();
    const afterSubmitCleanup = vi.fn();
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web'), bitmapBinding('unconsumed', image)]),
      resolvers: {
        resolveWebCodecs: (input) => {
          input.registerDisposeCleanup(disposeCleanup);
          input.registerAfterSubmitCleanup(afterSubmitCleanup);
          return videoResult(input.layer);
        },
      },
    });
    materializer.resolve('web', gpu.encoder);

    await materializer.dispose();
    await materializer.dispose();

    expect(materializer.snapshot().state).toBe('disposed');
    expect(image.closeCount).toBe(1);
    expect(disposeCleanup).toHaveBeenCalledOnce();
    expect(afterSubmitCleanup).toHaveBeenCalledOnce();
  });

  it('rechecks expiry before lazy resolve and terminally closes unconsumed transfers', async () => {
    const gpu = fakeGpu();
    const sibling = new FakeImageBitmap();
    let nowMs = 1_500;
    const resolveWebCodecs = vi.fn((input) => videoResult(input.layer));
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web'), bitmapBinding('sibling', sibling)]),
      clock: () => nowMs,
      resolvers: { resolveWebCodecs },
    });
    expect(materializer.snapshot()).toMatchObject({
      state: 'encoded',
      openTransferredBitmapCount: 1,
    });

    nowMs = 2_000;
    expectCode(
      () => materializer.resolve('web', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_FRAME_EXPIRED',
    );
    await materializer.dispose();

    expect(resolveWebCodecs).not.toHaveBeenCalled();
    expect(sibling.closeCount).toBe(1);
    expect(materializer.snapshot()).toMatchObject({
      state: 'disposed',
      transientResourceCount: 0,
      openTransferredBitmapCount: 0,
    });
  });

  it('enforces ordered-sources bottom-to-top resolve order and aborts on inversion', async () => {
    const gpu = fakeGpu();
    const resolver = vi.fn((input) => videoResult(input.layer));
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('back'), binding('front')]),
      resolvers: { resolveWebCodecs: resolver },
    });

    expectCode(
      () => materializer.resolve('front', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_ORDER_MISMATCH',
    );
    await materializer.dispose();

    expect(resolver).not.toHaveBeenCalled();
    expect(materializer.snapshot().state).toBe('disposed');
    expectCode(
      () => materializer.resolve('back', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_FINALIZED',
    );
  });

  it('terminally cleans provider resources, cleanups, and sibling bitmaps exactly once', async () => {
    const gpu = fakeGpu();
    const sibling = new FakeImageBitmap();
    const resource = { destroy: vi.fn() };
    const afterSubmitCleanup = vi.fn(async () => undefined);
    const disposeCleanup = vi.fn();
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web'), bitmapBinding('sibling', sibling)]),
      resolvers: {
        resolveWebCodecs: (input) => {
          input.registerTransientResource(resource);
          input.registerAfterSubmitCleanup(afterSubmitCleanup);
          input.registerDisposeCleanup(disposeCleanup);
          throw new Error('provider failed after registration');
        },
      },
    });

    expectCode(
      () => materializer.resolve('web', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVE_FAILED',
    );
    await materializer.dispose();
    await materializer.dispose();

    expect(resource.destroy).toHaveBeenCalledOnce();
    expect(afterSubmitCleanup).toHaveBeenCalledOnce();
    expect(disposeCleanup).toHaveBeenCalledOnce();
    expect(sibling.closeCount).toBe(1);
    expect(materializer.snapshot()).toMatchObject({
      state: 'disposed',
      transientResourceCount: 0,
      openTransferredBitmapCount: 0,
    });
  });

  it('shares one explicit deferred submission fence with concurrent disposal', async () => {
    const gpu = fakeGpu();
    const submission = deferred<void>();
    const resource = { destroy: vi.fn() };
    const afterSubmitCleanup = vi.fn();
    const disposeCleanup = vi.fn();
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
      resolvers: {
        resolveWebCodecs: (input) => {
          input.registerTransientResource(resource);
          input.registerAfterSubmitCleanup(afterSubmitCleanup);
          input.registerDisposeCleanup(disposeCleanup);
          return videoResult(input.layer);
        },
      },
    });
    materializer.resolve('web', gpu.encoder);

    expectCode(
      () => materializer.afterSubmittedWorkDone(),
      'MD7_FRAME_STACK_MATERIALIZER_SUBMISSION_FENCE_REQUIRED',
    );
    expect(materializer.snapshot().state).toBe('encoded');

    const finalized = materializer.markSubmitted(submission.promise);
    const concurrentDispose = materializer.dispose();
    expect(concurrentDispose).toBe(finalized);
    expect(materializer.snapshot().state).toBe('submitted');
    expect(resource.destroy).not.toHaveBeenCalled();
    expect(afterSubmitCleanup).not.toHaveBeenCalled();
    expect(disposeCleanup).not.toHaveBeenCalled();

    submission.resolve();
    await finalized;
    await concurrentDispose;

    expect(resource.destroy).toHaveBeenCalledOnce();
    expect(afterSubmitCleanup).toHaveBeenCalledOnce();
    expect(disposeCleanup).toHaveBeenCalledOnce();
    expect(materializer.snapshot()).toMatchObject({
      state: 'finalized',
      transientResourceCount: 0,
    });
  });

  it('fails closed for duplicate, unknown, consumed, missing, failed, and invalid sources', async () => {
    const gpu = fakeGpu();
    const duplicate = binding('same');
    expectCode(
      () => createWorkerGpuFrameStackMaterializer({
        device: gpu.device,
        stack: stack([duplicate, duplicate]),
      }),
      'MD7_FRAME_STACK_MATERIALIZER_DUPLICATE_BINDING',
    );

    const unknown = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
    });
    expectCode(
      () => unknown.resolve('unknown', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_UNKNOWN_BINDING',
    );
    expect(unknown.snapshot().state).toBe('disposed');

    const missing = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
    });
    expectCode(
      () => missing.resolve('web', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVER_MISSING',
    );
    expectCode(
      () => missing.resolve('web', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_FINALIZED',
    );

    const failed = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
      resolvers: { resolveWebCodecs: () => { throw new Error('provider failed'); } },
    });
    expectCode(
      () => failed.resolve('web', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVE_FAILED',
    );

    const invalid = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
      resolvers: {
        resolveWebCodecs: (input) => ({
          ...videoResult(input.layer),
          sourceWidth: 0,
        }),
      },
    });
    expectCode(
      () => invalid.resolve('web', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_RESOLVER_RESULT_INVALID',
    );

    const finalized = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([]),
    });
    await finalized.markSubmitted(gpu.device.queue.onSubmittedWorkDone());
    expectCode(
      () => finalized.resolve('unknown', gpu.encoder),
      'MD7_FRAME_STACK_MATERIALIZER_FINALIZED',
    );
  });

  it('surfaces queue or cleanup failure only after completing all cleanup', async () => {
    const gpu = fakeGpu({ fenceThrows: true });
    const resource = { destroy: vi.fn() };
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: gpu.device,
      stack: stack([binding('web')]),
      resolvers: {
        resolveWebCodecs: (input) => {
          input.registerTransientResource(resource);
          return videoResult(input.layer);
        },
      },
    });
    materializer.resolve('web', gpu.encoder);

    await expect(materializer.markSubmitted(gpu.device.queue.onSubmittedWorkDone())).rejects.toMatchObject({
      code: 'MD7_FRAME_STACK_MATERIALIZER_AFTER_SUBMIT_FAILED',
    });

    expect(resource.destroy).toHaveBeenCalledOnce();
    expect(materializer.snapshot().state).toBe('finalized');
  });
});
