// Ping-pong compositing with effects

import type { LayerRenderData, CompositeResult } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { ColorPipeline } from '../color/ColorPipeline';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import { getPixelParticleDisintegrateRenderer } from '../particles/PixelParticleDisintegrateRenderer';
import { splitLayerEffects } from './layerEffectStack';
import { Logger } from '../../services/logger';

const log = Logger.create('Compositor');

export interface CompositorState {
  device: GPUDevice;
  sampler: GPUSampler;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  outputWidth: number;
  outputHeight: number;
  skipEffects?: boolean;
  // Additional textures for effect pre-processing
  effectTempTexture?: GPUTexture;
  effectTempView?: GPUTextureView;
  effectTempTexture2?: GPUTexture;
  effectTempView2?: GPUTextureView;
  motionTime?: number;
  particleQuality?: 'preview' | 'export';
}

export class Compositor {
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private colorPipeline: ColorPipeline | null;
  private maskTextureManager: MaskTextureManager;
  private lastRenderWasPing = false;

  constructor(
    compositorPipeline: CompositorPipeline,
    effectsPipeline: EffectsPipeline,
    maskTextureManager: MaskTextureManager,
    colorPipeline: ColorPipeline | null = null
  ) {
    this.compositorPipeline = compositorPipeline;
    this.effectsPipeline = effectsPipeline;
    this.maskTextureManager = maskTextureManager;
    this.colorPipeline = colorPipeline;
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

      const {
        inlineEffects,
        complexEffects,
        renderEffects,
        unsupportedAfterRenderEffect,
      } = splitLayerEffects(layer.effects, state.skipEffects);
      if (unsupportedAfterRenderEffect?.length) {
        log.warn('Ignoring effects after terminal render effect', {
          layerId: layer.id,
          effects: unsupportedAfterRenderEffect.map((effect) => effect.type),
        });
      }

      // Update uniforms (includes inline effect params)
      this.compositorPipeline.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer, inlineEffects);

      // Track which ping-pong buffer we're reading from for cache key
      const isPingBase = readView === state.pingView;

      // Determine the source texture/view to use for compositing
      let sourceTextureView = data.textureView;
      let sourceExternalTexture = data.externalTexture;
      let useExternalTexture = data.isVideo && !!data.externalTexture;

      const hasColorCorrection = !!this.colorPipeline && !state.skipEffects && !!layer.colorCorrection?.enabled;
      const needsSourcePreprocess =
        (hasColorCorrection ||
          !!(complexEffects && complexEffects.length > 0) ||
          !!(renderEffects && renderEffects.length > 0)) &&
        !!state.effectTempView &&
        !!state.effectTempView2;

      if (needsSourcePreprocess && state.effectTempView && state.effectTempView2) {
        let copied = false;
        let copiedToTempView = false;

        if (useExternalTexture && sourceExternalTexture) {
          const copyPipeline = this.compositorPipeline.getExternalCopyPipeline?.();
          const copyBindGroup = copyPipeline
            ? this.compositorPipeline.createExternalCopyBindGroup?.(
                state.sampler,
                sourceExternalTexture,
                layer.id
              )
            : null;

          if (copyPipeline && copyBindGroup) {
            const copyPass = commandEncoder.beginRenderPass({
              colorAttachments: [{
                view: state.effectTempView,
                loadOp: 'clear',
                storeOp: 'store',
              }],
            });
            copyPass.setPipeline(copyPipeline);
            copyPass.setBindGroup(0, copyBindGroup);
            copyPass.draw(6);
            copyPass.end();
            copied = true;
            copiedToTempView = true;
          }
        } else if (sourceTextureView) {
          copied = true;
        }

        if (copied) {
          if (copiedToTempView) {
            sourceTextureView = state.effectTempView;
          }
          if (sourceTextureView) {
            useExternalTexture = false;
            sourceExternalTexture = null;

            if (hasColorCorrection) {
              const colorResult = this.colorPipeline!.applyGrade(
                commandEncoder,
                layer.colorCorrection,
                state.sampler,
                sourceTextureView,
                state.effectTempView2,
                layer.id
              );
              sourceTextureView = colorResult.finalView;
            }

            if (complexEffects && complexEffects.length > 0) {
              const effectOutput = sourceTextureView === state.effectTempView
                ? state.effectTempView2
                : state.effectTempView;
              const effectResult = this.effectsPipeline.applyEffects(
                commandEncoder,
                complexEffects,
                state.sampler,
                sourceTextureView,
                effectOutput,
                state.effectTempView,
                state.effectTempView2,
                state.outputWidth,
                state.outputHeight,
                state.effectTempTexture,
                state.effectTempTexture2
              );
              sourceTextureView = effectResult.finalView;
            }

            if (renderEffects && renderEffects.length > 0) {
              const renderEffect = renderEffects[0];
              const particleAccumulation = sourceTextureView === state.effectTempView
                ? state.effectTempView2
                : state.effectTempView;
              const particleOutput = particleAccumulation === state.effectTempView
                ? state.effectTempView2
                : state.effectTempView;
              try {
                const renderer = getPixelParticleDisintegrateRenderer(state.device);
                renderer.render({
                  commandEncoder,
                  sampler: state.sampler,
                  sourceView: sourceTextureView,
                  accumulationView: particleAccumulation,
                  outputView: particleOutput,
                  outputWidth: state.outputWidth,
                  outputHeight: state.outputHeight,
                  effect: renderEffect,
                  motionTime: layer.source?.mediaTime ?? state.motionTime ?? 0,
                  quality: state.particleQuality ?? 'preview',
                });
                sourceTextureView = particleOutput;
              } catch (error) {
                log.warn('Particle render effect failed; falling back to source texture', {
                  layerId: layer.id,
                  effectType: renderEffect.type,
                  error,
                });
              }
            }
          }
        }
      }

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;
      // Text canvases are edited in-place and can also be replaced when the
      // composition resolution changes. Caching their bind group by layer ID
      // can keep sampling the previous GPU texture until a full refresh.
      const isStaticTextureSource = !!layer.source?.imageElement;

      if (useExternalTexture && sourceExternalTexture) {
        if (!isStaticTextureSource) {
          this.compositorPipeline.invalidateBindGroupCache(layer.id);
        }
        pipeline = this.compositorPipeline.getExternalCompositePipeline()!;
        bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
          state.sampler,
          readView,
          sourceExternalTexture,
          uniformBuffer,
          maskTextureView,
          layer.id,
          isPingBase
        );
      } else if (sourceTextureView) {
        pipeline = this.compositorPipeline.getCompositePipeline()!;
        // When complex effects are applied, the final texture view alternates between
        // effectTempView/effectTempView2 depending on effect count parity.
        // Only truly static image/text layers may reuse cached bind groups.
        // Video fallbacks, copied previews, nested comp textures and other
        // dynamic texture views can change while keeping the same layer.id.
        const canCacheBindGroup =
          isStaticTextureSource &&
          !complexEffects &&
          !renderEffects &&
          !hasColorCorrection &&
          !data.isDynamic;
        const cacheLayerId = canCacheBindGroup ? layer.id : undefined;
        if (!canCacheBindGroup) {
          this.compositorPipeline.invalidateBindGroupCache(layer.id);
        }
        bindGroup = this.compositorPipeline.createCompositeBindGroup(
          state.sampler,
          readView,
          sourceTextureView,
          uniformBuffer,
          maskTextureView,
          cacheLayerId,
          isPingBase
        );
      } else {
        continue;
      }

      // Render pass - composite the (possibly effected) layer onto the accumulated result
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
