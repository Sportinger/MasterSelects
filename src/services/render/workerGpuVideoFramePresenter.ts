import type {
  WorkerGpuPresentBaseOptions,
  WorkerGpuPresentDiagnostics,
  WorkerGpuPresentResult,
  WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';
import { getCachedWorkerOperatorPipeline, specializeLegacyWorkerLayerShader, uploadWorkerVideoFrameTexture,
  workerTexture2dShader, workerVideoFrameNeedsStraightAlphaUpload } from './workerGpuOperatorPipeline';

interface WorkerGpuVideoFramePresenterResources {
  readonly pipeline: GPURenderPipeline;
  readonly texturePipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
}
interface WorkerGpuVideoFrameLayerPresenterResources {
  readonly compositePipeline: GPURenderPipeline;
  readonly textureCompositePipeline: GPURenderPipeline;
  readonly displayPipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
  readonly operatorPipelines: Map<string, GPURenderPipeline>;
  textureA: GPUTexture | null;
  textureB: GPUTexture | null;
  width: number;
  height: number;
}
interface WorkerGpuVideoFrameDimensions {
  readonly width: number;
  readonly height: number;
}
export interface WorkerGpuVideoFramePresentOptions extends WorkerGpuPresentBaseOptions {
  readonly frame: VideoFrame;
  readonly timestampSeconds?: number | null;
}

export interface WorkerGpuVideoFramePresentLayer {
  readonly frame: VideoFrame;
  readonly timestampSeconds?: number | null;
  readonly opacity: number;
  readonly blendMode: string;
  readonly inlineBrightness?: number;
  readonly inlineContrast?: number;
  readonly inlineSaturation?: number;
  readonly inlineInvert?: boolean;
  readonly operatorProgram?: { readonly key: string; readonly wgsl: string };
}

export interface WorkerGpuVideoFrameLayerPresentOptions extends WorkerGpuPresentBaseOptions {
  readonly layers: readonly WorkerGpuVideoFramePresentLayer[];
}

const VIDEO_FRAME_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frameTexture: texture_external;

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
  return textureSampleBaseClampToEdge(frameTexture, frameSampler, input.uv);
}
`;

const VIDEO_FRAME_LAYER_COMPOSITE_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct LayerParams {
  opacity: f32,
  blendMode: u32,
  inlineBrightness: f32,
  inlineContrast: f32,
  inlineSaturation: f32,
  inlineInvert: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var baseTexture: texture_2d<f32>;
@group(0) @binding(2) var frameTexture: texture_external;
@group(0) @binding(3) var<uniform> layer: LayerParams;

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

fn clampColor(value: vec3f) -> vec3f {
  return clamp(value, vec3f(0.0), vec3f(1.0));
}

fn blendOverlay(base: vec3f, blend: vec3f) -> vec3f {
  let low = 2.0 * base * blend;
  let high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return select(low, high, base >= vec3f(0.5));
}

fn blendSoftLight(base: vec3f, blend: vec3f) -> vec3f {
  let low = base - (1.0 - 2.0 * blend) * base * (1.0 - base);
  let high = base + (2.0 * blend - 1.0) * (sqrt(max(base, vec3f(0.0))) - base);
  return select(low, high, blend >= vec3f(0.5));
}

fn blendColorDodge(base: vec3f, blend: vec3f) -> vec3f {
  return min(base / max(vec3f(0.001), 1.0 - blend), vec3f(1.0));
}

fn blendColorBurn(base: vec3f, blend: vec3f) -> vec3f {
  return 1.0 - min((1.0 - base) / max(vec3f(0.001), blend), vec3f(1.0));
}

fn blendRgb(base: vec3f, blend: vec3f, mode: u32) -> vec3f {
  switch mode {
    case 1u: { return base * blend; }
    case 2u: { return 1.0 - (1.0 - base) * (1.0 - blend); }
    case 3u: { return blendOverlay(base, blend); }
    case 4u: { return min(base, blend); }
    case 5u: { return max(base, blend); }
    case 6u: { return min(base + blend, vec3f(1.0)); }
    case 7u: { return max(base - blend, vec3f(0.0)); }
    case 8u: { return abs(base - blend); }
    case 9u: { return base + blend - 2.0 * base * blend; }
    case 10u: { return blendColorDodge(base, blend); }
    case 11u: { return blendColorBurn(base, blend); }
    case 12u: { return blendOverlay(blend, base); }
    case 13u: { return blendSoftLight(base, blend); }
    case 14u: { return min(base / max(vec3f(0.001), blend), vec3f(1.0)); }
    default: { return blend; }
  }
}

fn luminosity(color: vec3f) -> f32 {
  return dot(color, vec3f(0.299, 0.587, 0.114));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let baseColor = textureSample(baseTexture, frameSampler, input.uv);
  var frameColor = textureSampleBaseClampToEdge(frameTexture, frameSampler, input.uv);
  var adjustedRgb = frameColor.rgb;
  adjustedRgb = select(adjustedRgb, 1.0 - adjustedRgb, layer.inlineInvert == 1u);
  adjustedRgb = clamp(
    (adjustedRgb + layer.inlineBrightness - 0.5) * layer.inlineContrast + 0.5,
    vec3f(0.0),
    vec3f(1.0)
  );
  adjustedRgb = mix(vec3f(luminosity(adjustedRgb)), adjustedRgb, layer.inlineSaturation);
  frameColor = vec4f(clamp(adjustedRgb, vec3f(0.0), vec3f(1.0)), frameColor.a);
  let opacity = clamp(layer.opacity, 0.0, 1.0);
  let alpha = clamp(frameColor.a * opacity, 0.0, 1.0);
  let blended = clampColor(blendRgb(baseColor.rgb, frameColor.rgb, layer.blendMode));
  let outAlpha = alpha + baseColor.a * (1.0 - alpha);
  return vec4f(mix(baseColor.rgb, blended, alpha), outAlpha);
}
`;

const VIDEO_FRAME_LAYER_DISPLAY_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

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

const presenterResourcesBySurface = new WeakMap<WorkerGpuTargetSurface, WorkerGpuVideoFramePresenterResources>();
const layerPresenterResourcesBySurface = new WeakMap<WorkerGpuTargetSurface, WorkerGpuVideoFrameLayerPresenterResources>();


const BLEND_MODE_TO_GPU_INDEX: Record<string, number> = {
  normal: 0,
  dissolve: 0,
  'dancing-dissolve': 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  'darker-color': 4,
  lighten: 5,
  'lighter-color': 5,
  add: 6,
  'linear-dodge': 6,
  subtract: 7,
  'linear-burn': 7,
  difference: 8,
  'classic-difference': 8,
  exclusion: 9,
  'color-dodge': 10,
  'classic-color-dodge': 10,
  'color-burn': 11,
  'classic-color-burn': 11,
  'hard-light': 12,
  'soft-light': 13,
  divide: 14,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : 0;
}

function getVideoFrameDimensions(frame: VideoFrame): WorkerGpuVideoFrameDimensions | null {
  const width = positiveInteger(frame.displayWidth) || positiveInteger(frame.codedWidth);
  const height = positiveInteger(frame.displayHeight) || positiveInteger(frame.codedHeight);
  return width > 0 && height > 0 ? { width, height } : null;
}

function createPresenterResources(surface: WorkerGpuTargetSurface): WorkerGpuVideoFramePresenterResources {
  const module = surface.device.createShaderModule({ code: VIDEO_FRAME_SHADER });
  const pipeline = surface.device.createRenderPipeline({ layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain', buffers: [] },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: surface.format }] },
    primitive: { topology: 'triangle-list' } });
  const textureSource = workerTexture2dShader(VIDEO_FRAME_SHADER);
  const textureModule = surface.device.createShaderModule({ code: textureSource });
  const texturePipeline = surface.device.createRenderPipeline({ layout: 'auto',
    vertex: { module: textureModule, entryPoint: 'vertexMain', buffers: [] },
    fragment: { module: textureModule, entryPoint: 'fragmentMain', targets: [{ format: surface.format }] },
    primitive: { topology: 'triangle-list' } });
  return { pipeline, texturePipeline, sampler: surface.device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) };
}

function createLayerPresenterResources(surface: WorkerGpuTargetSurface): WorkerGpuVideoFrameLayerPresenterResources {
  const compositeModule = surface.device.createShaderModule({ code: VIDEO_FRAME_LAYER_COMPOSITE_SHADER });
  const compositePipeline = surface.device.createRenderPipeline({ layout: 'auto',
    vertex: { module: compositeModule, entryPoint: 'vertexMain', buffers: [] },
    fragment: { module: compositeModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' } });
  const textureCompositePipeline = surface.device.createRenderPipeline({
    layout: 'auto', vertex: { module: surface.device.createShaderModule({ code: workerTexture2dShader(VIDEO_FRAME_LAYER_COMPOSITE_SHADER) }), entryPoint: 'vertexMain' },
    fragment: { module: surface.device.createShaderModule({ code: workerTexture2dShader(VIDEO_FRAME_LAYER_COMPOSITE_SHADER) }), entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const displayModule = surface.device.createShaderModule({ code: VIDEO_FRAME_LAYER_DISPLAY_SHADER });
  const displayPipeline = surface.device.createRenderPipeline({ layout: 'auto',
    vertex: { module: displayModule, entryPoint: 'vertexMain', buffers: [] },
    fragment: { module: displayModule, entryPoint: 'fragmentMain', targets: [{ format: surface.format }] },
    primitive: { topology: 'triangle-list' } });
  return {
    compositePipeline,
    textureCompositePipeline,
    displayPipeline,
    operatorPipelines: new Map(),
    sampler: surface.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    }),
    textureA: null,
    textureB: null,
    width: 0,
    height: 0,
  };
}


function getPresenterResources(surface: WorkerGpuTargetSurface): WorkerGpuVideoFramePresenterResources {
  const existing = presenterResourcesBySurface.get(surface);
  if (existing) return existing;
  const created = createPresenterResources(surface);
  presenterResourcesBySurface.set(surface, created);
  return created;
}

function getLayerPresenterResources(surface: WorkerGpuTargetSurface): WorkerGpuVideoFrameLayerPresenterResources {
  const existing = layerPresenterResourcesBySurface.get(surface);
  const resources = existing ?? createLayerPresenterResources(surface);
  if (!existing) {
    layerPresenterResourcesBySurface.set(surface, resources);
  }
  const width = Math.max(1, Math.floor(surface.canvas.width));
  const height = Math.max(1, Math.floor(surface.canvas.height));
  if (!resources.textureA || !resources.textureB || resources.width !== width || resources.height !== height) {
    resources.textureA?.destroy();
    resources.textureB?.destroy();
    const descriptor: GPUTextureDescriptor = {
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    };
    resources.textureA = surface.device.createTexture(descriptor);
    resources.textureB = surface.device.createTexture(descriptor);
    resources.width = width;
    resources.height = height;
  }
  return resources;
}

function finiteOpacity(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function blendModeIndex(value: string): number {
  return BLEND_MODE_TO_GPU_INDEX[value] ?? 0;
}

function createLayerUniformBuffer(
  surface: WorkerGpuTargetSurface,
  layer: WorkerGpuVideoFramePresentLayer,
): GPUBuffer {
  const buffer = surface.device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const payload = new ArrayBuffer(32);
  const view = new DataView(payload);
  view.setFloat32(0, finiteOpacity(layer.opacity), true);
  view.setUint32(4, blendModeIndex(layer.blendMode), true);
  view.setFloat32(8, finiteNumber(layer.inlineBrightness, 0), true);
  view.setFloat32(12, finiteNumber(layer.inlineContrast, 1), true);
  view.setFloat32(16, finiteNumber(layer.inlineSaturation, 1), true);
  view.setUint32(20, layer.inlineInvert === true ? 1 : 0, true);
  surface.device.queue.writeBuffer(buffer, 0, payload);
  return buffer;
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

export async function presentGpuVideoFrameLayers(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuVideoFrameLayerPresentOptions,
): Promise<WorkerGpuPresentResult> {
  const targetId = options.targetId ?? 'worker-gpu-target';
  const requestId = options.requestId ?? 'gpu-video-frame-layers';
  const frameIndex = options.frameIndex ?? surface.frameSequence + 1;
  const nextSequence = surface.frameSequence + 1;
  const presentedFrameId = `${targetId}:${requestId}:gpu-video-layers:${nextSequence}`;
  let commandEncoderCreated = false;
  let renderPassEnded = false;
  let commandSubmitted = false;
  const submittedWorkDoneResolved = false;
  let pass: GPURenderPassEncoder | null = null;
  const uniformBuffers: GPUBuffer[] = [];
  const uploadedTextures: GPUTexture[] = [];

  try {
    if (options.layers.length === 0) {
      throw new Error('No VideoFrame layers to present');
    }
    for (const layer of options.layers) {
      if (!getVideoFrameDimensions(layer.frame)) {
        throw new Error('VideoFrame layer has no positive display dimensions');
      }
    }

    const resources = getLayerPresenterResources(surface);
    if (!resources.textureA || !resources.textureB) {
      throw new Error('Worker WebGPU layer textures are not available');
    }

    const commandEncoder = surface.device.createCommandEncoder({
      label: `${targetId}:${requestId}:gpu-video-frame-layers`,
    });
    commandEncoderCreated = true;

    pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: resources.textureA.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    pass = null;

    let readTexture = resources.textureA;
    let writeTexture = resources.textureB;
    for (const layer of options.layers) {
      const uploadStraightAlpha = workerVideoFrameNeedsStraightAlphaUpload(layer.frame);
      const uploadedTexture = uploadStraightAlpha
        ? uploadWorkerVideoFrameTexture(surface.device, layer.frame, surface.colorSpace ?? 'srgb') : null;
      if (uploadedTexture) uploadedTextures.push(uploadedTexture);
      const frameResource: GPUBindingResource = uploadedTexture?.createView() ?? surface.device.importExternalTexture({
        source: layer.frame, colorSpace: surface.colorSpace ?? 'srgb' });
      const uniformBuffer = createLayerUniformBuffer(surface, layer);
      uniformBuffers.push(uniformBuffer);
      const shader = uploadStraightAlpha ? workerTexture2dShader(VIDEO_FRAME_LAYER_COMPOSITE_SHADER) : VIDEO_FRAME_LAYER_COMPOSITE_SHADER;
      const compositePipeline = layer.operatorProgram ? getCachedWorkerOperatorPipeline(surface.device, resources.operatorPipelines,
        `${uploadStraightAlpha ? 'texture' : 'external'}:${layer.operatorProgram.key}`,
        specializeLegacyWorkerLayerShader(shader, layer.operatorProgram.wgsl))
        : uploadStraightAlpha ? resources.textureCompositePipeline : resources.compositePipeline;
      const bindGroup = surface.device.createBindGroup({
        layout: compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: resources.sampler },
          { binding: 1, resource: readTexture.createView() },
          { binding: 2, resource: frameResource },
          { binding: 3, resource: { buffer: uniformBuffer } },
        ],
      });
      pass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: writeTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(compositePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();
      pass = null;
      const nextRead = writeTexture;
      writeTexture = readTexture;
      readTexture = nextRead;
    }

    const displayBindGroup = surface.device.createBindGroup({
      layout: resources.displayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: resources.sampler },
        { binding: 1, resource: readTexture.createView() },
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
    renderPassEnded = true;

    surface.device.queue.submit([commandEncoder.finish()]);
    commandSubmitted = true;

    for (const buffer of uniformBuffers) {
      buffer.destroy();
    }
    for (const texture of uploadedTextures) texture.destroy();
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
        // Ignore cleanup errors after a failed WebGPU pass.
      }
    }
    for (const buffer of uniformBuffers) {
      try {
        buffer.destroy();
      } catch {
        // Ignore cleanup errors after a failed WebGPU pass.
      }
    }
    for (const texture of uploadedTextures) {
      try { texture.destroy(); } catch { /* Ignore cleanup errors after a failed WebGPU pass. */ }
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

export async function presentGpuVideoFrame(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuVideoFramePresentOptions,
): Promise<WorkerGpuPresentResult> {
  const targetId = options.targetId ?? 'worker-gpu-target';
  const requestId = options.requestId ?? 'gpu-video-frame';
  const frameIndex = options.frameIndex ?? surface.frameSequence + 1;
  const dimensions = getVideoFrameDimensions(options.frame);
  const nextSequence = surface.frameSequence + 1;
  const presentedFrameId = `${targetId}:${requestId}:gpu-video-frame:${nextSequence}`;
  let commandEncoderCreated = false;
  let renderPassEnded = false;
  let commandSubmitted = false;
  const submittedWorkDoneResolved = false;
  let pass: GPURenderPassEncoder | null = null;
  let uploadedTexture: GPUTexture | null = null;

  try {
    if (!dimensions) {
      throw new Error('VideoFrame has no positive display dimensions');
    }

    const resources = getPresenterResources(surface);
    const uploadStraightAlpha = workerVideoFrameNeedsStraightAlphaUpload(options.frame);
    uploadedTexture = uploadStraightAlpha
      ? uploadWorkerVideoFrameTexture(surface.device, options.frame, surface.colorSpace ?? 'srgb') : null;
    const frameResource: GPUBindingResource = uploadedTexture?.createView() ?? surface.device.importExternalTexture({
      source: options.frame, colorSpace: surface.colorSpace ?? 'srgb' });

    const bindGroup = surface.device.createBindGroup({
      layout: (uploadStraightAlpha ? resources.texturePipeline : resources.pipeline).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: resources.sampler },
        { binding: 1, resource: frameResource },
      ],
    });
    const commandEncoder = surface.device.createCommandEncoder({
      label: `${targetId}:${requestId}:gpu-video-frame`,
    });
    commandEncoderCreated = true;
    pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: surface.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(uploadStraightAlpha ? resources.texturePipeline : resources.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    renderPassEnded = true;

    surface.device.queue.submit([commandEncoder.finish()]);
    commandSubmitted = true;
    uploadedTexture?.destroy();
    uploadedTexture = null;

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
    try { uploadedTexture?.destroy(); } catch { /* Ignore cleanup errors after a failed WebGPU pass. */ }
    if (pass && !renderPassEnded) {
      try {
        pass.end();
        renderPassEnded = true;
      } catch {
        // Ignore cleanup errors after a failed WebGPU pass.
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
