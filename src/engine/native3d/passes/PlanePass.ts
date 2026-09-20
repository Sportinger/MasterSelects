import { Logger } from '../../../services/logger';
import type { SceneCamera, SceneLayer3DData, ScenePlaneLayer, SceneVoxelLayer } from '../../scene/types';
import type { MaskTextureManager } from '../../texture/MaskTextureManager';
import { PLANE_UNIFORM_SIZE } from '../sceneRenderer/constants';
import { createPlaneResources, createPlaneWhiteMaskResource } from '../sceneRenderer/pipelineResources';
import { buildPlaneMvp, buildPlaneUniformData } from '../sceneRenderer/planeUniforms';
import { resolvePlaneTextureSource, type CachedPlaneTexture } from '../sceneRenderer/planeTextureSources';

const log = Logger.create('NativeSceneRenderer');

/** Owns textured-plane pipelines, per-layer source textures and plane draws for the native scene. */
export class PlanePass {
  private pipelineOpaque: GPURenderPipeline | null = null;
  private pipelineTransparent: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private whiteMaskTexture: GPUTexture | null = null;
  private whiteMaskView: GPUTextureView | null = null;
  private readonly textures = new Map<string, CachedPlaneTexture>();

  supports(layer: SceneLayer3DData): layer is ScenePlaneLayer {
    return layer.kind === 'plane';
  }

  collect(layers: SceneLayer3DData[]): ScenePlaneLayer[] {
    return layers.filter((layer): layer is ScenePlaneLayer => this.supports(layer));
  }

  get isReady(): boolean {
    return !!(this.pipelineOpaque && this.pipelineTransparent && this.bindGroupLayout && this.sampler && this.whiteMaskView);
  }

  ensureResources(device: GPUDevice): void {
    if (this.isReady) return;
    const resources = createPlaneResources(device);
    this.pipelineOpaque = resources.opaquePipeline;
    this.pipelineTransparent = resources.transparentPipeline;
    this.bindGroupLayout = resources.bindGroupLayout;
    this.sampler = resources.sampler;
    this.whiteMaskTexture?.destroy();
    const whiteMask = createPlaneWhiteMaskResource(device);
    this.whiteMaskTexture = whiteMask.whiteMaskTexture;
    this.whiteMaskView = whiteMask.whiteMaskView;
  }

  getCachedTexture(layerId: string): CachedPlaneTexture | undefined {
    return this.textures.get(layerId);
  }

  render(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    sceneDepthView: GPUTextureView,
    layers: ScenePlaneLayer[],
    camera: SceneCamera,
    transparent: boolean,
    temporaryBuffers: GPUBuffer[],
    maskTextureManager?: MaskTextureManager | null,
    textureOverrides?: ReadonlyMap<string, GPUTextureView>,
  ): boolean {
    if (layers.length === 0) return true;
    if (!this.pipelineOpaque || !this.pipelineTransparent || !this.bindGroupLayout || !this.sampler || !this.whiteMaskView) {
      return false;
    }

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: sceneDepthView, depthClearValue: 1, depthLoadOp: 'load', depthStoreOp: 'store' },
      label: transparent ? 'native-scene-plane-transparent-pass' : 'native-scene-plane-opaque-pass',
    });
    renderPass.setPipeline(transparent ? this.pipelineTransparent : this.pipelineOpaque);

    for (const layer of layers) {
      const textureView = textureOverrides?.get(layer.layerId) ?? this.resolveTextureView(device, layer);
      if (!textureView) {
        renderPass.end();
        return false;
      }
      const uniformBuffer = device.createBuffer({
        size: PLANE_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: `native-scene-plane-uniform-${layer.layerId}`,
      });
      temporaryBuffers.push(uniformBuffer);
      const uniformData = buildPlaneUniformData(
        buildPlaneMvp(layer, camera),
        layer.opacity,
        !transparent && layer.alphaMode === 'opaque',
        !!(layer.maskClipId && maskTextureManager?.hasMaskTexture(layer.maskClipId)),
        layer.maskInvert === true,
        layer.surfacePlan,
      );
      device.queue.writeBuffer(uniformBuffer, 0, uniformData.buffer, uniformData.byteOffset, uniformData.byteLength);
      const maskTextureView = layer.maskClipId && maskTextureManager
        ? maskTextureManager.getMaskInfo(layer.maskClipId).view
        : this.whiteMaskView;
      const bindGroup = device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: textureView },
          { binding: 2, resource: { buffer: uniformBuffer } },
          { binding: 3, resource: maskTextureView },
        ],
        label: `native-scene-plane-bind-group-${layer.layerId}`,
      });
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(6);
    }

    renderPass.end();
    return true;
  }

  resolveTextureView(device: GPUDevice, layer: ScenePlaneLayer | SceneVoxelLayer): GPUTextureView | null {
    if (layer.surfacePlan?.textured === false) return this.whiteMaskView;
    const current = this.textures.get(layer.layerId);
    const sourceState = resolvePlaneTextureSource(layer as ScenePlaneLayer, current);
    if (!sourceState) {
      return layer.videoElement || layer.videoFrame ? current?.view ?? null : null;
    }
    const sameSource = sourceState.transient === true || current?.source === sourceState.source;
    const canReuseCurrent = !!current && sameSource && current.width === sourceState.width && current.height === sourceState.height;

    let cached = current;
    if (
      !cached ||
      (sourceState.transient !== true && cached.source !== sourceState.source) ||
      cached.width !== sourceState.width ||
      cached.height !== sourceState.height
    ) {
      cached?.texture.destroy();
      const texture = device.createTexture({
        size: { width: sourceState.width, height: sourceState.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      cached = {
        source: sourceState.source,
        texture,
        view: texture.createView(),
        width: sourceState.width,
        height: sourceState.height,
        ...(sourceState.videoCanvas ? { videoCanvas: sourceState.videoCanvas } : {}),
      };
      this.textures.set(layer.layerId, cached);
    } else if (sourceState.videoCanvas) {
      cached.videoCanvas = sourceState.videoCanvas;
      cached.source = sourceState.source;
    } else if (sourceState.transient) {
      cached.source = sourceState.source;
    }

    try {
      device.queue.copyExternalImageToTexture(
        { source: sourceState.source },
        { texture: cached.texture },
        { width: sourceState.width, height: sourceState.height },
      );
    } catch (error) {
      if (canReuseCurrent) return cached.view;
      log.warn('Failed to upload native plane texture', { layerId: layer.layerId, error });
      return null;
    }
    return cached.view;
  }

  pruneTextureCache(activeLayerIds: Set<string>): void {
    for (const [layerId, entry] of this.textures) {
      if (!activeLayerIds.has(layerId)) {
        entry.texture.destroy();
        this.textures.delete(layerId);
      }
    }
  }

  dispose(): void {
    this.pipelineOpaque = null;
    this.pipelineTransparent = null;
    this.bindGroupLayout = null;
    this.sampler = null;
    this.whiteMaskTexture?.destroy();
    this.whiteMaskTexture = null;
    this.whiteMaskView = null;
    for (const entry of this.textures.values()) entry.texture.destroy();
    this.textures.clear();
  }
}
