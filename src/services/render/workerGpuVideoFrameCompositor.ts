import { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { LayerRenderData } from '../../engine/core/types';
import { ColorPipeline } from '../../engine/color/ColorPipeline';
import { CompositorPipeline } from '../../engine/pipeline/CompositorPipeline';
import { Compositor } from '../../engine/render/Compositor';
import { MaskTextureManager } from '../../engine/texture/MaskTextureManager';
import { MotionRenderer } from '../../engine/motion/MotionRenderer';
import {
  createMotionFrameRuntimeAdmission,
  describeMotionFrameRuntimeFailure,
} from '../../engine/motion/MotionFrameRuntime';
import type { BlendMode, Layer } from '../../types';
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
  WorkerGpuPresentDiagnostics,
  WorkerGpuPresentResult,
  WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';
import type { WorkerGpuVideoFramePresentLayer } from './workerGpuVideoFrameLayerPresenter';
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

type WorkerGpuVideoFrameSource = WorkerGpuVideoFramePresentLayer['frame'];

interface WorkerGpuCompositorResources {
  readonly compositorPipeline: CompositorPipeline;
  readonly effectsPipeline: EffectsPipeline;
  readonly colorPipeline: ColorPipeline;
  readonly maskTextureManager: MaskTextureManager;
  readonly compositor: Compositor;
  readonly motionRenderer: MotionRenderer;
  readonly sampler: GPUSampler;
  readonly displayPipeline: GPURenderPipeline;
  readonly exactFramePipeline: GPURenderPipeline;
  readonly displayBindGroupLayout: GPUBindGroupLayout;
  ready: Promise<void>;
  disposed: boolean;
  pingTexture: GPUTexture | null;
  pingView: GPUTextureView | null;
  pongTexture: GPUTexture | null;
  pongView: GPUTextureView | null;
  effectTempTexture: GPUTexture | null;
  effectTempView: GPUTextureView | null;
  effectTempTexture2: GPUTexture | null;
  effectTempView2: GPUTextureView | null;
  exactFrameTexture: GPUTexture | null;
  exactFrameView: GPUTextureView | null;
  width: number;
  height: number;
}

const resourcesBySurface = new WeakMap<WorkerGpuTargetSurface, WorkerGpuCompositorResources>();

const DISPLAY_SHADER = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: VertexOutput;
  out.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(frameTexture, frameSampler, input.uv);
}
`;

const EXACT_FRAME_SHADER = DISPLAY_SHADER.replace(
  'vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),\n    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)',
  'vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),\n    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)',
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRenderTexture(surface: WorkerGpuTargetSurface, width: number, height: number): GPUTexture {
  return surface.device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
}

function destroyTexture(texture: GPUTexture | null): void {
  try {
    texture?.destroy();
  } catch {
    // Best-effort cleanup only.
  }
}

function destroyResource(resource: { destroy(): void }): void {
  try {
    resource.destroy();
  } catch {
    // Teardown must continue after one resource reports a cleanup failure.
  }
}

function createResources(surface: WorkerGpuTargetSurface): WorkerGpuCompositorResources {
  const compositorPipeline = new CompositorPipeline(surface.device);
  const effectsPipeline = new EffectsPipeline(surface.device);
  const colorPipeline = new ColorPipeline(surface.device);
  const maskTextureManager = new MaskTextureManager(surface.device);
  const sampler = surface.device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const displayModule = surface.device.createShaderModule({
    label: 'worker-gpu-video-compositor-display',
    code: DISPLAY_SHADER,
  });
  const exactFrameModule = surface.device.createShaderModule({
    label: 'worker-gpu-video-compositor-exact-frame',
    code: EXACT_FRAME_SHADER,
  });
  const displayBindGroupLayout = surface.device.createBindGroupLayout({
    label: 'worker-gpu-video-compositor-display-layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ],
  });
  const displayPipeline = surface.device.createRenderPipeline({
    label: 'worker-gpu-video-compositor-display-pipeline',
    layout: surface.device.createPipelineLayout({
      bindGroupLayouts: [displayBindGroupLayout],
    }),
    vertex: { module: displayModule, entryPoint: 'vertexMain' },
    fragment: {
      module: displayModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: surface.format }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const exactFramePipeline = surface.device.createRenderPipeline({
    label: 'worker-gpu-video-compositor-exact-frame-pipeline',
    layout: surface.device.createPipelineLayout({
      bindGroupLayouts: [displayBindGroupLayout],
    }),
    vertex: { module: exactFrameModule, entryPoint: 'vertexMain' },
    fragment: {
      module: exactFrameModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const compositor = new Compositor(
    compositorPipeline,
    effectsPipeline,
    maskTextureManager,
    colorPipeline,
  );
  const motionRenderer = new MotionRenderer(surface.device);
  const resources: WorkerGpuCompositorResources = {
    compositorPipeline,
    effectsPipeline,
    colorPipeline,
    maskTextureManager,
    compositor,
    motionRenderer,
    sampler,
    displayPipeline,
    exactFramePipeline,
    displayBindGroupLayout,
    ready: Promise.resolve(),
    disposed: false,
    pingTexture: null,
    pingView: null,
    pongTexture: null,
    pongView: null,
    effectTempTexture: null,
    effectTempView: null,
    effectTempTexture2: null,
    effectTempView2: null,
    exactFrameTexture: null,
    exactFrameView: null,
    width: 0,
    height: 0,
  };
  resources.ready = Promise.all([
    compositorPipeline.createPipelines(),
    effectsPipeline.createPipelines(),
    colorPipeline.createPipeline(),
  ]).then(() => {
    if (!resources.disposed) return;
    // Initialization may complete after teardown and allocate new buffers.
    destroyResource(compositorPipeline);
    destroyResource(effectsPipeline);
    destroyResource(colorPipeline);
    destroyResource(maskTextureManager);
    destroyResource(motionRenderer);
    throw new Error('Worker GPU compositor resources were released during initialization');
  });
  resourcesBySurface.set(surface, resources);
  return resources;
}

async function getResources(surface: WorkerGpuTargetSurface): Promise<WorkerGpuCompositorResources> {
  const resources = resourcesBySurface.get(surface) ?? createResources(surface);
  await resources.ready;
  ensureRenderTextures(surface, resources);
  return resources;
}

function ensureRenderTextures(
  surface: WorkerGpuTargetSurface,
  resources: WorkerGpuCompositorResources,
): void {
  const width = Math.max(1, Math.floor(surface.canvas.width));
  const height = Math.max(1, Math.floor(surface.canvas.height));
  if (
    resources.width === width &&
    resources.height === height &&
    resources.pingTexture &&
    resources.pongTexture &&
    resources.effectTempTexture &&
    resources.effectTempTexture2 &&
    resources.exactFrameTexture
  ) {
    return;
  }

  destroyTexture(resources.pingTexture);
  destroyTexture(resources.pongTexture);
  destroyTexture(resources.effectTempTexture);
  destroyTexture(resources.effectTempTexture2);
  destroyTexture(resources.exactFrameTexture);
  resources.pingTexture = createRenderTexture(surface, width, height);
  resources.pingView = resources.pingTexture.createView();
  resources.pongTexture = createRenderTexture(surface, width, height);
  resources.pongView = resources.pongTexture.createView();
  resources.effectTempTexture = createRenderTexture(surface, width, height);
  resources.effectTempView = resources.effectTempTexture.createView();
  resources.effectTempTexture2 = createRenderTexture(surface, width, height);
  resources.effectTempView2 = resources.effectTempTexture2.createView();
  resources.exactFrameTexture = createRenderTexture(surface, width, height);
  resources.exactFrameView = resources.exactFrameTexture.createView();
  resources.width = width;
  resources.height = height;
}

function positiveInteger(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : 0;
}

function isImageBitmapFrame(frame: WorkerGpuVideoFrameSource): frame is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap;
}

function getVideoFrameDimensions(frame: WorkerGpuVideoFrameSource): { width: number; height: number } | null {
  const image = frame as Partial<ImageBitmap & VideoFrame>;
  const width = positiveInteger(image.displayWidth) || positiveInteger(image.codedWidth) || positiveInteger(image.width);
  const height = positiveInteger(image.displayHeight) || positiveInteger(image.codedHeight) || positiveInteger(image.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

function fallbackRenderLayer(layer: WorkerGpuVideoFramePresentLayer): Layer {
  return {
    id: `worker-gpu:${layer.timestampSeconds ?? 'frame'}`,
    name: 'Worker GPU Video',
    visible: true,
    opacity: layer.opacity,
    blendMode: layer.blendMode as BlendMode,
    source: {
      type: 'video',
      mediaTime: layer.timestampSeconds ?? 0,
    },
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
  };
}

function buildRenderLayer(layer: WorkerGpuVideoFramePresentLayer): Layer {
  const renderLayer = layer.renderLayer;
  if (!renderLayer) return fallbackRenderLayer(layer);
  const mediaTime = layer.mediaTime ?? layer.timestampSeconds ?? 0;
  return {
    id: renderLayer.id,
    name: renderLayer.name,
    sourceClipId: renderLayer.sourceClipId,
    visible: renderLayer.visible,
    opacity: renderLayer.opacity,
    blendMode: renderLayer.blendMode,
    source: {
      type: 'video',
      mediaTime,
      videoRotation: renderLayer.videoRotation,
    },
    effects: renderLayer.effects.map((effect) => ({
      ...effect,
      params: { ...effect.params },
    })),
    colorCorrection: renderLayer.colorCorrection,
    position: { ...renderLayer.position },
    scale: { ...renderLayer.scale },
    rotation: typeof renderLayer.rotation === 'number'
      ? renderLayer.rotation
      : { ...renderLayer.rotation },
    maskFeather: renderLayer.maskFeather,
    maskFeatherQuality: renderLayer.maskFeatherQuality,
    maskInvert: renderLayer.maskInvert,
    maskClipId: renderLayer.maskClipId,
    sourceRect: renderLayer.sourceRect ? { ...renderLayer.sourceRect } : undefined,
    transitionRender: renderLayer.transitionRender
      ? { ...renderLayer.transitionRender }
      : undefined,
  };
}

function createPresentDiagnostics(input: {
  readonly status: 'presented' | 'present-failed';
  readonly surface: WorkerGpuTargetSurface;
  readonly targetId: string;
  readonly requestId: string;
  readonly frameIndex: number;
  readonly presentedFrameId: string | null;
  readonly commandEncoderCreated: boolean;
  readonly renderPassEnded: boolean;
  readonly commandSubmitted: boolean;
  readonly submittedWorkDoneResolved: boolean;
  readonly error: string | null;
}): WorkerGpuPresentDiagnostics {
  return {
    status: input.status,
    targetId: input.targetId,
    requestId: input.requestId,
    frameIndex: input.frameIndex,
    presentedFrameId: input.presentedFrameId,
    canvasWidth: input.surface.canvas.width,
    canvasHeight: input.surface.canvas.height,
    format: input.surface.format,
    clearValue: { r: 0, g: 0, b: 0, a: 1 },
    commandEncoderCreated: input.commandEncoderCreated,
    renderPassEnded: input.renderPassEnded,
    commandSubmitted: input.commandSubmitted,
    submittedWorkDoneResolved: input.submittedWorkDoneResolved,
    error: input.error,
  };
}

export function hasCompositorRenderLayer(
  layers: readonly WorkerGpuVideoFramePresentLayer[],
): boolean {
  return layers.some((layer) => !!layer.renderLayer);
}

/**
 * Releases the device-owned resources cached for a detached Worker target.
 * WeakMap ownership alone is not sufficient here: GPU resources have an
 * explicit lifetime and otherwise survive until the device is collected.
 */
export function releaseWorkerGpuVideoFrameCompositorResources(
  surface: WorkerGpuTargetSurface,
): void {
  const resources = resourcesBySurface.get(surface);
  if (!resources) return;
  resources.disposed = true;
  resourcesBySurface.delete(surface);
  const textures = [
    resources.pingTexture,
    resources.pongTexture,
    resources.effectTempTexture,
    resources.effectTempTexture2,
    resources.exactFrameTexture,
  ];
  resources.pingTexture = null;
  resources.pingView = null;
  resources.pongTexture = null;
  resources.pongView = null;
  resources.effectTempTexture = null;
  resources.effectTempView = null;
  resources.effectTempTexture2 = null;
  resources.effectTempView2 = null;
  resources.exactFrameTexture = null;
  resources.exactFrameView = null;
  resources.width = 0;
  resources.height = 0;
  textures.forEach(destroyTexture);
  destroyResource(resources.compositorPipeline);
  destroyResource(resources.effectsPipeline);
  destroyResource(resources.colorPipeline);
  destroyResource(resources.maskTextureManager);
  destroyResource(resources.motionRenderer);
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
    destroyResource(buffer);
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
    const resources = await getResources(surface);
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
    if (readbackBuffer) destroyResource(readbackBuffer);
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

  try {
    if (options.layers.length === 0) {
      throw new Error('No VideoFrame layers to composite');
    }
    if (options.adjustmentPlan) {
      assertMotionAdjustmentWorkerGpuExecutionPlan(options.adjustmentPlan);
    }
    const resources = await getResources(surface);
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
      const dimensions = getVideoFrameDimensions(frameLayer.frame);
      if (!dimensions) {
        throw new Error('VideoFrame layer has no positive display dimensions');
      }
      const layer = buildRenderLayer(frameLayer);
      if (!layer.visible || layer.opacity <= 0) continue;
      let externalTexture: GPUExternalTexture | null = null;
      let textureView: GPUTextureView | null = null;
      let isVideo = true;
      if (isImageBitmapFrame(frameLayer.frame)) {
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
      resourcesBySurface.get(surface)?.maskTextureManager.removeExternalMaskTextureView(lookupId);
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
