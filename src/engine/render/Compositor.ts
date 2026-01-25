// Ping-pong compositing with effects

import type { LayerRenderData, CompositeResult } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { MaskTextureManager } from '../texture/MaskTextureManager';

export interface CompositorState {
  device: GPUDevice;
  sampler: GPUSampler;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  outputWidth: number;
  outputHeight: number;
}

export class Compositor {
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private maskTextureManager: MaskTextureManager;
  private lastRenderWasPing = false;

  constructor(
    compositorPipeline: CompositorPipeline,
    effectsPipeline: EffectsPipeline,
    maskTextureManager: MaskTextureManager
  ) {
    this.compositorPipeline = compositorPipeline;
    this.effectsPipeline = effectsPipeline;
    this.maskTextureManager = maskTextureManager;
  }

  composite(
    layerData: LayerRenderData[],
    commandEncoder: GPUCommandEncoder,
    state: CompositorState
  ): CompositeResult {
    let readView = state.pingView;
    let writeView = state.pongView;
    let usePing = true;

    // Clear first buffer to transparent
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: readView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    // Composite each layer
    for (let i = 0; i < layerData.length; i++) {
      const data = layerData[i];
      const layer = data.layer;

      // Get uniform buffer
      const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(layer.id);

      // Calculate aspect ratios
      const sourceAspect = data.sourceWidth / data.sourceHeight;
      const outputAspect = state.outputWidth / state.outputHeight;

      // Get mask texture (single lookup instead of two)
      const maskLookupId = layer.maskClipId || layer.id;
      const maskInfo = this.maskTextureManager.getMaskInfo(maskLookupId);
      const hasMask = maskInfo.hasMask;
      const maskTextureView = maskInfo.view;

      this.maskTextureManager.logMaskState(maskLookupId, hasMask);

      // Update uniforms
      this.compositorPipeline.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      // Track which ping-pong buffer we're reading from for cache key
      const isPingBase = readView === state.pingView;

      if (data.isVideo && data.externalTexture) {
        pipeline = this.compositorPipeline.getExternalCompositePipeline()!;
        bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
          state.sampler,
          readView,
          data.externalTexture,
          uniformBuffer,
          maskTextureView,
          layer.id,
          isPingBase
        );
      } else if (data.textureView) {
        pipeline = this.compositorPipeline.getCompositePipeline()!;
        bindGroup = this.compositorPipeline.createCompositeBindGroup(
          state.sampler,
          readView,
          data.textureView,
          uniformBuffer,
          maskTextureView,
          layer.id,
          isPingBase
        );
      } else {
        continue;
      }

      // Render pass
      const compositePass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: writeView,
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      compositePass.setPipeline(pipeline);
      compositePass.setBindGroup(0, bindGroup);
      compositePass.draw(6);
      compositePass.end();

      // Apply effects
      if (layer.effects && layer.effects.length > 0) {
        const result = this.effectsPipeline.applyEffects(
          commandEncoder,
          layer.effects,
          state.sampler,
          writeView,
          readView,
          state.pingView,
          state.pongView,
          state.outputWidth,
          state.outputHeight
        );

        if (result.swapped) {
          const tempView = readView;
          readView = writeView;
          writeView = tempView;
          usePing = !usePing;
        }
      }

      // Swap buffers
      const temp = readView;
      readView = writeView;
      writeView = temp;
      usePing = !usePing;
    }

    this.lastRenderWasPing = usePing;

    return {
      finalView: readView,
      usedPing: !usePing,
      layerCount: layerData.length,
    };
  }

  getLastRenderWasPing(): boolean {
    return this.lastRenderWasPing;
  }
}
