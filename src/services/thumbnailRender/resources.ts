import { Logger } from '../logger';
import { guardGpuDevice } from '../../engine/core/gpuPipelineGuard';
import type { ThumbnailResources } from './contracts';

const log = Logger.create('ThumbnailRenderer');

export async function createThumbnailResources(): Promise<ThumbnailResources | null> {
  if (!navigator.gpu) {
    log.warn('WebGPU not supported - thumbnail renderer disabled');
    return null;
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'low-power',
  });
  if (!adapter) {
    log.warn('No GPU adapter available');
    return null;
  }

  const device = guardGpuDevice(await adapter.requestDevice(), 'thumbnails');

  const { CompositorPipeline } = await import('../../engine/pipeline/CompositorPipeline');
  const { EffectsPipeline } = await import('../../effects/EffectsPipeline');
  const { OutputPipeline } = await import('../../engine/pipeline/OutputPipeline');
  const { TextureManager } = await import('../../engine/texture/TextureManager');
  const { MaskTextureManager } = await import('../../engine/texture/MaskTextureManager');

  const compositorPipeline = new CompositorPipeline(device);
  const effectsPipeline = new EffectsPipeline(device);
  const outputPipeline = new OutputPipeline(device);

  await compositorPipeline.createPipelines();
  await effectsPipeline.createPipelines();
  await outputPipeline.createPipeline();

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  const textureManager = new TextureManager(device);
  const maskTextureManager = new MaskTextureManager(device);

  return {
    device,
    sampler,
    compositorPipeline,
    effectsPipeline,
    outputPipeline,
    textureManager,
    maskTextureManager,
  };
}

export function disposeThumbnailResources(resources: ThumbnailResources): void {
  resources.compositorPipeline.destroy();
  resources.effectsPipeline.destroy();
  resources.outputPipeline.destroy();
  resources.textureManager.destroy();
  resources.maskTextureManager.destroy();
  resources.device.destroy();
}
