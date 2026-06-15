// Ping-pong compositing pipeline for layer blending

import type { Layer } from '../core/types';
import { createCompositorPipelineResources } from './compositor/pipelineResources';
import {
  COMPOSITOR_UNIFORM_SIZE,
  shouldUpdateLayerUniforms,
  type InlineEffectParams,
  type UniformValueSnapshot,
  writeLayerUniformData,
} from './compositor/uniforms';

export type { InlineEffectParams } from './compositor/uniforms';

export class CompositorPipeline {
  private device: GPUDevice;

  // Pipelines
  private compositePipeline: GPURenderPipeline | null = null;
  private externalCompositePipeline: GPURenderPipeline | null = null;
  private copyPipeline: GPURenderPipeline | null = null;
  private externalCopyPipeline: GPURenderPipeline | null = null;

  // Bind group layouts
  private compositeBindGroupLayout: GPUBindGroupLayout | null = null;
  private externalCompositeBindGroupLayout: GPUBindGroupLayout | null = null;
  private copyBindGroupLayout: GPUBindGroupLayout | null = null;
  private externalCopyBindGroupLayout: GPUBindGroupLayout | null = null;

  // Uniform buffer and data
  private uniformBuffer = new ArrayBuffer(COMPOSITOR_UNIFORM_SIZE); // Extended layer uniforms.
  private uniformData = new Float32Array(this.uniformBuffer);
  private uniformDataU32 = new Uint32Array(this.uniformBuffer);

  // Per-layer uniform buffers
  private layerUniformBuffers: Map<string, GPUBuffer> = new Map();

  // Bind group cache for static textures (images)
  // Key format: "layerId:baseViewId:layerViewId:maskViewId"
  private bindGroupCache: Map<string, GPUBindGroup> = new Map();
  private textureViewIds = new WeakMap<GPUTextureView, number>();
  private nextTextureViewId = 1;

  // Frame-scoped cache for external texture bind groups (cleared each frame)
  // Avoids creating duplicate bind groups for same video rendered to multiple outputs
  private frameExternalBindGroupCache: Map<string, GPUBindGroup> = new Map();
  private currentFrameId = 0;

  // Uniform change detection - track last values per layer
  private lastUniformValues: Map<string, UniformValueSnapshot> = new Map();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  // Call at start of each frame to clear ephemeral caches
  beginFrame(): void {
    this.currentFrameId++;
    this.frameExternalBindGroupCache.clear();
  }

  async createPipelines(): Promise<void> {
    const resources = createCompositorPipelineResources(this.device);

    this.compositeBindGroupLayout = resources.compositeBindGroupLayout;
    this.compositePipeline = resources.compositePipeline;
    this.externalCompositeBindGroupLayout = resources.externalCompositeBindGroupLayout;
    this.externalCompositePipeline = resources.externalCompositePipeline;
    this.copyBindGroupLayout = resources.copyBindGroupLayout;
    this.copyPipeline = resources.copyPipeline;
    this.externalCopyBindGroupLayout = resources.externalCopyBindGroupLayout;
    this.externalCopyPipeline = resources.externalCopyPipeline;
  }

  getCompositePipeline(): GPURenderPipeline | null {
    return this.compositePipeline;
  }

  getExternalCompositePipeline(): GPURenderPipeline | null {
    return this.externalCompositePipeline;
  }

  getCompositeBindGroupLayout(): GPUBindGroupLayout | null {
    return this.compositeBindGroupLayout;
  }

  getExternalCompositeBindGroupLayout(): GPUBindGroupLayout | null {
    return this.externalCompositeBindGroupLayout;
  }

  getCopyPipeline(): GPURenderPipeline | null {
    return this.copyPipeline;
  }

  getExternalCopyPipeline(): GPURenderPipeline | null {
    return this.externalCopyPipeline;
  }

  // Create bind group for copying regular texture to temp texture
  createCopyBindGroup(
    sampler: GPUSampler,
    sourceView: GPUTextureView,
    _layerId?: string
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.copyBindGroupLayout!,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: sourceView },
      ],
    });
  }

  // Create bind group for copying external video texture to temp texture
  createExternalCopyBindGroup(
    sampler: GPUSampler,
    externalTexture: GPUExternalTexture,
    _layerId?: string
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.externalCopyBindGroupLayout!,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: externalTexture },
      ],
    });
  }

  // Get or create per-layer uniform buffer
  getOrCreateUniformBuffer(layerId: string): GPUBuffer {
    let uniformBuffer = this.layerUniformBuffers.get(layerId);
    if (!uniformBuffer) {
      uniformBuffer = this.device.createBuffer({
        size: COMPOSITOR_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.layerUniformBuffers.set(layerId, uniformBuffer);
    }
    return uniformBuffer;
  }

  // Update layer uniforms
  updateLayerUniforms(
    layer: Layer,
    sourceAspect: number,
    outputAspect: number,
    hasMask: boolean,
    uniformBuffer: GPUBuffer,
    inlineEffects?: InlineEffectParams
  ): void {
    writeLayerUniformData(
      layer,
      sourceAspect,
      outputAspect,
      hasMask,
      this.uniformData,
      this.uniformDataU32,
      inlineEffects,
    );

    // Change detection - only write to GPU if values changed
    const lastValuesEntry = this.lastUniformValues.get(layer.id);
    const needsUpdate = shouldUpdateLayerUniforms(
      this.uniformData,
      this.uniformDataU32,
      lastValuesEntry,
    );

    if (needsUpdate) {
      this.device.queue.writeBuffer(uniformBuffer, 0, this.uniformData);
      // Store copy of current values (both float and u32 views)
      if (!lastValuesEntry) {
        this.lastUniformValues.set(layer.id, {
          float: new Float32Array(this.uniformData),
          u32: new Uint32Array(this.uniformDataU32),
        });
      } else {
        lastValuesEntry.float.set(this.uniformData);
        lastValuesEntry.u32.set(this.uniformDataU32);
      }
    }
  }

  // Create bind group for regular textures (with caching for static images)
  createCompositeBindGroup(
    sampler: GPUSampler,
    baseView: GPUTextureView,
    layerView: GPUTextureView,
    uniformBuffer: GPUBuffer,
    maskTextureView: GPUTextureView,
    layerId?: string,
    isPingBase?: boolean
  ): GPUBindGroup {
    // Try to use cache for static textures (images)
    if (layerId !== undefined && isPingBase !== undefined) {
      const cacheKey = [
        layerId,
        isPingBase ? 'ping' : 'pong',
        this.getTextureViewId(baseView),
        this.getTextureViewId(layerView),
        this.getTextureViewId(maskTextureView),
      ].join(':');
      let bindGroup = this.bindGroupCache.get(cacheKey);
      if (!bindGroup) {
        bindGroup = this.device.createBindGroup({
          layout: this.compositeBindGroupLayout!,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: baseView },
            { binding: 2, resource: layerView },
            { binding: 3, resource: { buffer: uniformBuffer } },
            { binding: 4, resource: maskTextureView },
          ],
        });
        this.bindGroupCache.set(cacheKey, bindGroup);
      }
      return bindGroup;
    }

    // No caching - create fresh bind group
    return this.device.createBindGroup({
      layout: this.compositeBindGroupLayout!,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: baseView },
        { binding: 2, resource: layerView },
        { binding: 3, resource: { buffer: uniformBuffer } },
        { binding: 4, resource: maskTextureView },
      ],
    });
  }

  private getTextureViewId(view: GPUTextureView): number {
    let id = this.textureViewIds.get(view);
    if (id === undefined) {
      id = this.nextTextureViewId++;
      this.textureViewIds.set(view, id);
    }
    return id;
  }

  // Create bind group for external video textures (with frame-scoped caching)
  createExternalCompositeBindGroup(
    sampler: GPUSampler,
    baseView: GPUTextureView,
    externalTexture: GPUExternalTexture,
    uniformBuffer: GPUBuffer,
    maskTextureView: GPUTextureView,
    layerId?: string,
    isPingBase?: boolean
  ): GPUBindGroup {
    // Frame-scoped cache key - external textures are ephemeral but we can reuse
    // within a frame if same video is rendered to multiple outputs
    if (layerId !== undefined && isPingBase !== undefined) {
      const cacheKey = `ext:${layerId}:${isPingBase ? 'ping' : 'pong'}`;
      let bindGroup = this.frameExternalBindGroupCache.get(cacheKey);
      if (!bindGroup) {
        bindGroup = this.device.createBindGroup({
          layout: this.externalCompositeBindGroupLayout!,
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: baseView },
            { binding: 2, resource: externalTexture },
            { binding: 3, resource: { buffer: uniformBuffer } },
            { binding: 4, resource: maskTextureView },
          ],
        });
        this.frameExternalBindGroupCache.set(cacheKey, bindGroup);
      }
      return bindGroup;
    }

    return this.device.createBindGroup({
      layout: this.externalCompositeBindGroupLayout!,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: baseView },
        { binding: 2, resource: externalTexture },
        { binding: 3, resource: { buffer: uniformBuffer } },
        { binding: 4, resource: maskTextureView },
      ],
    });
  }

  // Invalidate bind group cache for a specific layer or all layers
  invalidateBindGroupCache(layerId?: string): void {
    if (layerId) {
      // Clear only entries for this layer
      for (const key of this.bindGroupCache.keys()) {
        if (key.startsWith(layerId + ':')) {
          this.bindGroupCache.delete(key);
        }
      }
    } else {
      this.bindGroupCache.clear();
    }
  }

  destroy(): void {
    // Destroy per-layer uniform buffers
    for (const buffer of this.layerUniformBuffers.values()) {
      buffer.destroy();
    }
    this.layerUniformBuffers.clear();

    // Clear bind group caches
    this.bindGroupCache.clear();
    this.frameExternalBindGroupCache.clear();
    this.lastUniformValues.clear();
  }
}
