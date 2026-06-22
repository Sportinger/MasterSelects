import type {
  WorkerGpuPresentBaseOptions,
  WorkerGpuPresentDiagnostics,
  WorkerGpuPresentResult,
  WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';
import {
  VIDEO_FRAME_LAYER_COMPOSITE_SHADER,
  VIDEO_FRAME_LAYER_DISPLAY_SHADER,
} from './workerGpuVideoFrameLayerShaderSource';
import type { WorkerGpuWebCodecsRenderLayer } from './workerGpuRuntimeCommands';

interface WorkerGpuVideoFrameLayerPresenterResources {
  readonly compositePipeline: GPURenderPipeline;
  readonly bitmapCompositePipeline: GPURenderPipeline;
  readonly displayPipeline: GPURenderPipeline;
  readonly sampler: GPUSampler;
  textureA: GPUTexture | null;
  textureB: GPUTexture | null;
  width: number;
  height: number;
}

interface WorkerGpuVideoFrameDimensions {
  readonly width: number;
  readonly height: number;
}

type WorkerGpuVideoFrameSource = VideoFrame | ImageBitmap;

export interface WorkerGpuVideoFramePresentLayer {
  readonly frame: WorkerGpuVideoFrameSource;
  readonly timestampSeconds?: number | null;
  readonly mediaTime?: number | null;
  readonly opacity: number;
  readonly blendMode: string;
  readonly renderLayer?: WorkerGpuWebCodecsRenderLayer;
  readonly inlineBrightness?: number;
  readonly inlineContrast?: number;
  readonly inlineSaturation?: number;
  readonly inlineInvert?: boolean;
  readonly hueShift?: number;
  readonly pixelateSize?: number;
  readonly kaleidoscopeSegments?: number;
  readonly kaleidoscopeRotation?: number;
  readonly mirrorHorizontal?: boolean;
  readonly mirrorVertical?: boolean;
  readonly rgbSplitAmount?: number;
  readonly rgbSplitAngle?: number;
  readonly blurRadius?: number; readonly exposure?: number; readonly exposureOffset?: number; readonly exposureGamma?: number;
  readonly temperature?: number; readonly tint?: number; readonly vibrance?: number; readonly thresholdLevel?: number;
  readonly posterizeLevels?: number; readonly vignetteAmount?: number; readonly vignetteSize?: number; readonly vignetteSoftness?: number;
  readonly vignetteRoundness?: number; readonly chromaKeyMode?: number; readonly chromaKeyTolerance?: number; readonly chromaKeySoftness?: number;
  readonly chromaKeySpill?: number; readonly scanlineDensity?: number; readonly scanlineOpacity?: number; readonly scanlineSpeed?: number;
  readonly grainAmount?: number; readonly grainSize?: number; readonly grainSpeed?: number;
  readonly waveAmplitudeX?: number; readonly waveAmplitudeY?: number; readonly waveFrequencyX?: number; readonly waveFrequencyY?: number;
  readonly twirlAmount?: number; readonly twirlRadius?: number; readonly twirlCenterX?: number; readonly twirlCenterY?: number;
  readonly bulgeAmount?: number; readonly bulgeRadius?: number; readonly bulgeCenterX?: number; readonly bulgeCenterY?: number;
  readonly sharpenAmount?: number; readonly sharpenRadius?: number; readonly edgeDetectStrength?: number; readonly edgeDetectInvert?: boolean;
  readonly glowAmount?: number; readonly glowThreshold?: number; readonly glowRadius?: number;
  readonly levelsInputBlack?: number;
  readonly levelsInputWhite?: number;
  readonly levelsGamma?: number;
  readonly levelsOutputBlack?: number;
  readonly levelsOutputWhite?: number;
  readonly levelsEnabled?: boolean;
}

export interface WorkerGpuVideoFrameLayerPresentOptions extends WorkerGpuPresentBaseOptions {
  readonly layers: readonly WorkerGpuVideoFramePresentLayer[];
}

const layerPresenterResourcesBySurface = new WeakMap<WorkerGpuTargetSurface, WorkerGpuVideoFrameLayerPresenterResources>();

const BITMAP_LAYER_COMPOSITE_SHADER = VIDEO_FRAME_LAYER_COMPOSITE_SHADER
  .replace(
    '@group(0) @binding(2) var frameTexture: texture_external;',
    '@group(0) @binding(2) var frameTexture: texture_2d<f32>;',
  )
  .replaceAll(
    'textureSampleBaseClampToEdge(frameTexture, frameSampler, input.uv)',
    'textureSample(frameTexture, frameSampler, input.uv)',
  );

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

function isImageBitmapFrame(frame: WorkerGpuVideoFrameSource): frame is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap;
}

function getVideoFrameDimensions(frame: WorkerGpuVideoFrameSource): WorkerGpuVideoFrameDimensions | null {
  const image = frame as Partial<ImageBitmap & VideoFrame>;
  const width = positiveInteger(image.displayWidth) || positiveInteger(image.codedWidth) || positiveInteger(image.width);
  const height = positiveInteger(image.displayHeight) || positiveInteger(image.codedHeight) || positiveInteger(image.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

function createLayerPresenterResources(surface: WorkerGpuTargetSurface): WorkerGpuVideoFrameLayerPresenterResources {
  const compositePipeline = surface.device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: surface.device.createShaderModule({ code: VIDEO_FRAME_LAYER_COMPOSITE_SHADER }),
      entryPoint: 'vertexMain',
      buffers: [],
    },
    fragment: {
      module: surface.device.createShaderModule({ code: VIDEO_FRAME_LAYER_COMPOSITE_SHADER }),
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const bitmapCompositePipeline = surface.device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: surface.device.createShaderModule({ code: BITMAP_LAYER_COMPOSITE_SHADER }),
      entryPoint: 'vertexMain',
      buffers: [],
    },
    fragment: {
      module: surface.device.createShaderModule({ code: BITMAP_LAYER_COMPOSITE_SHADER }),
      entryPoint: 'fragmentMain',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const displayPipeline = surface.device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: surface.device.createShaderModule({ code: VIDEO_FRAME_LAYER_DISPLAY_SHADER }),
      entryPoint: 'vertexMain',
      buffers: [],
    },
    fragment: {
      module: surface.device.createShaderModule({ code: VIDEO_FRAME_LAYER_DISPLAY_SHADER }),
      entryPoint: 'fragmentMain',
      targets: [{ format: surface.format }],
    },
    primitive: { topology: 'triangle-list' },
  });
  return {
    compositePipeline,
    bitmapCompositePipeline,
    displayPipeline,
    sampler: surface.device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
    textureA: null,
    textureB: null,
    width: 0,
    height: 0,
  };
}

function getLayerPresenterResources(surface: WorkerGpuTargetSurface): WorkerGpuVideoFrameLayerPresenterResources {
  const existing = layerPresenterResourcesBySurface.get(surface);
  const resources = existing ?? createLayerPresenterResources(surface);
  if (!existing) layerPresenterResourcesBySurface.set(surface, resources);
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

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createLayerUniformBuffer(
  surface: WorkerGpuTargetSurface,
  layer: WorkerGpuVideoFramePresentLayer,
): GPUBuffer {
  const buffer = surface.device.createBuffer({
    size: 272,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const payload = new ArrayBuffer(272);
  const view = new DataView(payload);
  const f32 = (offset: number, value: number) => view.setFloat32(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  f32(0, Math.max(0, Math.min(1, finiteNumber(layer.opacity, 1))));
  u32(4, BLEND_MODE_TO_GPU_INDEX[layer.blendMode] ?? 0);
  f32(8, finiteNumber(layer.inlineBrightness, 0));
  f32(12, finiteNumber(layer.inlineContrast, 1));
  f32(16, finiteNumber(layer.inlineSaturation, 1));
  u32(20, layer.inlineInvert === true ? 1 : 0);
  f32(24, finiteNumber(layer.hueShift, 0));
  f32(28, Math.max(0, finiteNumber(layer.pixelateSize, 0)));
  f32(32, Math.max(0, finiteNumber(layer.kaleidoscopeSegments, 0)));
  f32(36, finiteNumber(layer.kaleidoscopeRotation, 0));
  f32(40, finiteNumber(layer.rgbSplitAmount, 0));
  f32(44, finiteNumber(layer.rgbSplitAngle, 0));
  f32(48, Math.max(0, finiteNumber(layer.blurRadius, 0)));
  f32(52, finiteNumber(layer.exposure, 0));
  f32(56, finiteNumber(layer.exposureOffset, 0));
  f32(60, Math.max(0.001, finiteNumber(layer.exposureGamma, 1)));
  f32(64, finiteNumber(layer.temperature, 0));
  f32(68, finiteNumber(layer.tint, 0));
  f32(72, finiteNumber(layer.vibrance, 0));
  f32(76, finiteNumber(layer.thresholdLevel, -1));
  f32(80, Math.max(0, finiteNumber(layer.posterizeLevels, 0)));
  f32(84, finiteNumber(layer.vignetteAmount, 0));
  f32(88, finiteNumber(layer.vignetteSize, 0.5));
  f32(92, finiteNumber(layer.vignetteSoftness, 0.5));
  f32(96, finiteNumber(layer.vignetteRoundness, 1));
  u32(100, Math.max(0, Math.floor(finiteNumber(layer.chromaKeyMode, 0))));
  f32(104, finiteNumber(layer.chromaKeyTolerance, 0.2));
  f32(108, finiteNumber(layer.chromaKeySoftness, 0.1));
  f32(112, finiteNumber(layer.chromaKeySpill, 0.5));
  f32(116, finiteNumber(layer.scanlineDensity, 0));
  f32(120, finiteNumber(layer.scanlineOpacity, 0));
  f32(124, finiteNumber(layer.scanlineSpeed, 0));
  f32(128, finiteNumber(layer.grainAmount, 0));
  f32(132, Math.max(0.001, finiteNumber(layer.grainSize, 1)));
  f32(136, finiteNumber(layer.grainSpeed, 1));
  f32(140, finiteNumber(layer.waveAmplitudeX, 0));
  f32(144, finiteNumber(layer.waveAmplitudeY, 0));
  f32(148, finiteNumber(layer.waveFrequencyX, 5));
  f32(152, finiteNumber(layer.waveFrequencyY, 5));
  f32(156, finiteNumber(layer.twirlAmount, 0));
  f32(160, Math.max(0.0001, finiteNumber(layer.twirlRadius, 0.5)));
  f32(164, finiteNumber(layer.twirlCenterX, 0.5));
  f32(168, finiteNumber(layer.twirlCenterY, 0.5));
  f32(172, finiteNumber(layer.bulgeAmount, 0));
  f32(176, Math.max(0.0001, finiteNumber(layer.bulgeRadius, 0.5)));
  f32(180, finiteNumber(layer.bulgeCenterX, 0.5));
  f32(184, finiteNumber(layer.bulgeCenterY, 0.5));
  f32(188, finiteNumber(layer.sharpenAmount, 0));
  f32(192, Math.max(0, finiteNumber(layer.sharpenRadius, 1)));
  f32(196, finiteNumber(layer.edgeDetectStrength, 0));
  u32(200, layer.edgeDetectInvert === true ? 1 : 0);
  f32(204, finiteNumber(layer.glowAmount, 0));
  f32(208, finiteNumber(layer.glowThreshold, 0.6));
  f32(212, Math.max(0, finiteNumber(layer.glowRadius, 20)));
  f32(216, finiteNumber(layer.levelsInputBlack, 0));
  f32(220, finiteNumber(layer.levelsInputWhite, 1));
  f32(224, finiteNumber(layer.levelsGamma, 1));
  f32(228, finiteNumber(layer.levelsOutputBlack, 0));
  f32(232, finiteNumber(layer.levelsOutputWhite, 1));
  u32(236, layer.mirrorHorizontal === true ? 1 : 0);
  u32(240, layer.mirrorVertical === true ? 1 : 0);
  u32(244, layer.levelsEnabled === true ? 1 : 0);
  f32(248, Math.max(1, Math.floor(surface.canvas.width)));
  f32(252, Math.max(1, Math.floor(surface.canvas.height)));
  f32(256, (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
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
  const uploadedBitmapTextures: GPUTexture[] = [];

  try {
    if (options.layers.length === 0) throw new Error('No VideoFrame layers to present');
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
      const dimensions = getVideoFrameDimensions(layer.frame);
      if (!dimensions) {
        throw new Error('VideoFrame layer has no positive display dimensions');
      }
      const uniformBuffer = createLayerUniformBuffer(surface, layer);
      uniformBuffers.push(uniformBuffer);
      const compositePipeline = isImageBitmapFrame(layer.frame)
        ? resources.bitmapCompositePipeline
        : resources.compositePipeline;
      let frameResource: GPUBindingResource;
      if (isImageBitmapFrame(layer.frame)) {
        const bitmapTexture = surface.device.createTexture({
          size: { width: dimensions.width, height: dimensions.height },
          format: 'rgba8unorm',
          usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
        });
        surface.device.queue.copyExternalImageToTexture(
          { source: layer.frame },
          {
            texture: bitmapTexture,
            colorSpace: surface.colorSpace ?? 'srgb',
            premultipliedAlpha: false,
          },
          { width: dimensions.width, height: dimensions.height },
        );
        uploadedBitmapTextures.push(bitmapTexture);
        frameResource = bitmapTexture.createView();
      } else {
        frameResource = surface.device.importExternalTexture({
          source: layer.frame,
          colorSpace: surface.colorSpace ?? 'srgb',
        });
      }
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

    for (const buffer of uniformBuffers) buffer.destroy();
    for (const texture of uploadedBitmapTextures) texture.destroy();
    surface.frameSequence = nextSequence;
    surface.diagnostics = { ...surface.diagnostics, lastPresentedFrameId: presentedFrameId };
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
    for (const texture of uploadedBitmapTextures) {
      try {
        texture.destroy();
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
