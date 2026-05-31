// Ping-pong compositing with effects and clip transitions

import type { LayerRenderData, CompositeResult } from '../core/types';
import type { Layer } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { ColorPipeline } from '../color/ColorPipeline';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import type { TransitionPipeline } from './TransitionPipeline';
import { getTransition, applyEasing } from '../../transitions';
import { splitLayerEffects } from './layerEffectStack';

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
  // Transition temp targets (isolated from/to renders + blended result)
  transFromView?: GPUTextureView;
  transToView?: GPUTextureView;
  transBlendView?: GPUTextureView;
}

// Reusable identity layer used to composite the blended transition result onto the
// accumulator with no transform/opacity/mask (the result is already in output space).
const IDENTITY_LAYER: Layer = {
  id: '__transition_identity__',
  name: '__transition_identity__',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  source: null,
  effects: [],
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: 0,
  maskInvert: false,
  maskFeather: 0,
  maskFeatherQuality: 0,
};

export class Compositor {
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private colorPipeline: ColorPipeline | null;
  private maskTextureManager: MaskTextureManager;
  private transitionPipeline: TransitionPipeline | null;
  private lastRenderWasPing = false;

  constructor(
    compositorPipeline: CompositorPipeline,
    effectsPipeline: EffectsPipeline,
    maskTextureManager: MaskTextureManager,
    colorPipeline: ColorPipeline | null = null,
    transitionPipeline: TransitionPipeline | null = null
  ) {
    this.compositorPipeline = compositorPipeline;
    this.effectsPipeline = effectsPipeline;
    this.maskTextureManager = maskTextureManager;
    this.colorPipeline = colorPipeline;
    this.transitionPipeline = transitionPipeline;
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

    const transitionsAvailable =
      !!this.transitionPipeline &&
      !!state.transFromView &&
      !!state.transToView &&
      !!state.transBlendView;

    const consumed = new Set<number>();

    // Composite each layer
    for (let i = 0; i < layerData.length; i++) {
      if (consumed.has(i)) continue;
      const data = layerData[i];
      const transition = data.layer.transition;

      // Transition pair: render both clips isolated, blend with the transition
      // shader, then composite the result onto the accumulator as a single layer.
      if (transition && transitionsAvailable) {
        const partnerIdx = this.findTransitionPartner(layerData, i, transition.id);
        if (partnerIdx >= 0) {
          consumed.add(partnerIdx);
          const partner = layerData[partnerIdx];
          const fromData = transition.role === 'from' ? data : partner;
          const toData = transition.role === 'from' ? partner : data;

          const blended = this.renderTransitionPair(fromData, toData, transition, state, commandEncoder);
          if (blended) {
            // Composite the blended result over the accumulator (identity transform).
            this.compositeIdentity(state.transBlendView!, readView, writeView, state, commandEncoder);
            const temp = readView;
            readView = writeView;
            writeView = temp;
            usePing = !usePing;
            continue;
          }
          // Blend failed → fall through and render this layer normally.
        }
      }

      const isPingBase = readView === state.pingView;
      this.renderLayer(data, readView, writeView, isPingBase, state, commandEncoder, false);

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

  /** Find the index of the other layer in a transition pair (same transition id). */
  private findTransitionPartner(layerData: LayerRenderData[], index: number, transitionId: string): number {
    for (let j = 0; j < layerData.length; j++) {
      if (j === index) continue;
      if (layerData[j].layer.transition?.id === transitionId) return j;
    }
    return -1;
  }

  /**
   * Render the from/to clips in isolation and blend them with the transition shader.
   * Result lands in state.transBlendView. Returns false if the blend could not run.
   */
  private renderTransitionPair(
    fromData: LayerRenderData,
    toData: LayerRenderData,
    transition: NonNullable<Layer['transition']>,
    state: CompositorState,
    commandEncoder: GPUCommandEncoder
  ): boolean {
    if (!this.transitionPipeline || !state.transFromView || !state.transToView || !state.transBlendView) {
      return false;
    }

    // transBlendView doubles as a transparent base while isolating from/to.
    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: state.transBlendView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();

    // Isolated renders: composite each clip over the transparent base.
    this.renderLayer(fromData, state.transBlendView, state.transFromView, false, state, commandEncoder, true);
    this.renderLayer(toData, state.transBlendView, state.transToView, false, state, commandEncoder, true);

    // Blend from/to into transBlendView using the transition shader.
    const def = getTransition(transition.type as Parameters<typeof getTransition>[0]);
    const eased = applyEasing(transition.progress, transition.params?.easing as string | undefined);
    const uniformData = def
      ? def.packUniforms(transition.params ?? {}, eased)
      : new Float32Array([eased, 0, 0, 0, 0, 0, 0, 0]);

    return this.transitionPipeline.blend(
      commandEncoder,
      transition.type,
      state.sampler,
      state.transFromView,
      state.transToView,
      state.transBlendView,
      uniformData,
    );
  }

  /**
   * Composite a plain output-space 2D texture onto the accumulator with no
   * transform, full opacity, normal blend, and no mask.
   */
  private compositeIdentity(
    sourceView: GPUTextureView,
    baseView: GPUTextureView,
    writeView: GPUTextureView,
    state: CompositorState,
    commandEncoder: GPUCommandEncoder
  ): void {
    const outputAspect = state.outputWidth / state.outputHeight;
    const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer('__transition_identity__');
    this.compositorPipeline.updateLayerUniforms(IDENTITY_LAYER, outputAspect, outputAspect, false, uniformBuffer);

    const maskView = this.maskTextureManager.getMaskInfo('__transition_identity__').view;
    const pipeline = this.compositorPipeline.getCompositePipeline()!;
    const bindGroup = this.compositorPipeline.createCompositeBindGroup(
      state.sampler,
      baseView,
      sourceView,
      uniformBuffer,
      maskView,
    );

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: writeView,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
  }

  /**
   * Composite a single layer (with its effects/color/mask/transform) from
   * `readView` (background) onto `writeView`. When `isolated` is true the bind
   * group cache is bypassed because the background is a transition temp target,
   * not the ping/pong buffers.
   */
  private renderLayer(
    data: LayerRenderData,
    readView: GPUTextureView,
    writeView: GPUTextureView,
    isPingBase: boolean,
    state: CompositorState,
    commandEncoder: GPUCommandEncoder,
    isolated: boolean
  ): void {
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

    const { inlineEffects, complexEffects } = splitLayerEffects(layer.effects, state.skipEffects);

    // Update uniforms (includes inline effect params)
    this.compositorPipeline.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer, inlineEffects);

    // Determine the source texture/view to use for compositing
    let sourceTextureView = data.textureView;
    let sourceExternalTexture = data.externalTexture;
    let useExternalTexture = data.isVideo && !!data.externalTexture;

    const hasColorCorrection = !!this.colorPipeline && !state.skipEffects && !!layer.colorCorrection?.enabled;
    const needsSourcePreprocess =
      (hasColorCorrection || !!(complexEffects && complexEffects.length > 0)) &&
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
        }
      }
    }

    let pipeline: GPURenderPipeline;
    let bindGroup: GPUBindGroup;
    // Text canvases are edited in-place and can also be replaced when the
    // composition resolution changes. Caching their bind group by layer ID
    // can keep sampling the previous GPU texture until a full refresh.
    const isStaticTextureSource = !!layer.source?.imageElement;
    // Isolated transition renders use a transient background, so never cache.
    const cacheIsPingBase = isolated ? undefined : isPingBase;

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
        isolated ? undefined : layer.id,
        cacheIsPingBase
      );
    } else if (sourceTextureView) {
      pipeline = this.compositorPipeline.getCompositePipeline()!;
      // When complex effects are applied, the final texture view alternates between
      // effectTempView/effectTempView2 depending on effect count parity.
      // Only truly static image/text layers may reuse cached bind groups.
      // Video fallbacks, copied previews, nested comp textures and other
      // dynamic texture views can change while keeping the same layer.id.
      const canCacheBindGroup =
        !isolated &&
        isStaticTextureSource &&
        !complexEffects &&
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
        cacheIsPingBase
      );
    } else {
      return;
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
  }

  getLastRenderWasPing(): boolean {
    return this.lastRenderWasPing;
  }
}
