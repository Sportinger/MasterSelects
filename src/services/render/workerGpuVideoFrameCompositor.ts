import type { LayerRenderData } from '../../engine/core/types';
import {
  createMotionFrameRuntimeAdmission,
  describeMotionFrameRuntimeFailure,
} from '../../engine/motion/MotionFrameRuntime';
import {
  assertMotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuExecutionPlan,
} from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import {
  encodeWorkerGpuAdjustmentMasks,
} from './workerGpuAdjustmentMaskRenderer';
import {
  encodeWorkerGpuAdjustmentPlan,
  type WorkerGpuAdjustmentSourceFrame,
} from './workerGpuAdjustmentPlanExecutor';
import type {
  WorkerGpuPresentBaseOptions,
  WorkerGpuPresentResult,
  WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';
import type { WorkerGpuVideoFramePresentLayer } from './workerGpuVideoFrameLayerPresenter';
import {
  buildWorkerGpuRenderLayer,
  getWorkerGpuVideoFrameDimensions,
  isWorkerGpuImageBitmapFrame,
} from './workerGpuVideoFrameLayerAdapter';
import {
  encodeWorkerGpuFrameStack,
  type WorkerGpuFrameStackExecution,
} from './workerGpuFrameStackExecutor';
import type {
  WorkerGpuFrameStackMotionRendererInput,
  WorkerGpuFrameStackWebCodecsResolverInput,
} from './workerGpuFrameStackMaterializer';
import type {
  WorkerGpuFrameStackReadbackRequest,
  WorkerGpuPresentFrameStackCommand,
} from './workerGpuRuntimeCommands';
import { closeWorkerGpuFrameStackTransferables } from './workerGpuFrameStackContract';
import {
  createWorkerGpuPresentDiagnostics as createPresentDiagnostics,
  destroyWorkerGpuResource,
  getWorkerGpuCompositorResources,
  type WorkerGpuCompositorResources,
} from './workerGpuVideoFrameResources';

export { releaseWorkerGpuVideoFrameCompositorResources } from './workerGpuVideoFrameResources';
export { hasCompositorRenderLayer } from './workerGpuVideoFrameLayerAdapter';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


export interface WorkerGpuFrameStackWebCodecsFrame {
  readonly sourceId: string;
  readonly mediaTime: number;
  readonly frame: VideoFrame;
  readonly width: number;
  readonly height: number;
  readonly timestampSeconds: number | null;
}

export function createWorkerGpuFrameStackWebCodecsKey(
  sourceId: string,
  mediaTime: number,
): string {
  return JSON.stringify([sourceId, mediaTime]);
}

function resolveFrameStackWebCodecsSource(
  surface: WorkerGpuTargetSurface,
  frames: ReadonlyMap<string, WorkerGpuFrameStackWebCodecsFrame>,
  input: WorkerGpuFrameStackWebCodecsResolverInput,
): LayerRenderData {
  const frame = frames.get(createWorkerGpuFrameStackWebCodecsKey(
    input.binding.sourceId,
    input.payload.mediaTime,
  ));
  if (
    !frame
    || frame.width !== input.payload.width
    || frame.height !== input.payload.height
  ) {
    throw new Error(`Worker GPU frame-stack source '${input.binding.sourceId}' is unavailable`);
  }
  return {
    layer: input.layer,
    isVideo: true,
    isDynamic: true,
    externalTexture: surface.device.importExternalTexture({
      source: frame.frame,
      colorSpace: surface.colorSpace ?? 'srgb',
    }),
    textureView: null,
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    displayedMediaTime: frame.timestampSeconds ?? undefined,
    targetMediaTime: input.payload.mediaTime,
    previewPath: 'worker-gpu-frame-stack:webcodecs',
  };
}

function renderFrameStackMotionSource(
  surface: WorkerGpuTargetSurface,
  resources: WorkerGpuCompositorResources,
  input: WorkerGpuFrameStackMotionRendererInput,
): LayerRenderData {
  const maxTextureDimension2D = surface.device.limits?.maxTextureDimension2D ?? 8192;
  const admission = createMotionFrameRuntimeAdmission({
    consumer: input.frameStack.frame.intent === 'export' ? 'export' : 'preview',
    compositionId: input.frameStack.frame.compositionId,
    timelineTimeSeconds: input.payload.timelineTime,
    layers: [input.layer],
    deviceMaxTextureDimension2D: maxTextureDimension2D,
    renderTargetMaxTexturePixels: Math.min(
      maxTextureDimension2D * maxTextureDimension2D,
      64 * 1024 * 1024,
    ),
  });
  if (!admission.ok) {
    throw new Error(describeMotionFrameRuntimeFailure(admission) ?? 'Motion frame admission failed');
  }
  const rendered = resources.motionRenderer.renderLayer(
    input.layer,
    input.commandEncoder,
    admission,
  );
  if (!rendered) throw new Error(`Motion source '${input.binding.sourceId}' rendered no pixels`);
  return {
    layer: input.layer,
    isVideo: false,
    isDynamic: true,
    externalTexture: null,
    textureView: rendered.textureView,
    sourceWidth: rendered.width,
    sourceHeight: rendered.height,
    targetMediaTime: input.payload.timelineTime,
    previewPath: 'worker-gpu-frame-stack:motion',
  };
}

const FRAME_STACK_READBACK_BYTES_PER_PIXEL = 4;
const FRAME_STACK_READBACK_ROW_ALIGNMENT = 256;

export interface WorkerGpuFrameStackReadbackLayout {
  readonly unalignedBytesPerRow: number;
  readonly bytesPerRow: number;
  readonly bufferSize: number;
}

export interface WorkerGpuFrameStackReadbackResult {
  readonly request: WorkerGpuFrameStackReadbackRequest;
  readonly pixels: Uint8ClampedArray;
}

export function buildWorkerGpuFrameStackReadbackLayout(
  width: number,
  height: number,
): WorkerGpuFrameStackReadbackLayout {
  const unalignedBytesPerRow = width * FRAME_STACK_READBACK_BYTES_PER_PIXEL;
  const bytesPerRow = Math.ceil(unalignedBytesPerRow / FRAME_STACK_READBACK_ROW_ALIGNMENT)
    * FRAME_STACK_READBACK_ROW_ALIGNMENT;
  return {
    unalignedBytesPerRow,
    bytesPerRow,
    bufferSize: bytesPerRow * height,
  };
}

export function unpackWorkerGpuFrameStackReadback(
  source: Uint8Array,
  width: number,
  height: number,
  layout: WorkerGpuFrameStackReadbackLayout = buildWorkerGpuFrameStackReadbackLayout(width, height),
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * FRAME_STACK_READBACK_BYTES_PER_PIXEL);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * layout.bytesPerRow;
    const targetOffset = row * layout.unalignedBytesPerRow;
    pixels.set(
      source.subarray(sourceOffset, sourceOffset + layout.unalignedBytesPerRow),
      targetOffset,
    );
  }
  return pixels;
}

async function mapWorkerGpuFrameStackReadback(
  buffer: GPUBuffer,
  request: WorkerGpuFrameStackReadbackRequest,
  layout: WorkerGpuFrameStackReadbackLayout,
): Promise<WorkerGpuFrameStackReadbackResult> {
  try {
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    return {
      request,
      pixels: unpackWorkerGpuFrameStackReadback(mapped, request.width, request.height, layout),
    };
  } finally {
    try {
      buffer.unmap();
    } catch {
      // A failed map has no mapped range to release.
    }
    destroyWorkerGpuResource(buffer);
  }
}

export async function presentGpuFrameStack(
  surface: WorkerGpuTargetSurface,
  options: {
    readonly command: WorkerGpuPresentFrameStackCommand;
    readonly clock: () => number;
    readonly webCodecsFrames: ReadonlyMap<string, WorkerGpuFrameStackWebCodecsFrame>;
    readonly isSurfaceCurrent?: () => boolean;
  },
): Promise<WorkerGpuPresentResult & { readonly readback: WorkerGpuFrameStackReadbackResult | null }> {
  const { command } = options;
  const nextSequence = surface.frameSequence + 1;
  const presentedFrameId = `${command.stack.frame.targetId}:${command.commandId}:gpu-frame-stack:${nextSequence}`;
  let execution: WorkerGpuFrameStackExecution | null = null;
  let executorInvocationStarted = false;
  let renderPassEnded = false;
  let commandSubmitted = false;
  let readbackBuffer: GPUBuffer | null = null;
  try {
    if (
      command.stack.dimensions.width !== surface.canvas.width
      || command.stack.dimensions.height !== surface.canvas.height
    ) {
      throw new Error('Worker GPU frame-stack dimensions do not match the target surface');
    }
    const resources = await getWorkerGpuCompositorResources(surface);
    if (options.isSurfaceCurrent && !options.isSurfaceCurrent()) {
      throw new Error('Worker GPU target surface changed before frame-stack encoding');
    }
    executorInvocationStarted = true;
    execution = encodeWorkerGpuFrameStack({
      device: surface.device,
      stack: command.stack,
      admission: { ...command.admission, nowMs: options.clock() },
      clock: options.clock,
      resources: {
        compositorPipeline: resources.compositorPipeline,
        compositor: resources.compositor,
        maskTextureManager: resources.maskTextureManager,
        sampler: resources.sampler,
      },
      sourceResolvers: {
        resolveWebCodecs: (input) => resolveFrameStackWebCodecsSource(
          surface,
          options.webCodecsFrames,
          input,
        ),
        renderMotion: (input) => renderFrameStackMotionSource(surface, resources, input),
      },
    });
    if (!resources.exactFrameTexture || !resources.exactFrameView) {
      throw new Error('Worker GPU exact frame texture is unavailable');
    }
    const exactFrameBindGroup = surface.device.createBindGroup({
      layout: resources.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: resources.sampler },
        { binding: 1, resource: execution.finalView },
      ],
    });
    const exactFramePass = execution.commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: resources.exactFrameView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    exactFramePass.setPipeline(resources.exactFramePipeline);
    exactFramePass.setBindGroup(0, exactFrameBindGroup);
    exactFramePass.draw(6);
    exactFramePass.end();

    const displayBindGroup = surface.device.createBindGroup({
      layout: resources.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: resources.sampler },
        { binding: 1, resource: resources.exactFrameView },
      ],
    });
    const displayPass = execution.commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: surface.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    displayPass.setPipeline(resources.displayPipeline);
    displayPass.setBindGroup(0, displayBindGroup);
    displayPass.draw(6);
    displayPass.end();
    renderPassEnded = true;

    const readbackLayout = command.readback
      ? buildWorkerGpuFrameStackReadbackLayout(command.readback.width, command.readback.height)
      : null;
    if (command.readback && readbackLayout) {
      readbackBuffer = surface.device.createBuffer({
        label: `worker-gpu-frame-stack-readback:${command.readback.readbackId}`,
        size: readbackLayout.bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      execution.commandEncoder.copyTextureToBuffer(
        { texture: resources.exactFrameTexture },
        {
          buffer: readbackBuffer,
          bytesPerRow: readbackLayout.bytesPerRow,
          rowsPerImage: command.readback.height,
        },
        [command.readback.width, command.readback.height],
      );
    }
    const submission = execution.submit();
    commandSubmitted = true;
    await submission;
    const readback = command.readback && readbackBuffer && readbackLayout
      ? await mapWorkerGpuFrameStackReadback(readbackBuffer, command.readback, readbackLayout)
      : null;
    readbackBuffer = null;
    surface.frameSequence = nextSequence;
    surface.diagnostics = { ...surface.diagnostics, lastPresentedFrameId: presentedFrameId };
    return {
      ok: true,
      diagnostics: createPresentDiagnostics({
        status: 'presented',
        surface,
        targetId: command.stack.frame.targetId,
        requestId: command.commandId,
        frameIndex: command.stack.frame.frameIndex,
        presentedFrameId,
        commandEncoderCreated: true,
        renderPassEnded,
        commandSubmitted,
        submittedWorkDoneResolved: true,
        error: null,
      }),
      readback,
    };
  } catch (error) {
    if (!executorInvocationStarted) {
      closeWorkerGpuFrameStackTransferables(command.stack);
    }
    if (readbackBuffer) destroyWorkerGpuResource(readbackBuffer);
    execution?.dispose();
    return {
      ok: false,
      diagnostics: createPresentDiagnostics({
        status: 'present-failed',
        surface,
        targetId: command.stack.frame.targetId,
        requestId: command.commandId,
        frameIndex: command.stack.frame.frameIndex,
        presentedFrameId: null,
        commandEncoderCreated: execution !== null,
        renderPassEnded,
        commandSubmitted,
        submittedWorkDoneResolved: false,
        error: errorMessage(error),
      }),
      readback: null,
    };
  }
}

export async function presentGpuVideoFrameCompositedLayers(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuPresentBaseOptions & {
    readonly layers: readonly WorkerGpuVideoFramePresentLayer[];
    readonly adjustmentPlan?: MotionAdjustmentWorkerGpuExecutionPlan;
    readonly isSurfaceCurrent?: () => boolean;
  },
): Promise<WorkerGpuPresentResult> {
  const targetId = options.targetId ?? 'worker-gpu-target';
  const requestId = options.requestId ?? 'gpu-video-compositor';
  const frameIndex = options.frameIndex ?? surface.frameSequence + 1;
  const nextSequence = surface.frameSequence + 1;
  const presentedFrameId = `${targetId}:${requestId}:gpu-video-composite:${nextSequence}`;
  let commandEncoderCreated = false;
  let renderPassEnded = false;
  let commandSubmitted = false;
  let submittedWorkDoneResolved = false;
  let pass: GPURenderPassEncoder | null = null;
  const uploadedBitmapTextures: GPUTexture[] = [];
  const transientMaskResources: Array<{ destroy(): void }> = [];
  const externalMaskLookupIds: string[] = [];
  let resources: WorkerGpuCompositorResources | null = null;

  try {
    if (options.layers.length === 0) {
      throw new Error('No VideoFrame layers to composite');
    }
    if (options.adjustmentPlan) {
      assertMotionAdjustmentWorkerGpuExecutionPlan(options.adjustmentPlan);
    }
    resources = await getWorkerGpuCompositorResources(surface);
    if (options.isSurfaceCurrent && !options.isSurfaceCurrent()) {
      throw new Error('Worker GPU target surface changed before frame encoding');
    }
    if (
      options.adjustmentPlan
      && Date.now() >= options.adjustmentPlan.frame.expireAfterMs
    ) {
      throw new Error(
        '[MD7_ADJUSTMENT_PLAN_EXPIRED] The Worker GPU adjustment plan expired before frame encoding',
      );
    }
    if (
      !resources.pingView ||
      !resources.pongView ||
      !resources.effectTempTexture ||
      !resources.effectTempView ||
      !resources.effectTempTexture2 ||
      !resources.effectTempView2
    ) {
      throw new Error('Worker GPU compositor render textures are not available');
    }

    const sourceLayerDataByClipId = new Map<string, LayerRenderData>();
    const adjustmentSources: WorkerGpuAdjustmentSourceFrame[] = [];
    for (const frameLayer of options.layers) {
      const dimensions = getWorkerGpuVideoFrameDimensions(frameLayer.frame);
      if (!dimensions) {
        throw new Error('VideoFrame layer has no positive display dimensions');
      }
      const layer = buildWorkerGpuRenderLayer(frameLayer);
      if (!layer.visible || layer.opacity <= 0) continue;
      let externalTexture: GPUExternalTexture | null = null;
      let textureView: GPUTextureView | null = null;
      let isVideo = true;
      if (isWorkerGpuImageBitmapFrame(frameLayer.frame)) {
        const bitmapTexture = surface.device.createTexture({
          size: { width: dimensions.width, height: dimensions.height },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        });
        uploadedBitmapTextures.push(bitmapTexture);
        surface.device.queue.copyExternalImageToTexture(
          { source: frameLayer.frame },
          {
            texture: bitmapTexture,
            colorSpace: surface.colorSpace ?? 'srgb',
            premultipliedAlpha: false,
          },
          { width: dimensions.width, height: dimensions.height },
        );
        textureView = bitmapTexture.createView();
        isVideo = false;
      } else {
        externalTexture = surface.device.importExternalTexture({
          source: frameLayer.frame,
          colorSpace: surface.colorSpace ?? 'srgb',
        });
      }
      const layerData = {
        layer,
        isVideo,
        isDynamic: true,
        externalTexture,
        textureView,
        sourceWidth: dimensions.width,
        sourceHeight: dimensions.height,
        displayedMediaTime: frameLayer.timestampSeconds ?? undefined,
        targetMediaTime: layer.source?.mediaTime,
        previewPath: 'worker-gpu-only:video-frame-compositor',
      } satisfies LayerRenderData;
      const sourceLayerId = layer.sourceClipId ?? layer.id;
      sourceLayerDataByClipId.set(sourceLayerId, layerData);
      adjustmentSources.push({
        layerId: sourceLayerId,
        sourceId: frameLayer.sourceId,
        data: layerData,
      });
    }

    const layerData = [...sourceLayerDataByClipId.values()];

    const commandEncoder = surface.device.createCommandEncoder({
      label: `${targetId}:${requestId}:gpu-video-compositor`,
    });
    commandEncoderCreated = true;
    if (options.adjustmentPlan) {
      const encodedMasks = encodeWorkerGpuAdjustmentMasks(
        options.adjustmentPlan,
        surface.device,
        commandEncoder,
        resources.width,
        resources.height,
      );
      transientMaskResources.push(...encodedMasks.transientResources);
      for (const binding of encodedMasks.bindings) {
        resources.maskTextureManager.setExternalMaskTextureView(binding.maskLookupId, binding.view);
        externalMaskLookupIds.push(binding.maskLookupId);
      }
    }
    let finalView: GPUTextureView;
    if (options.adjustmentPlan) {
      const execution = encodeWorkerGpuAdjustmentPlan({
        plan: options.adjustmentPlan,
        device: surface.device,
        commandEncoder,
        resources: {
          compositorPipeline: resources.compositorPipeline,
          compositor: resources.compositor,
          maskTextureManager: resources.maskTextureManager,
          sampler: resources.sampler,
        },
        sources: adjustmentSources,
        width: resources.width,
        height: resources.height,
      });
      transientMaskResources.push(...execution.transientResources);
      finalView = execution.finalView;
    } else {
      resources.compositorPipeline.beginFrame();
      finalView = resources.compositor.composite(layerData, commandEncoder, {
        device: surface.device,
        sampler: resources.sampler,
        pingView: resources.pingView,
        pongView: resources.pongView,
        outputWidth: resources.width,
        outputHeight: resources.height,
        effectTempTexture: resources.effectTempTexture,
        effectTempView: resources.effectTempView,
        effectTempTexture2: resources.effectTempTexture2,
        effectTempView2: resources.effectTempView2,
        motionTime: options.layers[0]?.timestampSeconds ?? 0,
        particleQuality: 'preview',
      }).finalView;
    }

    const displayBindGroup = surface.device.createBindGroup({
      layout: resources.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: resources.sampler },
        { binding: 1, resource: finalView },
      ],
    });
    pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: surface.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(resources.displayPipeline);
    pass.setBindGroup(0, displayBindGroup);
    pass.draw(6);
    pass.end();
    pass = null;
    renderPassEnded = true;
    surface.device.queue.submit([commandEncoder.finish()]);
    commandSubmitted = true;

    if (typeof surface.device.queue.onSubmittedWorkDone === 'function') {
      await surface.device.queue.onSubmittedWorkDone();
      submittedWorkDoneResolved = true;
    }

    for (const texture of uploadedBitmapTextures) texture.destroy();
    for (const resource of transientMaskResources) resource.destroy();
    for (const lookupId of externalMaskLookupIds) {
      resources.maskTextureManager.removeExternalMaskTextureView(lookupId);
    }
    surface.frameSequence = nextSequence;
    surface.diagnostics = {
      ...surface.diagnostics,
      lastPresentedFrameId: presentedFrameId,
    };
    return {
      ok: true,
      diagnostics: createPresentDiagnostics({
        status: 'presented',
        surface,
        targetId,
        requestId,
        frameIndex,
        presentedFrameId,
        commandEncoderCreated,
        renderPassEnded,
        commandSubmitted,
        submittedWorkDoneResolved,
        error: null,
      }),
    };
  } catch (error) {
    if (pass && !renderPassEnded) {
      try {
        pass.end();
        renderPassEnded = true;
      } catch {
        // Ignore cleanup errors after a failed WebGPU command.
      }
    }
    for (const texture of uploadedBitmapTextures) {
      try {
        texture.destroy();
      } catch {
        // Ignore cleanup errors after a failed WebGPU command.
      }
    }
    for (const resource of transientMaskResources) {
      try {
        resource.destroy();
      } catch {
        // Best-effort transient mask cleanup.
      }
    }
    for (const lookupId of externalMaskLookupIds) {
      resources?.maskTextureManager.removeExternalMaskTextureView(lookupId);
    }
    return {
      ok: false,
      diagnostics: createPresentDiagnostics({
        status: 'present-failed',
        surface,
        targetId,
        requestId,
        frameIndex,
        presentedFrameId: null,
        commandEncoderCreated,
        renderPassEnded,
        commandSubmitted,
        submittedWorkDoneResolved,
        error: errorMessage(error),
      }),
    };
  }
}
