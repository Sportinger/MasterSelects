import type { ImageOperatorProgram } from '../../types/imageOperatorProgram';

export function specializeLegacyWorkerLayerShader(source: string, program: ImageOperatorProgram): string {
  const marker = '  adjustedRgb = select(adjustedRgb, 1.0 - adjustedRgb, layer.inlineInvert == 1u);';
  if (!source.includes(marker)) throw new Error('Worker frame operator insertion point is missing.');
  const parameters = program.values.length ? ', layer.imageParameters' : '';
  const specialized = program.values.length
    ? source.replace('  _pad1: u32,', '  _pad1: u32,\n  imageParameters: ImageOperatorParameters,') : source;
  return `${program.wgsl}\n${specialized.replace(marker, `  frameColor = evaluateImageGraph(frameColor${parameters});\n  adjustedRgb = frameColor.rgb;\n${marker}`)}`;
}

export function workerGpuOperatorProgramCacheKey(program: { readonly key: string } | undefined): string {
  return program?.key ?? 'no-operator-program';
}

/** Presentation identity includes frame-varying values; GPU pipeline identity deliberately does not. */
export function workerGpuOperatorProgramPresentationKey(program: ImageOperatorProgram | undefined): string {
  return program ? `${program.key}:${program.values.map(value => Math.fround(value)).join(',')}` : 'no-operator-program';
}

const OPAQUE_VIDEO_FORMATS = new Set(['I420', 'I422', 'I444', 'NV12', 'RGBX', 'BGRX']);

/** Chromium may expose premultiplied RGB from alpha-bearing external VideoFrames despite the WebGPU straight-alpha contract. */
export function workerVideoFrameNeedsStraightAlphaUpload(frame: Pick<VideoFrame, 'format'>): boolean {
  return frame.format === null || !OPAQUE_VIDEO_FORMATS.has(frame.format);
}

export function workerTexture2dShader(source: string): string {
  return source
    .replace('var frameTexture: texture_external;', 'var frameTexture: texture_2d<f32>;')
    .replaceAll('textureSampleBaseClampToEdge(frameTexture, frameSampler,', 'textureSample(frameTexture, frameSampler,');
}

export function uploadWorkerVideoFrameTexture(device: GPUDevice, frame: VideoFrame, colorSpace: PredefinedColorSpace): GPUTexture {
  const width = Math.max(1, frame.displayWidth || frame.codedWidth);
  const height = Math.max(1, frame.displayHeight || frame.codedHeight);
  const texture = device.createTexture({ size: { width, height }, format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  try {
    device.queue.copyExternalImageToTexture({ source: frame },
      { texture, colorSpace, premultipliedAlpha: false }, { width, height });
    return texture;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}

export function getCachedWorkerOperatorPipeline(device: GPUDevice, cache: Map<string, GPURenderPipeline>, key: string, source: string): GPURenderPipeline {
  const cached = cache.get(key); if (cached) return cached;
  const module = device.createShaderModule({ code: source });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vertexMain', buffers: [] },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } });
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, pipeline); return pipeline;
}
