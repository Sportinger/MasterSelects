// Pre-renders nested compositions to offscreen textures

import type { Layer, LayerRenderData } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { TextureManager } from '../texture/TextureManager';
import type { MaskTextureManager } from '../texture/MaskTextureManager';

interface NestedCompTexture {
  texture: GPUTexture;
  view: GPUTextureView;
}

export class NestedCompRenderer {
  private device: GPUDevice;
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private textureManager: TextureManager;
  private maskTextureManager: MaskTextureManager;
  private nestedCompTextures: Map<string, NestedCompTexture> = new Map();
  private pendingTextureCleanup: GPUTexture[] = [];

  constructor(
    device: GPUDevice,
    compositorPipeline: CompositorPipeline,
    effectsPipeline: EffectsPipeline,
    textureManager: TextureManager,
    maskTextureManager: MaskTextureManager
  ) {
    this.device = device;
    this.compositorPipeline = compositorPipeline;
    this.effectsPipeline = effectsPipeline;
    this.textureManager = textureManager;
    this.maskTextureManager = maskTextureManager;
  }

  preRender(
    compositionId: string,
    nestedLayers: Layer[],
    width: number,
    height: number,
    commandEncoder: GPUCommandEncoder,
    sampler: GPUSampler
  ): GPUTextureView | null {
    // Get or create output texture
    let compTexture = this.nestedCompTextures.get(compositionId);
    if (!compTexture || compTexture.texture.width !== width || compTexture.texture.height !== height) {
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      compTexture = { texture, view: texture.createView() };
      this.nestedCompTextures.set(compositionId, compTexture);
    }

    // Create temporary ping-pong textures
    const nestedPingTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const nestedPongTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const nestedPingView = nestedPingTexture.createView();
    const nestedPongView = nestedPongTexture.createView();

    // Collect layer data
    const nestedLayerData = this.collectNestedLayerData(nestedLayers);

    // Handle empty composition
    if (nestedLayerData.length === 0) {
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: compTexture.view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      clearPass.end();
      nestedPingTexture.destroy();
      nestedPongTexture.destroy();
      return compTexture.view;
    }

    // Ping-pong compositing
    let readView = nestedPingView;
    let writeView = nestedPongView;

    // Clear first buffer
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: readView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    // Composite nested layers
    const outputAspect = width / height;
    for (const data of nestedLayerData) {
      const layer = data.layer;
      const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(`nested-${compositionId}-${layer.id}`);
      const sourceAspect = data.sourceWidth / data.sourceHeight;

      const maskLookupId = layer.maskClipId || layer.id;
      const hasMask = this.maskTextureManager.hasMaskTexture(maskLookupId);
      const maskTextureView = this.maskTextureManager.getMaskTextureView(maskLookupId) ??
                              this.maskTextureManager.getWhiteMaskView()!;

      this.compositorPipeline.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      if (data.isVideo && data.externalTexture) {
        pipeline = this.compositorPipeline.getExternalCompositePipeline()!;
        bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
          sampler, readView, data.externalTexture, uniformBuffer, maskTextureView
        );
      } else if (data.textureView) {
        pipeline = this.compositorPipeline.getCompositePipeline()!;
        bindGroup = this.compositorPipeline.createCompositeBindGroup(
          sampler, readView, data.textureView, uniformBuffer, maskTextureView
        );
      } else {
        continue;
      }

      const pass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      // Apply effects
      if (layer.effects?.length && this.effectsPipeline) {
        const result = this.effectsPipeline.applyEffects(
          commandEncoder, layer.effects, sampler,
          writeView, readView, nestedPingView, nestedPongView, width, height
        );
        if (result.swapped) {
          [readView, writeView] = [writeView, readView];
        }
      }

      // Swap
      [readView, writeView] = [writeView, readView];
    }

    // Copy result to output texture
    this.copyToOutput(commandEncoder, readView, compTexture, compositionId, sampler);

    // Queue cleanup
    this.pendingTextureCleanup.push(nestedPingTexture, nestedPongTexture);

    return compTexture.view;
  }

  private collectNestedLayerData(layers: Layer[]): LayerRenderData[] {
    const result: LayerRenderData[] = [];

    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      // VideoFrame
      if (layer.source.videoFrame) {
        const frame = layer.source.videoFrame;
        const extTex = this.textureManager.importVideoTexture(frame);
        if (extTex) {
          result.push({
            layer, isVideo: true, externalTexture: extTex, textureView: null,
            sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
          });
          continue;
        }
      }

      // WebCodecs
      if (layer.source.webCodecsPlayer) {
        const frame = layer.source.webCodecsPlayer.getCurrentFrame();
        if (frame) {
          const extTex = this.textureManager.importVideoTexture(frame);
          if (extTex) {
            result.push({
              layer, isVideo: true, externalTexture: extTex, textureView: null,
              sourceWidth: frame.displayWidth, sourceHeight: frame.displayHeight,
            });
            continue;
          }
        }
      }

      // HTMLVideo
      if (layer.source.videoElement) {
        const video = layer.source.videoElement;
        if (video.readyState >= 2) {
          const extTex = this.textureManager.importVideoTexture(video);
          if (extTex) {
            result.push({
              layer, isVideo: true, externalTexture: extTex, textureView: null,
              sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
            });
            continue;
          }
        }
      }

      // Image
      if (layer.source.imageElement) {
        const img = layer.source.imageElement;
        let texture = this.textureManager.getCachedImageTexture(img);
        if (!texture) texture = this.textureManager.createImageTexture(img) ?? undefined;
        if (texture) {
          result.push({
            layer, isVideo: false, externalTexture: null,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight,
          });
          continue;
        }
      }

      // Text
      if (layer.source.textCanvas) {
        const canvas = layer.source.textCanvas;
        const texture = this.textureManager.createCanvasTexture(canvas);
        if (texture) {
          result.push({
            layer, isVideo: false, externalTexture: null,
            textureView: this.textureManager.getImageView(texture),
            sourceWidth: canvas.width, sourceHeight: canvas.height,
          });
        }
      }
    }

    return result;
  }

  private copyToOutput(
    commandEncoder: GPUCommandEncoder,
    sourceView: GPUTextureView,
    compTexture: NestedCompTexture,
    compositionId: string,
    sampler: GPUSampler
  ): void {
    const copyUniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(`nested-copy-${compositionId}`);
    const passthroughLayer: Layer = {
      id: 'passthrough', name: 'passthrough', visible: true, opacity: 1,
      blendMode: 'normal', source: { type: 'image' }, effects: [],
      position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
    };
    this.compositorPipeline.updateLayerUniforms(passthroughLayer, 1, 1, false, copyUniformBuffer);

    const copyBindGroup = this.compositorPipeline.createCompositeBindGroup(
      sampler, sourceView, sourceView, copyUniformBuffer, this.maskTextureManager.getWhiteMaskView()!
    );

    const copyPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: compTexture.view, loadOp: 'clear', storeOp: 'store' }],
    });
    copyPass.setPipeline(this.compositorPipeline.getCompositePipeline()!);
    copyPass.setBindGroup(0, copyBindGroup);
    copyPass.draw(6);
    copyPass.end();
  }

  hasTexture(compositionId: string): boolean {
    return this.nestedCompTextures.has(compositionId);
  }

  getTexture(compositionId: string): NestedCompTexture | undefined {
    return this.nestedCompTextures.get(compositionId);
  }

  cleanupPendingTextures(): void {
    for (const texture of this.pendingTextureCleanup) {
      texture.destroy();
    }
    this.pendingTextureCleanup = [];
  }

  cleanupTexture(compositionId: string): void {
    const tex = this.nestedCompTextures.get(compositionId);
    if (tex) {
      tex.texture.destroy();
      this.nestedCompTextures.delete(compositionId);
    }
  }

  /**
   * Cache the current main render output for a composition
   */
  cacheActiveCompOutput(compositionId: string, sourceTexture: GPUTexture, width: number, height: number): void {
    let compTexture = this.nestedCompTextures.get(compositionId);
    if (!compTexture || compTexture.texture.width !== width || compTexture.texture.height !== height) {
      if (compTexture) compTexture.texture.destroy();

      const texture = this.device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      compTexture = { texture, view: texture.createView() };
      this.nestedCompTextures.set(compositionId, compTexture);
    }

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToTexture(
      { texture: sourceTexture },
      { texture: compTexture.texture },
      { width, height }
    );
    this.device.queue.submit([commandEncoder.finish()]);
  }

  destroy(): void {
    for (const tex of this.nestedCompTextures.values()) {
      tex.texture.destroy();
    }
    this.nestedCompTextures.clear();
    this.cleanupPendingTextures();
  }
}
