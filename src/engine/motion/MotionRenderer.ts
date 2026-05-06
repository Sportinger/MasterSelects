import type { Layer } from '../core/types';
import type { MotionLayerDefinition } from '../../types/motionDesign';
import { createMotionInstanceArray, createMotionUniformArray } from './MotionBuffers';
import {
  getMotionRenderSize,
  MOTION_RENDER_TEXTURE_FORMAT,
  type MotionClipGpuCache,
  type MotionRenderResult,
} from './MotionTypes';
import { MotionPipeline } from './MotionPipeline';

function isRenderableMotionShape(motion: MotionLayerDefinition | undefined): motion is MotionLayerDefinition {
  const primitive = motion?.shape?.primitive;
  return motion?.kind === 'shape' && (primitive === 'rectangle' || primitive === 'ellipse');
}

export class MotionRenderer {
  private device: GPUDevice;
  private pipeline: MotionPipeline;
  private caches = new Map<string, MotionClipGpuCache>();

  constructor(device: GPUDevice) {
    this.device = device;
    this.pipeline = new MotionPipeline(device);
  }

  renderLayer(layer: Layer, commandEncoder: GPUCommandEncoder): MotionRenderResult | null {
    const motion = layer.source?.motion;
    if (!isRenderableMotionShape(motion)) {
      return null;
    }

    const size = getMotionRenderSize(motion);
    const cache = this.getOrCreateCache(layer, size.width, size.height);
    const uniforms = createMotionUniformArray(motion, size);
    const instances = createMotionInstanceArray(size);
    this.device.queue.writeBuffer(cache.uniformBuffer, 0, uniforms as GPUAllowSharedBufferSource);
    this.device.queue.writeBuffer(cache.instanceBuffer, 0, instances as GPUAllowSharedBufferSource);

    const pass = commandEncoder.beginRenderPass({
      label: 'motion-shape-render-pass',
      colorAttachments: [{
        view: cache.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline.getPipeline());
    pass.setBindGroup(0, cache.bindGroup);
    pass.setVertexBuffer(0, cache.instanceBuffer);
    pass.draw(6, size.replicator.instanceCount);
    pass.end();

    return {
      ...size,
      textureView: cache.view,
    };
  }

  destroy(): void {
    for (const cache of this.caches.values()) {
      cache.texture.destroy();
      cache.uniformBuffer.destroy();
      cache.instanceBuffer.destroy();
    }
    this.caches.clear();
  }

  private getCacheKey(layer: Layer): string {
    return layer.sourceClipId ? `${layer.id}:${layer.sourceClipId}` : layer.id;
  }

  private getOrCreateCache(layer: Layer, width: number, height: number): MotionClipGpuCache {
    const key = this.getCacheKey(layer);
    const existing = this.caches.get(key);
    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    if (existing) {
      existing.texture.destroy();
      existing.uniformBuffer.destroy();
      existing.instanceBuffer.destroy();
      this.caches.delete(key);
    }

    const texture = this.device.createTexture({
      label: `motion-shape-texture-${key}`,
      size: { width, height },
      format: MOTION_RENDER_TEXTURE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView();
    const uniformBuffer = this.device.createBuffer({
      label: `motion-shape-uniforms-${key}`,
      size: 20 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const instanceBuffer = this.device.createBuffer({
      label: `motion-shape-instances-${key}`,
      size: 4 * 4 * 100,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = this.device.createBindGroup({
      label: `motion-shape-bind-group-${key}`,
      layout: this.pipeline.getBindGroupLayout(),
      entries: [{
        binding: 0,
        resource: { buffer: uniformBuffer },
      }],
    });

    const cache = { texture, view, uniformBuffer, instanceBuffer, bindGroup, width, height };
    this.caches.set(key, cache);
    return cache;
  }
}
