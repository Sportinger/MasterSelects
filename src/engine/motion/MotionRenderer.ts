import type { Layer } from '../core/types';
import type { MotionLayerDefinition } from '../../types/motionDesign';
import type { TextureFillAppearance } from '../../types/motionDesign';
import {
  MOTION_UNIFORM_BYTE_SIZE,
  createMotionInstanceArray,
  createMotionUniformArray,
} from './MotionBuffers';
import {
  MOTION_RENDER_TEXTURE_FORMAT,
  type MotionClipGpuCache,
  type MotionRenderResult,
} from './MotionTypes';
import {
  getMotionRenderSizeForAdmission,
  type MotionFrameRuntimeAdmission,
} from './MotionFrameRuntime';
import { MotionPipeline } from './MotionPipeline';
import { MotionTextureAcquisition } from './media/motionTextureAcquisition';
import { ReplicatorInstanceBufferState } from './replicator/instanceBufferState';
import { planReplicatorSourceTexture } from './replicator/resourcePlanning';
import {
  MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY,
  MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE,
  MOTION_REPLICATOR_MIN_BUFFER_CAPACITY,
} from './replicator/runtimeContracts';
import {
  recordMotionRender,
  recordMotionTextureDiagnostic,
  setMotionRendererCacheCount,
} from './MotionDiagnostics';

function isRenderableMotionShape(motion: MotionLayerDefinition | undefined): motion is MotionLayerDefinition {
  const primitive = motion?.shape?.primitive;
  return motion?.kind === 'shape'
    && (
      primitive === 'rectangle'
      || primitive === 'ellipse'
      || primitive === 'polygon'
      || primitive === 'star'
    );
}

export class MotionRenderer {
  private device: GPUDevice;
  private pipeline: MotionPipeline;
  private textureAcquisition: MotionTextureAcquisition;
  private caches = new Map<string, MotionClipGpuCache>();
  private instanceBufferStates = new Map<string, ReplicatorInstanceBufferState>();
  private textureBindings = new WeakMap<MotionClipGpuCache, GPUTextureView>();
  private readonly requestRender: () => void;

  constructor(device: GPUDevice, requestRender: () => void = () => undefined) {
    this.device = device;
    this.requestRender = requestRender;
    this.pipeline = new MotionPipeline(device);
    this.textureAcquisition = new MotionTextureAcquisition(device, {
      onDiagnostic: (code, message) => recordMotionTextureDiagnostic({ code, message }),
    });
  }

  renderLayer(
    layer: Layer,
    commandEncoder: GPUCommandEncoder,
    frameAdmission: MotionFrameRuntimeAdmission,
  ): MotionRenderResult | null {
    const motion = layer.source?.motion;
    if (!isRenderableMotionShape(motion)) {
      return null;
    }

    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const size = getMotionRenderSizeForAdmission(layer, frameAdmission);
    const maxTextureDimension2D = this.device.limits?.maxTextureDimension2D ?? 8192;
    const texturePlan = planReplicatorSourceTexture({
      sourceWidth: size.width,
      sourceHeight: size.height,
      strokePadding: 0,
      maxTextureDimension2D,
      maxTexturePixels: Math.min(
        maxTextureDimension2D * maxTextureDimension2D,
        64 * 1024 * 1024,
      ),
    });
    if (!texturePlan.ok) {
      throw new Error(texturePlan.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join('; '));
    }
    if (size.replicator.instanceCount === 0) {
      return null;
    }
    const fallbackBinding = this.pipeline.getTextureBinding();
    const textureFills = (motion.appearance?.items ?? [])
      .filter((item): item is TextureFillAppearance => item.kind === 'texture-fill')
      .slice(0, 8);
    if (textureFills.length > 1) {
      for (const appearance of textureFills.slice(1)) {
        recordMotionTextureDiagnostic({
          code: 'TEXTURE_SLOT_EXCEEDED',
          appearanceId: appearance.id,
          message: 'Motion texture-fill supports one bound texture slot; only the first texture-fill renders.',
        });
      }
    }
    const primaryTextureFill = textureFills[0];
    const textureResult = primaryTextureFill
      ? this.textureAcquisition.acquire(primaryTextureFill, this.requestRender)
      : null;
    const textureBinding = textureResult?.status === 'ready' && textureResult.textureView
      ? { view: textureResult.textureView, sampler: fallbackBinding.sampler }
      : fallbackBinding;
    const cache = this.getOrCreateCache(
      layer,
      size.width,
      size.height,
      size.replicator.instanceCount,
      fallbackBinding,
    );
    this.ensureTextureBinding(cache, textureBinding);
    const uniforms = createMotionUniformArray(
      motion,
      size,
      primaryTextureFill
        ? {
            activeAppearanceId: textureResult?.status === 'ready' ? primaryTextureFill.id : null,
            sourceSize: textureResult?.sourceSize,
          }
        : undefined,
    );
    const instances = createMotionInstanceArray(size);
    const cacheKey = this.getCacheKey(layer);
    let instanceBufferState = this.instanceBufferStates.get(cacheKey);
    if (!instanceBufferState) {
      instanceBufferState = new ReplicatorInstanceBufferState();
      this.instanceBufferStates.set(cacheKey, instanceBufferState);
    }
    const bufferUpdate = instanceBufferState.prepare(
      size.replicator.cacheIdentity,
      instances,
      size.replicator.instanceCount,
    );
    this.device.queue.writeBuffer(cache.uniformBuffer, 0, uniforms as GPUAllowSharedBufferSource);
    for (const range of bufferUpdate.dirtyRanges) {
      const floatStart = range.byteOffset / Float32Array.BYTES_PER_ELEMENT;
      const floatEnd = floatStart + range.byteLength / Float32Array.BYTES_PER_ELEMENT;
      this.device.queue.writeBuffer(
        cache.instanceBuffer,
        range.byteOffset,
        instances.subarray(floatStart, floatEnd) as GPUAllowSharedBufferSource,
      );
    }

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
    const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordMotionRender({
      layerId: layer.id,
      sourceClipId: layer.sourceClipId,
      instanceCount: size.replicator.instanceCount,
      bufferUploads: 1 + bufferUpdate.dirtyRanges.length,
      bufferUploadBytes: uniforms.byteLength + bufferUpdate.stats.uploadedBytes,
      encodeTimeMs: finishedAt - startedAt,
      renderedAt: Date.now(),
    });

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
    this.instanceBufferStates.clear();
    this.textureBindings = new WeakMap<MotionClipGpuCache, GPUTextureView>();
    this.textureAcquisition.destroy();
    this.pipeline.destroy();
    setMotionRendererCacheCount(0);
  }

  private getCacheKey(layer: Layer): string {
    return layer.sourceClipId ? `${layer.id}:${layer.sourceClipId}` : layer.id;
  }

  private getOrCreateCache(
    layer: Layer,
    width: number,
    height: number,
    requiredInstances: number,
    fallbackBinding: { view: GPUTextureView; sampler: GPUSampler },
  ): MotionClipGpuCache {
    const key = this.getCacheKey(layer);
    const existing = this.caches.get(key);
    if (
      existing
      && existing.width === width
      && existing.height === height
      && existing.instanceCapacity >= requiredInstances
    ) {
      return existing;
    }

    if (existing) {
      existing.texture.destroy();
      existing.uniformBuffer.destroy();
      existing.instanceBuffer.destroy();
      this.caches.delete(key);
    }

    const instanceCapacity = resolveInstanceCapacity(requiredInstances);
    this.instanceBufferStates.get(key)?.invalidate();

    const texture = this.device.createTexture({
      label: `motion-shape-texture-${key}`,
      size: { width, height },
      format: MOTION_RENDER_TEXTURE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView();
    const uniformBuffer = this.device.createBuffer({
      label: `motion-shape-uniforms-${key}`,
      size: MOTION_UNIFORM_BYTE_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const instanceBuffer = this.device.createBuffer({
      label: `motion-shape-instances-${key}`,
      size: MOTION_REPLICATOR_INSTANCE_BYTE_STRIDE * instanceCapacity,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = this.device.createBindGroup({
      label: `motion-shape-bind-group-${key}`,
      layout: this.pipeline.getBindGroupLayout(),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: fallbackBinding.view },
        { binding: 2, resource: fallbackBinding.sampler },
      ],
    });

    const cache = {
      texture,
      view,
      uniformBuffer,
      instanceBuffer,
      bindGroup,
      width,
      height,
      instanceCapacity,
    };
    this.caches.set(key, cache);
    this.textureBindings.set(cache, fallbackBinding.view);
    setMotionRendererCacheCount(this.caches.size);
    return cache;
  }

  private ensureTextureBinding(
    cache: MotionClipGpuCache,
    textureBinding: { view: GPUTextureView; sampler: GPUSampler },
  ): void {
    if (this.textureBindings.get(cache) === textureBinding.view) return;
    cache.bindGroup = this.device.createBindGroup({
      label: 'motion-shape-texture-bind-group',
      layout: this.pipeline.getBindGroupLayout(),
      entries: [
        { binding: 0, resource: { buffer: cache.uniformBuffer } },
        { binding: 1, resource: textureBinding.view },
        { binding: 2, resource: textureBinding.sampler },
      ],
    });
    this.textureBindings.set(cache, textureBinding.view);
  }
}

function resolveInstanceCapacity(requiredInstances: number): number {
  if (
    !Number.isSafeInteger(requiredInstances)
    || requiredInstances < 0
    || requiredInstances > MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY
  ) {
    throw new RangeError('Motion Replicator instance count exceeds GPU buffer capacity');
  }
  let capacity = MOTION_REPLICATOR_MIN_BUFFER_CAPACITY;
  while (capacity < requiredInstances) capacity *= 2;
  return Math.min(capacity, MOTION_REPLICATOR_DEFAULT_MAX_BUFFER_CAPACITY);
}
