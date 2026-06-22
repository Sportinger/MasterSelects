import { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { LayerRenderData } from '../../engine/core/types';
import { ColorPipeline } from '../../engine/color/ColorPipeline';
import { CompositorPipeline } from '../../engine/pipeline/CompositorPipeline';
import { Compositor } from '../../engine/render/Compositor';
import { MaskTextureManager } from '../../engine/texture/MaskTextureManager';
import type { BlendMode, Layer } from '../../types';
import type {
  WorkerGpuPresentBaseOptions,
  WorkerGpuPresentDiagnostics,
  WorkerGpuPresentResult,
  WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';
import type { WorkerGpuVideoFramePresentLayer } from './workerGpuVideoFrameLayerPresenter';

type WorkerGpuVideoFrameSource = WorkerGpuVideoFramePresentLayer['frame'];

interface WorkerGpuCompositorResources {
  readonly compositorPipeline: CompositorPipeline;
  readonly effectsPipeline: EffectsPipeline;
  readonly colorPipeline: ColorPipeline;
  readonly maskTextureManager: MaskTextureManager;
  readonly compositor: Compositor;
  readonly sampler: GPUSampler;
  readonly displayPipeline: GPURenderPipeline;
  readonly displayBindGroupLayout: GPUBindGroupLayout;
  readonly ready: Promise<void>;
  pingTexture: GPUTexture | null;
  pingView: GPUTextureView | null;
  pongTexture: GPUTexture | null;
  pongView: GPUTextureView | null;
  effectTempTexture: GPUTexture | null;
  effectTempView: GPUTextureView | null;
  effectTempTexture2: GPUTexture | null;
  effectTempView2: GPUTextureView | null;
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
  const compositor = new Compositor(
    compositorPipeline,
    effectsPipeline,
    maskTextureManager,
    colorPipeline,
  );
  const resources: WorkerGpuCompositorResources = {
    compositorPipeline,
    effectsPipeline,
    colorPipeline,
    maskTextureManager,
    compositor,
    sampler,
    displayPipeline,
    displayBindGroupLayout,
    ready: Promise.all([
      compositorPipeline.createPipelines(),
      effectsPipeline.createPipelines(),
      colorPipeline.createPipeline(),
    ]).then(() => undefined),
    pingTexture: null,
    pingView: null,
    pongTexture: null,
    pongView: null,
    effectTempTexture: null,
    effectTempView: null,
    effectTempTexture2: null,
    effectTempView2: null,
    width: 0,
    height: 0,
  };
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
    resources.effectTempTexture2
  ) {
    return;
  }

  destroyTexture(resources.pingTexture);
  destroyTexture(resources.pongTexture);
  destroyTexture(resources.effectTempTexture);
  destroyTexture(resources.effectTempTexture2);
  resources.pingTexture = createRenderTexture(surface, width, height);
  resources.pingView = resources.pingTexture.createView();
  resources.pongTexture = createRenderTexture(surface, width, height);
  resources.pongView = resources.pongTexture.createView();
  resources.effectTempTexture = createRenderTexture(surface, width, height);
  resources.effectTempView = resources.effectTempTexture.createView();
  resources.effectTempTexture2 = createRenderTexture(surface, width, height);
  resources.effectTempView2 = resources.effectTempTexture2.createView();
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

export async function presentGpuVideoFrameCompositedLayers(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuPresentBaseOptions & {
    readonly layers: readonly WorkerGpuVideoFramePresentLayer[];
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

  try {
    if (options.layers.length === 0) {
      throw new Error('No VideoFrame layers to composite');
    }
    const resources = await getResources(surface);
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

    const layerData: LayerRenderData[] = [];
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
        surface.device.queue.copyExternalImageToTexture(
          { source: frameLayer.frame },
          {
            texture: bitmapTexture,
            colorSpace: surface.colorSpace ?? 'srgb',
            premultipliedAlpha: false,
          },
          { width: dimensions.width, height: dimensions.height },
        );
        uploadedBitmapTextures.push(bitmapTexture);
        textureView = bitmapTexture.createView();
        isVideo = false;
      } else {
        externalTexture = surface.device.importExternalTexture({
          source: frameLayer.frame,
          colorSpace: surface.colorSpace ?? 'srgb',
        });
      }
      layerData.push({
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
      });
    }

    const commandEncoder = surface.device.createCommandEncoder({
      label: `${targetId}:${requestId}:gpu-video-compositor`,
    });
    commandEncoderCreated = true;
    resources.compositorPipeline.beginFrame();
    const composite = resources.compositor.composite(layerData, commandEncoder, {
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
    });

    const displayBindGroup = surface.device.createBindGroup({
      layout: resources.displayBindGroupLayout,
      entries: [
        { binding: 0, resource: resources.sampler },
        { binding: 1, resource: composite.finalView },
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
