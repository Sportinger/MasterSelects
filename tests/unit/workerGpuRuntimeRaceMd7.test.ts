import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTwoAdjustmentFixture } from '../../src/services/motionDesign/adjustment/contractFixtures';
import { planMotionAdjustmentOperations } from '../../src/services/motionDesign/adjustment/operationPlanner';
import {
  planMotionAdjustmentWorkerGpuExecution,
  type MotionAdjustmentWorkerGpuExecutionPlan,
} from '../../src/services/motionDesign/adjustment/workerGpuAdjustmentPlan';
import {
  WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
  createWorkerGpuNestedOccurrenceNamespace,
  type WorkerGpuFrameStackContractV1,
  type WorkerGpuFrameStackSourceBinding,
} from '../../src/services/render/workerGpuFrameStackContract';
import type {
  WorkerGpuPresentResult,
  WorkerGpuTargetSurface,
} from '../../src/services/render/workerGpuTargetSurface';
import type {
  WorkerGpuPresentFrameStackCommand,
  WorkerGpuWebCodecsFrameLayer,
} from '../../src/services/render/workerGpuRuntimeCommands';
import type { WorkerRenderHostRuntimeCommand } from '../../src/services/render/workerRenderHostRuntimeCommands';
import type { WorkerWebCodecsGpuFrameReadResult } from '../../src/services/render/workerRenderHostRuntimeWebCodecs';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const raceMocks = vi.hoisted(() => ({
  createSurface: vi.fn(),
  presentComposited: vi.fn(),
  presentFrameStack: vi.fn(),
  presentLayers: vi.fn(),
  presentSingle: vi.fn(),
  readFrame: vi.fn(),
}));

vi.mock('../../src/services/render/workerGpuTargetSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuTargetSurface')>()),
  createWorkerGpuTargetSurface: raceMocks.createSurface,
}));

vi.mock('../../src/services/render/workerGpuVideoFrameCompositor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuVideoFrameCompositor')>()),
  presentGpuVideoFrameCompositedLayers: raceMocks.presentComposited,
  presentGpuFrameStack: raceMocks.presentFrameStack,
}));

vi.mock('../../src/services/render/workerGpuVideoFrameLayerPresenter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuVideoFrameLayerPresenter')>()),
  presentGpuVideoFrameLayers: raceMocks.presentLayers,
}));

vi.mock('../../src/services/render/workerGpuVideoFramePresenter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerGpuVideoFramePresenter')>()),
  presentGpuVideoFrame: raceMocks.presentSingle,
}));

vi.mock('../../src/services/render/workerRenderHostRuntimeWebCodecs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/render/workerRenderHostRuntimeWebCodecs')>()),
  readWorkerWebCodecsVideoFrameForGpuPresentation: raceMocks.readFrame,
}));

import {
  workerRenderHostRuntimeHandler,
  type WorkerRenderHostRuntimeJobInput,
  type WorkerRenderHostRuntimeJobOutput,
} from '../../src/services/render/workerRenderHostRuntimeHandlers';

const TARGET_ID = 'preview:md7-runtime-race';
const SOURCE_ID = 'timeline-media:montage';
const ADMISSION_MS = 10_050;
const EXPIRE_AFTER_MS = 10_100;

class FakeImageBitmap {
  readonly close = vi.fn();

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

function runtimeContext() {
  return {
    signal: new AbortController().signal,
    log: vi.fn(),
    progress: vi.fn(),
    diagnostic: vi.fn(),
  } as unknown as Parameters<typeof workerRenderHostRuntimeHandler>[1];
}

async function send(
  command: WorkerRenderHostRuntimeCommand,
  inputNowMs = 1,
) {
  return workerRenderHostRuntimeHandler({
    command,
    sentAtMs: inputNowMs,
    nowMs: inputNowMs,
  } satisfies WorkerRenderHostRuntimeJobInput, runtimeContext());
}

function createCanvas(width = 320, height = 180): OffscreenCanvas {
  return { width, height } as OffscreenCanvas;
}

function createSurface(canvas: OffscreenCanvas, device = {} as GPUDevice): WorkerGpuTargetSurface {
  return {
    kind: 'worker-gpu-target-surface',
    canvas,
    context: {} as GPUCanvasContext,
    adapter: null,
    device,
    format: 'rgba8unorm',
    alphaMode: 'premultiplied',
    colorSpace: 'srgb',
    deviceDiagnostics: null,
    diagnostics: {} as WorkerGpuTargetSurface['diagnostics'],
    frameSequence: 0,
  };
}

function createRenderLayer(layerId: string) {
  return {
    id: `runtime-layer:${layerId}`,
    sourceClipId: layerId,
    name: layerId,
    visible: true,
    opacity: 1,
    blendMode: 'normal' as const,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: 0,
    effects: [],
  };
}

function createLayer(): WorkerGpuWebCodecsFrameLayer {
  return {
    sourceId: SOURCE_ID,
    mediaTime: 8,
    opacity: 1,
    blendMode: 'normal',
    renderLayer: createRenderLayer('montage'),
  };
}

function createFrameStackCommand(options: {
  readonly requestId?: string;
  readonly bitmap?: FakeImageBitmap;
  readonly includeSolid?: boolean;
  readonly includeWebCodecs?: boolean;
  readonly expireAfterMs?: number;
} = {}): WorkerGpuPresentFrameStackCommand {
  const requestId = options.requestId ?? 'request:md7-frame-stack-race';
  const bindings: WorkerGpuFrameStackSourceBinding[] = [];
  if (options.includeSolid) {
    bindings.push({
      layerId: 'solid',
      runtimeSourceKind: 'solid',
      sourceKind: 'timeline-media',
      sourceId: 'timeline:solid',
      renderLayer: createRenderLayer('solid'),
      payload: {
        kind: 'solid',
        color: '#123456',
        width: 320,
        height: 180,
      },
    });
  }
  if (options.bitmap) {
    bindings.push({
      layerId: 'image',
      runtimeSourceKind: 'image',
      sourceKind: 'timeline-media',
      sourceId: 'timeline:image',
      renderLayer: createRenderLayer('image'),
      payload: {
        kind: 'bitmap',
        bitmap: options.bitmap as unknown as ImageBitmap,
        width: options.bitmap.width,
        height: options.bitmap.height,
        ownership: 'transferred-once',
      },
    });
  }
  if (options.includeWebCodecs) {
    bindings.push({
      layerId: 'montage',
      runtimeSourceKind: 'video',
      sourceKind: 'timeline-media',
      sourceId: SOURCE_ID,
      renderLayer: createRenderLayer('montage'),
      payload: {
        kind: 'webcodecs',
        mediaTime: 8,
        width: 320,
        height: 180,
      },
    });
  }

  const stack: WorkerGpuFrameStackContractV1 = {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: `occurrence:${requestId}`,
    dimensions: { width: 320, height: 180 },
    frame: {
      requestId,
      targetId: TARGET_ID,
      compositionId: 'composition:md7-runtime-race',
      timelineTime: 8,
      frameIndex: 240,
      intent: 'preview',
      submitByMs: 10_000,
      expireAfterMs: options.expireAfterMs ?? EXPIRE_AFTER_MS,
      graphVersion: 7,
      exact: true,
    },
    execution: {
      kind: 'ordered-sources',
      bottomToTopLayerIds: bindings.map((binding) => binding.layerId),
    },
    bindings,
  };
  return {
    type: 'gpu.presentFrameStack',
    commandId: requestId,
    admission: {
      nowMs: ADMISSION_MS,
      requestId,
      targetId: TARGET_ID,
      intent: 'preview',
      graphVersion: 7,
    },
    stack,
  };
}

function createNestedWebCodecsFrameStackCommand(
  requestId: string,
): WorkerGpuPresentFrameStackCommand {
  const root = createFrameStackCommand({ requestId, includeWebCodecs: true });
  const nestedLayerId = 'nested';
  const childLayerId = 'nested-montage';
  const childCompositionId = 'composition:md7-runtime-race-child';
  const childNamespace = createWorkerGpuNestedOccurrenceNamespace(
    root.stack.occurrenceNamespace,
    nestedLayerId,
  );
  const childStack: WorkerGpuFrameStackContractV1 = {
    contractVersion: WORKER_GPU_FRAME_STACK_CONTRACT_VERSION,
    frameMode: 'exact-one-shot',
    occurrenceNamespace: childNamespace,
    dimensions: { ...root.stack.dimensions },
    frame: {
      ...root.stack.frame,
      compositionId: childCompositionId,
      timelineTime: 4,
    },
    execution: {
      kind: 'ordered-sources',
      bottomToTopLayerIds: [childLayerId],
    },
    bindings: [{
      layerId: childLayerId,
      runtimeSourceKind: 'video',
      sourceKind: 'timeline-media',
      sourceId: SOURCE_ID,
      renderLayer: createRenderLayer(childLayerId),
      payload: {
        kind: 'webcodecs',
        mediaTime: 9,
        width: 320,
        height: 180,
      },
    }],
  };
  return {
    ...root,
    stack: {
      ...root.stack,
      execution: {
        kind: 'ordered-sources',
        bottomToTopLayerIds: ['montage', nestedLayerId],
      },
      bindings: [
        ...root.stack.bindings,
        {
          layerId: nestedLayerId,
          runtimeSourceKind: 'nestedComposition',
          sourceKind: 'nested-composition',
          sourceId: `nested-composition:${childCompositionId}`,
          renderLayer: createRenderLayer(nestedLayerId),
          payload: {
            kind: 'nested-stack',
            reference: {
              sourceId: `nested-composition:${childCompositionId}`,
              compositionId: childCompositionId,
              localTimelineTime: 4,
              occurrenceNamespace: childNamespace,
            },
            stack: childStack,
          },
        },
      ],
    },
  };
}

interface DistinguishableFramePair {
  readonly borrowed: VideoFrame;
  readonly borrowedClose: ReturnType<typeof vi.fn>;
  readonly clone: ReturnType<typeof vi.fn>;
  readonly owned: VideoFrame;
  readonly ownedClose: ReturnType<typeof vi.fn>;
}

function distinguishableFramePair(
  timestampSeconds: number,
  label: string,
): DistinguishableFramePair {
  const ownedClose = vi.fn();
  const owned = {
    testFrameId: `owned:${label}`,
    displayWidth: 320,
    displayHeight: 180,
    codedWidth: 320,
    codedHeight: 180,
    timestamp: timestampSeconds * 1_000_000,
    close: ownedClose,
  } as unknown as VideoFrame;
  const borrowedClose = vi.fn();
  const clone = vi.fn(() => owned);
  const borrowed = {
    testFrameId: `borrowed:${label}`,
    displayWidth: 320,
    displayHeight: 180,
    codedWidth: 320,
    codedHeight: 180,
    timestamp: timestampSeconds * 1_000_000,
    clone,
    close: borrowedClose,
  } as unknown as VideoFrame;
  return { borrowed, borrowedClose, clone, owned, ownedClose };
}

function createFrame(timestampSeconds: number): VideoFrame {
  return distinguishableFramePair(timestampSeconds, `frame:${timestampSeconds}`).borrowed;
}

function frameRead(
  timestampSeconds: number,
  frame = createFrame(timestampSeconds),
): WorkerWebCodecsGpuFrameReadResult {
  return {
    status: null,
    frame,
    width: 320,
    height: 180,
    timestampSeconds,
    error: null,
  };
}

function presentResult(presentedFrameId: string): WorkerGpuPresentResult {
  return {
    ok: true,
    diagnostics: {
      status: 'presented',
      targetId: TARGET_ID,
      requestId: presentedFrameId,
      frameIndex: 1,
      presentedFrameId,
      canvasWidth: 320,
      canvasHeight: 180,
      format: 'rgba8unorm',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      commandEncoderCreated: true,
      renderPassEnded: true,
      commandSubmitted: true,
      submittedWorkDoneResolved: true,
      error: null,
    },
  };
}

function adjustmentPlan(): MotionAdjustmentWorkerGpuExecutionPlan {
  const packet = planMotionAdjustmentOperations(createTwoAdjustmentFixture());
  return planMotionAdjustmentWorkerGpuExecution(packet, 'preview', {
    deadline: {
      requestId: 'request:md7-expiry-race',
      targetId: TARGET_ID,
      compositionId: packet.compositionId,
      timelineTime: packet.evaluationTime,
      frameIndex: 300,
      intent: 'preview',
      submitByMs: 10_000,
      expireAfterMs: EXPIRE_AFTER_MS,
      exact: true,
    },
    graphVersion: 7,
    resourceNamespace: 'md7-runtime-race',
  });
}

async function initializeAndAttach(canvas = createCanvas()): Promise<void> {
  await send({
    type: 'initialize',
    rendererId: 'md7-runtime-race',
    strategy: 'worker-webgpu-present',
  });
  await send({
    type: 'attachTargetSurface',
    surface: {
      targetId: TARGET_ID,
      canvas,
      presentation: 'main-canvas',
    },
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function statsEvent(output: WorkerRenderHostRuntimeJobOutput) {
  return output.statusEvents.find((event) => event.type === 'stats');
}

describe('MD7 Worker GPU runtime races', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ADMISSION_MS);
    raceMocks.createSurface.mockReset();
    raceMocks.presentComposited.mockReset();
    raceMocks.presentFrameStack.mockReset();
    raceMocks.presentLayers.mockReset();
    raceMocks.presentSingle.mockReset();
    raceMocks.readFrame.mockReset();
    raceMocks.createSurface.mockImplementation(async (
      options: { readonly canvas: OffscreenCanvas },
    ) => ({
      ok: true,
      surface: createSurface(options.canvas),
      diagnostics: { status: 'ready', error: null },
    }));
    raceMocks.presentComposited.mockResolvedValue(presentResult('present:initial'));
    raceMocks.presentFrameStack.mockResolvedValue(presentResult('present:frame-stack'));
    raceMocks.presentLayers.mockResolvedValue(presentResult('present:initial'));
    raceMocks.presentSingle.mockResolvedValue(presentResult('present:initial'));
  });

  afterEach(async () => {
    await send({ type: 'dispose', reason: 'MD7 runtime race test cleanup' });
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects an exact adjustment plan that expires while its WebCodecs frame read is pending', async () => {
    const plan = adjustmentPlan();
    const pendingRead = deferred<WorkerWebCodecsGpuFrameReadResult>();
    raceMocks.readFrame.mockReturnValue(pendingRead.promise);
    await initializeAndAttach();

    const pendingPresentation = send({
      type: 'gpu.presentWebCodecsFrame',
      commandId: plan.frame.requestId,
      targetId: plan.frame.targetId,
      compositionId: plan.frame.compositionId,
      sourceId: SOURCE_ID,
      timelineTime: plan.frame.timelineTime,
      mediaTime: 8,
      frameIndex: plan.frame.frameIndex,
      mode: 'advance',
      layers: [createLayer()],
      adjustmentPlan: plan,
    });

    expect(raceMocks.readFrame).toHaveBeenCalledOnce();
    vi.setSystemTime(EXPIRE_AFTER_MS);
    pendingRead.resolve(frameRead(8));
    const result = await pendingPresentation;

    expect(result.output.presentedFrameId).toBeNull();
    expect(result.output.statusEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('[MD7_ADJUSTMENT_PLAN_EXPIRED]'),
      recoverable: false,
    }));
    expect(raceMocks.presentComposited).not.toHaveBeenCalled();
    expect(raceMocks.presentLayers).not.toHaveBeenCalled();
    expect(raceMocks.presentSingle).not.toHaveBeenCalled();
  });

  it('rejects expired and invalid frame stacks before decode and closes each transferred bitmap once', async () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const expiredBitmap = new FakeImageBitmap(320, 180);
    const expired = createFrameStackCommand({
      requestId: 'request:md7-frame-stack-expired',
      bitmap: expiredBitmap,
      includeWebCodecs: true,
    });

    vi.setSystemTime(EXPIRE_AFTER_MS);
    const expiredResult = await send(expired, 1);

    expect(expiredResult.output.statusEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('[MD7_FRAME_STACK_FRAME_EXPIRED]'),
    }));
    expect(expiredBitmap.close).toHaveBeenCalledOnce();
    expect(raceMocks.readFrame).not.toHaveBeenCalled();
    expect(raceMocks.presentFrameStack).not.toHaveBeenCalled();

    vi.setSystemTime(ADMISSION_MS);
    const invalidBitmap = new FakeImageBitmap(320, 180);
    const validEnvelope = createFrameStackCommand({
      requestId: 'request:md7-frame-stack-invalid',
      bitmap: invalidBitmap,
      includeWebCodecs: true,
    });
    const invalid: WorkerGpuPresentFrameStackCommand = {
      ...validEnvelope,
      stack: {
        ...validEnvelope.stack,
        execution: {
          kind: 'ordered-sources',
          bottomToTopLayerIds: ['image'],
        },
      },
    };

    const invalidResult = await send(invalid, 999_999);

    expect(invalidResult.output.statusEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('[MD7_FRAME_STACK_PLAN_BINDING_MISMATCH]'),
    }));
    expect(invalidBitmap.close).toHaveBeenCalledOnce();
    expect(raceMocks.readFrame).not.toHaveBeenCalled();
    expect(raceMocks.presentFrameStack).not.toHaveBeenCalled();
  });

  it('delegates a valid solid-only stack and emits its lifecycle and frame events', async () => {
    await initializeAndAttach();
    const command = createFrameStackCommand({
      requestId: 'request:md7-frame-stack-solid',
      includeSolid: true,
    });

    const result = await send(command);

    expect(raceMocks.presentFrameStack).toHaveBeenCalledOnce();
    const [surface, options] = raceMocks.presentFrameStack.mock.calls[0] ?? [];
    expect(surface).toMatchObject({
      kind: 'worker-gpu-target-surface',
      presentation: 'main-canvas',
    });
    expect(options.command).toBe(command);
    expect(options.webCodecsFrames).toBeInstanceOf(Map);
    expect(options.webCodecsFrames.size).toBe(0);
    expect(options.clock()).toBe(ADMISSION_MS);
    expect(options.isSurfaceCurrent()).toBe(true);
    expect(result.output.presentedFrameId).toBe('present:frame-stack');
    expect(result.output.statusEvents).toContainEqual({
      type: 'command-accepted',
      commandType: 'gpu.presentFrameStack',
      requestId: command.commandId,
      presentation: 'main-canvas',
    });
    expect(result.output.statusEvents).toContainEqual({
      type: 'frame-presented',
      requestId: command.commandId,
      targetId: TARGET_ID,
      timelineTime: 8,
    });
    expect(statsEvent(result.output)?.stats).toMatchObject({
      'workerGpu.frameStack.presented': true,
      'workerGpu.frameStack.bindingCount': 1,
      'workerGpu.frameStack.intent': 'preview',
    });
  });

  it.each(['completion', 'failure'] as const)(
    'serializes same-source nested WebCodecs reads and releases owned clones after GPU %s',
    async (outcome) => {
      const firstRead = deferred<WorkerWebCodecsGpuFrameReadResult>();
      const secondRead = deferred<WorkerWebCodecsGpuFrameReadResult>();
      const gpuPresentation = deferred<WorkerGpuPresentResult>();
      const first = distinguishableFramePair(8, `${outcome}:first`);
      const second = distinguishableFramePair(9, `${outcome}:second`);
      let delegatedFrames: ReadonlyMap<string, {
        readonly sourceId: string;
        readonly mediaTime: number;
        readonly frame: VideoFrame;
        readonly timestampSeconds: number;
      }> | undefined;
      raceMocks.readFrame.mockImplementation((input: { readonly timeSeconds: number }) => {
        if (input.timeSeconds === 8) return firstRead.promise;
        if (input.timeSeconds === 9) return secondRead.promise;
        throw new Error(`Unexpected media time ${input.timeSeconds}`);
      });
      raceMocks.presentFrameStack.mockImplementation((
        _surface,
        options: { readonly webCodecsFrames: typeof delegatedFrames },
      ) => {
        delegatedFrames = options.webCodecsFrames;
        return gpuPresentation.promise;
      });
      await initializeAndAttach();
      const command = createNestedWebCodecsFrameStackCommand(
        `request:md7-frame-stack-same-source-${outcome}`,
      );

      const pendingPresentation = send(command);
      expect(raceMocks.readFrame).toHaveBeenCalledOnce();
      expect(raceMocks.readFrame).toHaveBeenLastCalledWith({
        sourceId: SOURCE_ID,
        timeSeconds: 8,
        mode: 'seek',
      });

      firstRead.resolve(frameRead(8, first.borrowed));
      await flushMicrotasks();

      expect(first.clone).toHaveBeenCalledOnce();
      expect(raceMocks.readFrame).toHaveBeenCalledTimes(2);
      expect(raceMocks.readFrame).toHaveBeenLastCalledWith({
        sourceId: SOURCE_ID,
        timeSeconds: 9,
        mode: 'seek',
      });
      expect(first.clone.mock.invocationCallOrder[0])
        .toBeLessThan(raceMocks.readFrame.mock.invocationCallOrder[1]);

      secondRead.resolve(frameRead(9, second.borrowed));
      await flushMicrotasks();

      expect(second.clone).toHaveBeenCalledOnce();
      expect(raceMocks.presentFrameStack).toHaveBeenCalledOnce();
      expect(delegatedFrames).toBeInstanceOf(Map);
      const resolvedFrames = [...(delegatedFrames?.values() ?? [])];
      expect(resolvedFrames).toEqual([
        expect.objectContaining({
          sourceId: SOURCE_ID,
          mediaTime: 8,
          timestampSeconds: 8,
          frame: first.owned,
        }),
        expect.objectContaining({
          sourceId: SOURCE_ID,
          mediaTime: 9,
          timestampSeconds: 9,
          frame: second.owned,
        }),
      ]);
      expect(first.ownedClose).not.toHaveBeenCalled();
      expect(second.ownedClose).not.toHaveBeenCalled();
      expect(first.borrowedClose).not.toHaveBeenCalled();
      expect(second.borrowedClose).not.toHaveBeenCalled();

      gpuPresentation.resolve(outcome === 'completion'
        ? presentResult('present:same-source-clones')
        : {
            ...presentResult('present:unused'),
            ok: false,
            diagnostics: {
              ...presentResult('present:unused').diagnostics,
              status: 'present-failed',
              presentedFrameId: null,
              submittedWorkDoneResolved: false,
              error: 'Synthetic GPU failure after frame-stack delegation',
            },
          });
      const result = await pendingPresentation;

      expect(result.output.presentedFrameId).toBe(
        outcome === 'completion' ? 'present:same-source-clones' : null,
      );
      expect(first.ownedClose).toHaveBeenCalledOnce();
      expect(second.ownedClose).toHaveBeenCalledOnce();
      expect(first.borrowedClose).not.toHaveBeenCalled();
      expect(second.borrowedClose).not.toHaveBeenCalled();
    },
  );

  it('revalidates with the Worker clock after WebCodecs decode crosses the frame deadline', async () => {
    const pendingRead = deferred<WorkerWebCodecsGpuFrameReadResult>();
    raceMocks.readFrame.mockReturnValue(pendingRead.promise);
    await initializeAndAttach();
    const command = createFrameStackCommand({
      requestId: 'request:md7-frame-stack-decode-expiry',
      includeWebCodecs: true,
    });

    const pendingPresentation = send(command, 1);
    expect(raceMocks.readFrame).toHaveBeenCalledOnce();
    vi.setSystemTime(EXPIRE_AFTER_MS);
    const borrowedRead = frameRead(8);
    pendingRead.resolve(borrowedRead);
    const result = await pendingPresentation;

    expect(result.output.presentedFrameId).toBeNull();
    expect(result.output.statusEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('[MD7_FRAME_STACK_FRAME_EXPIRED]'),
    }));
    expect(raceMocks.presentFrameStack).not.toHaveBeenCalled();
    expect(borrowedRead.frame?.close).not.toHaveBeenCalled();
  });

  it.each(['detach', 'replace'] as const)(
    'does not present a frame stack when its target is %s during decode and preserves exact ownership',
    async (mutation) => {
      vi.stubGlobal('ImageBitmap', FakeImageBitmap);
      const transferredBitmap = new FakeImageBitmap(320, 180);
      const decodedRead = frameRead(8);
      const pendingRead = deferred<WorkerWebCodecsGpuFrameReadResult>();
      raceMocks.readFrame.mockReturnValue(pendingRead.promise);
      await initializeAndAttach();
      const command = createFrameStackCommand({
        requestId: `request:md7-frame-stack-${mutation}`,
        bitmap: transferredBitmap,
        includeWebCodecs: true,
      });

      const pendingPresentation = send(command);
      expect(raceMocks.readFrame).toHaveBeenCalledOnce();
      if (mutation === 'detach') {
        await send({ type: 'detachTargetSurface', targetId: TARGET_ID });
      } else {
        await send({
          type: 'attachTargetSurface',
          surface: {
            targetId: TARGET_ID,
            canvas: createCanvas(640, 360),
            presentation: 'main-canvas',
          },
        });
      }
      pendingRead.resolve(decodedRead);
      const result = await pendingPresentation;

      expect(result.output.presentedFrameId).toBeNull();
      expect(result.output.statusEvents).toContainEqual(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining(`target surface '${TARGET_ID}' changed during frame decode`),
      }));
      expect(raceMocks.presentFrameStack).not.toHaveBeenCalled();
      expect(transferredBitmap.close).toHaveBeenCalledOnce();
      expect(decodedRead.frame?.close).not.toHaveBeenCalled();
    },
  );

  it.each(['detach', 'replace', 'dispose'] as const)(
    'does not present or publish stale stream state when the target is %s during a frame read',
    async (mutation) => {
      const pendingTickRead = deferred<WorkerWebCodecsGpuFrameReadResult>();
      raceMocks.readFrame
        .mockResolvedValueOnce(frameRead(1))
        .mockReturnValueOnce(pendingTickRead.promise);
      await initializeAndAttach();

      const started = await send({
        type: 'gpu.startWebCodecsStream',
        commandId: 'stream:md7-runtime-race',
        targetId: TARGET_ID,
        sourceId: SOURCE_ID,
        timelineTime: 1,
        mediaTime: 1,
        frameIndex: 30,
        playbackRate: 1,
        targetFps: 30,
        timeoutMs: 48,
        layers: [createLayer()],
      });
      const initialStats = statsEvent(started.output);
      expect(initialStats?.stats).toMatchObject({
        'workerGpu.videoFrame.workerStream.presentedFrameCount': 1,
        'workerGpu.videoFrame.timestampSeconds': 1,
      });
      expect(raceMocks.presentComposited).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(40);
      expect(raceMocks.readFrame).toHaveBeenCalledTimes(2);

      if (mutation === 'detach') {
        await send({ type: 'detachTargetSurface', targetId: TARGET_ID });
      } else if (mutation === 'dispose') {
        await send({ type: 'dispose', reason: 'dispose during deferred stream read' });
      } else {
        await send({
          type: 'attachTargetSurface',
          surface: {
            targetId: TARGET_ID,
            canvas: createCanvas(640, 360),
            presentation: 'main-canvas',
          },
        });
      }

      pendingTickRead.resolve(frameRead(2));
      await flushMicrotasks();

      expect(raceMocks.presentComposited).toHaveBeenCalledOnce();
      expect(raceMocks.presentLayers).not.toHaveBeenCalled();
      expect(raceMocks.presentSingle).not.toHaveBeenCalled();

      const collected = await send({ type: 'collectStats', requestId: `stats:${mutation}` });
      const currentStats = statsEvent(collected.output);
      if (mutation === 'replace') {
        expect(currentStats?.stats).toMatchObject({
          'workerGpu.videoFrame.workerStream.presentedFrameCount': 1,
          'workerGpu.videoFrame.timestampSeconds': 1,
        });
      } else {
        expect(currentStats).toBeUndefined();
      }
      expect(collected.output.presentedFrameId).not.toBe('present:stale');
    },
  );

  it('keeps the real layer-presenter release idempotent after one texture destroy throws', async () => {
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 });
    vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    const destroyA = vi.fn(() => {
      throw new Error('texture A destroy failed');
    });
    const destroyB = vi.fn();
    const persistentTextures = [
      { createView: vi.fn(() => ({})), destroy: destroyA },
      { createView: vi.fn(() => ({})), destroy: destroyB },
    ];
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const device = {
      queue: {
        writeBuffer: vi.fn(),
        submit: vi.fn(),
      },
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
      createSampler: vi.fn(() => ({})),
      createTexture: vi.fn(() => persistentTextures.shift()!),
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createCommandEncoder: vi.fn(() => ({
        beginRenderPass: vi.fn(() => pass),
        finish: vi.fn(() => ({})),
      })),
      createBindGroup: vi.fn(() => ({})),
      importExternalTexture: vi.fn(() => ({})),
    } as unknown as GPUDevice;
    const surface = createSurface(createCanvas(), device);
    (surface as { context: GPUCanvasContext }).context = {
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })),
    } as unknown as GPUCanvasContext;
    const actualPresenter = await vi.importActual<
      typeof import('../../src/services/render/workerGpuVideoFrameLayerPresenter')
    >('../../src/services/render/workerGpuVideoFrameLayerPresenter');

    const presented = await actualPresenter.presentGpuVideoFrameLayers(surface, {
      targetId: TARGET_ID,
      requestId: 'release-idempotency',
      frameIndex: 1,
      layers: [{
        sourceId: SOURCE_ID,
        frame: createFrame(1),
        opacity: 1,
        blendMode: 'normal',
      }],
    });
    expect(presented.ok).toBe(true);

    expect(() => actualPresenter.releaseWorkerGpuVideoFrameLayerPresenterResources(surface))
      .not.toThrow();
    expect(destroyA).toHaveBeenCalledOnce();
    expect(destroyB).toHaveBeenCalledOnce();

    actualPresenter.releaseWorkerGpuVideoFrameLayerPresenterResources(surface);
    expect(destroyA).toHaveBeenCalledOnce();
    expect(destroyB).toHaveBeenCalledOnce();
  });

  it('fails closed when real compositor resources are released before ready continuation', async () => {
    vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
    vi.stubGlobal('GPUBufferUsage', { COPY_DST: 1, MAP_READ: 2 });
    vi.stubGlobal('GPUTextureUsage', {
      RENDER_ATTACHMENT: 1,
      TEXTURE_BINDING: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
    });
    const whiteMaskDestroy = vi.fn();
    const createTexture = vi.fn(() => ({
      createView: vi.fn(() => ({})),
      destroy: whiteMaskDestroy,
    }));
    const device = {
      queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createTexture,
      createSampler: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
    } as unknown as GPUDevice;
    const surface = createSurface(createCanvas(), device);
    const actualCompositor = await vi.importActual<
      typeof import('../../src/services/render/workerGpuVideoFrameCompositor')
    >('../../src/services/render/workerGpuVideoFrameCompositor');

    const pendingPresentation = actualCompositor.presentGpuVideoFrameCompositedLayers(surface, {
      targetId: TARGET_ID,
      requestId: 'release-before-ready',
      frameIndex: 1,
      layers: [{
        sourceId: SOURCE_ID,
        frame: createFrame(1),
        opacity: 1,
        blendMode: 'normal',
      }],
    });
    actualCompositor.releaseWorkerGpuVideoFrameCompositorResources(surface);
    const result = await pendingPresentation;

    expect(result.ok).toBe(false);
    expect(result.diagnostics.error).toContain(
      'Worker GPU compositor resources were released during initialization',
    );
    expect(createTexture).toHaveBeenCalledOnce();
    expect(whiteMaskDestroy).toHaveBeenCalledOnce();

    actualCompositor.releaseWorkerGpuVideoFrameCompositorResources(surface);
    expect(whiteMaskDestroy).toHaveBeenCalledOnce();
  });
});
