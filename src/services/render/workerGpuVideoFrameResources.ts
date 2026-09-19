import { EffectsPipeline } from '../../effects/EffectsPipeline';
import { ColorPipeline } from '../../engine/color/ColorPipeline';
import { MotionRenderer } from '../../engine/motion/MotionRenderer';
import { CompositorPipeline } from '../../engine/pipeline/CompositorPipeline';
import { Compositor } from '../../engine/render/Compositor';
import { MaskTextureManager } from '../../engine/texture/MaskTextureManager';
import type {
  WorkerGpuPresentDiagnostics,
  WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';

export interface WorkerGpuCompositorResources {
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

function createRenderTexture(
  surface: WorkerGpuTargetSurface,
  width: number,
  height: number,
): GPUTexture {
  return surface.device.createTexture({
    size: { width, height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.STORAGE_BINDING,
  });
}

function destroyTexture(texture: GPUTexture | null): void {
  try {
    texture?.destroy();
  } catch {
    // Best-effort cleanup only.
  }
}

export function destroyWorkerGpuResource(resource: { destroy(): void }): void {
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
    layout: surface.device.createPipelineLayout({ bindGroupLayouts: [displayBindGroupLayout] }),
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
    layout: surface.device.createPipelineLayout({ bindGroupLayouts: [displayBindGroupLayout] }),
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
    destroyWorkerGpuResource(compositorPipeline);
    destroyWorkerGpuResource(effectsPipeline);
    destroyWorkerGpuResource(colorPipeline);
    destroyWorkerGpuResource(maskTextureManager);
    destroyWorkerGpuResource(motionRenderer);
    throw new Error('Worker GPU compositor resources were released during initialization');
  });
  resourcesBySurface.set(surface, resources);
  return resources;
}

function ensureRenderTextures(
  surface: WorkerGpuTargetSurface,
  resources: WorkerGpuCompositorResources,
): void {
  const width = Math.max(1, Math.floor(surface.canvas.width));
  const height = Math.max(1, Math.floor(surface.canvas.height));
  if (
    resources.width === width
    && resources.height === height
    && resources.pingTexture
    && resources.pongTexture
    && resources.effectTempTexture
    && resources.effectTempTexture2
    && resources.exactFrameTexture
  ) return;

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

export async function getWorkerGpuCompositorResources(
  surface: WorkerGpuTargetSurface,
): Promise<WorkerGpuCompositorResources> {
  const resources = resourcesBySurface.get(surface) ?? createResources(surface);
  await resources.ready;
  ensureRenderTextures(surface, resources);
  return resources;
}

export function createWorkerGpuPresentDiagnostics(input: {
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

/** Releases all device-owned resources cached for a detached Worker target. */
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
  destroyWorkerGpuResource(resources.compositorPipeline);
  destroyWorkerGpuResource(resources.effectsPipeline);
  destroyWorkerGpuResource(resources.colorPipeline);
  destroyWorkerGpuResource(resources.maskTextureManager);
  destroyWorkerGpuResource(resources.motionRenderer);
}
