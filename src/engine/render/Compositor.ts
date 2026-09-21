// Ping-pong compositing with effects

import type { LayerRenderData, CompositeResult } from '../core/types';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { EffectsPipeline } from '../../effects/EffectsPipeline';
import type { ColorPipeline } from '../color/ColorPipeline';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import { getPixelParticleDisintegrateRenderer } from '../particles/PixelParticleDisintegrateRenderer';
import { splitLayerEffects } from './layerEffectStack';
import { Logger } from '../../services/logger';
import {
  isSupportedAdjustmentEffectType,
  UnsupportedAdjustmentEffectError,
} from '../../services/motionDesign/adjustment/supportedEffects';
import { calculateSourcePixelScale } from '../../utils/sourcePixelScale';
import type { SplitCompareSettings } from '../../stores/splitCompareStore';
import { getVideoFrameEffectSourceRotation } from './externalEffectSourceOrientation';
import { resolveSurfaceFrameEffects } from '../../services/planarTracking/surfaceEffects';
import { sampleTerrainCamera } from '../../services/planarTracking/terrainProjection';
import type { TerrainProjectionDescriptor } from '../../types/terrainAttachment';
import type { TrackingSourceTransform } from '../../types/terrainAttachment';
import { TerrainAnchorConnectorPipeline } from './TerrainAnchorConnectorPipeline';
import { PlanarTrackingProjectionPipeline } from './PlanarTrackingProjectionPipeline';
import { resolvePlanarTrackingProjection } from '../../services/planarTracking/trackingBindingRender';
import { IDENTITY_TRACKING_SOURCE_TRANSFORM } from '../../services/planarTracking/trackingSourceTransform';
import { indexTrackingSourceTransforms } from './trackingSourceFrames';
import { nodePreviewTextureTap } from '../../services/nodePreview/NodePreviewTextureTap';
import { captureImageOperatorPreviews } from '../../services/nodePreview/imageOperatorTexturePreviews';
import { isLocalImageEffectType } from '../../services/operators/effectGraphOwner';
import {
  layerPositionForTerrainScreenAnchor,
  resolveTerrainScreenAnchors,
} from './terrainScreenAnchor';
import type { EffectFrameHistoryContext } from '../../effects/EffectsPipeline';
import type { EffectRenderClockContext } from '../../effects/_shared/byteTexture';

const log = Logger.create('Compositor');

export function resolveTerrainProjection(
  projection: TerrainProjectionDescriptor | undefined,
  displayedMediaTimes: ReadonlyMap<string, number>,
  sourceTransforms?: ReadonlyMap<string, TrackingSourceTransform>,
): TerrainProjectionDescriptor | null {
  if (!projection?.attachment.visible) return null;
  // `targetMediaTime` is an intended seek, which may differ from a held or
  // still-decoding video frame. Terrain poses are tied to decoded frame PTS.
  const targetVideoClipId = projection.attachment.targetVideoClipId;
  const displayedMediaTime = targetVideoClipId
    ? displayedMediaTimes.get(targetVideoClipId)
    : projection.sourcePresentedTime;
  if (displayedMediaTime === undefined) return null;
  const sourceTransform = targetVideoClipId
    ? sourceTransforms?.get(targetVideoClipId) ?? (sourceTransforms ? undefined : IDENTITY_TRACKING_SOURCE_TRANSFORM)
    : IDENTITY_TRACKING_SOURCE_TRANSFORM;
  if (!sourceTransform) return null;
  const camera = sampleTerrainCamera(projection.terrain, displayedMediaTime);
  return camera ? { ...projection, camera, sourceTransform } : null;
}

export function indexDisplayedMediaTimes(layerData: readonly LayerRenderData[]): ReadonlyMap<string, number> {
  const times = new Map<string, number>();
  for (const data of layerData) {
    if (data.layer.sourceClipId && typeof data.displayedMediaTime === 'number' && Number.isFinite(data.displayedMediaTime)) {
      times.set(data.layer.sourceClipId, data.displayedMediaTime);
    }
  }
  return times;
}

export interface CompositorState {
  device: GPUDevice;
  sampler: GPUSampler;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  outputWidth: number;
  outputHeight: number;
  /** Composition-space resolution against which stored layer scales are defined. */
  referenceWidth?: number;
  referenceHeight?: number;
  skipEffects?: boolean;
  // Additional textures for effect pre-processing
  effectTempTexture?: GPUTexture;
  effectTempView?: GPUTextureView;
  effectTempTexture2?: GPUTexture;
  effectTempView2?: GPUTextureView;
  effectCompareView?: GPUTextureView;
  splitCompare?: SplitCompareSettings;
  motionTime?: number;
  particleQuality?: 'preview' | 'export';
  /** Isolates GPU caches for repeated nested/render-target occurrences. */
  resourceNamespace?: string;
  /** Portable event metadata for stateful GPU effects. */
  frameHistory?: Omit<EffectFrameHistoryContext, 'scopeId'>;
  historyScopeId?: string;
  effectRenderClock?: EffectRenderClockContext;
}

export class Compositor {
  private compositorPipeline: CompositorPipeline;
  private effectsPipeline: EffectsPipeline;
  private colorPipeline: ColorPipeline | null;
  private maskTextureManager: MaskTextureManager;
  private terrainAnchorConnector?: TerrainAnchorConnectorPipeline;
  private planarTrackingProjection?: PlanarTrackingProjectionPipeline;
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

  destroy(): void {
    this.terrainAnchorConnector?.destroy();
    this.terrainAnchorConnector = undefined;
    this.planarTrackingProjection?.destroy();
    this.planarTrackingProjection = undefined;
  }

  composite(
    layerData: LayerRenderData[],
    commandEncoder: GPUCommandEncoder,
    state: CompositorState
  ): CompositeResult {
    let readView = state.pingView;
    let writeView = state.pongView;
    let usePing = true;
    const displayedMediaTimes = indexDisplayedMediaTimes(layerData);
    const referenceWidth = state.referenceWidth ?? state.outputWidth;
    const referenceHeight = state.referenceHeight ?? state.outputHeight;
    const sourceTransforms = indexTrackingSourceTransforms(layerData, {
      width: referenceWidth,
      height: referenceHeight,
    });
    const screenAnchors = resolveTerrainScreenAnchors(
      layerData.map(data=>data.layer),
      displayedMediaTimes,
      sourceTransforms,
    );

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
      const sourceLayer = data.layer;
      const resolvedScreenAnchor = screenAnchors.get(sourceLayer.id);
      const layer = resolvedScreenAnchor
        ? layerPositionForTerrainScreenAnchor(sourceLayer, resolvedScreenAnchor)
        : sourceLayer;
      const isAdjustmentLayer = layer.source?.type === 'motion-adjustment';
      const resourceLayerId = state.resourceNamespace
        ? JSON.stringify([state.resourceNamespace, layer.id])
        : layer.id;

      // An adjustment layer has no source of its own. During scrub fast-paths,
      // skipping its effects must therefore leave the accumulator untouched.
      if (isAdjustmentLayer && state.skipEffects) {
        continue;
      }
      if ((sourceLayer.terrainScreenAnchor || sourceLayer.trackingScreenAnchor) && !resolvedScreenAnchor) continue;
      const connector = sourceLayer.terrainAnchorConnector;
      if (connector) {
        const anchorLayer = layerData.find(({ layer: candidate }) => (
          candidate.sourceClipId === connector.anchorClipId
        ))?.layer;
        const anchor = anchorLayer
          ? screenAnchors.get(anchorLayer.id)
          : null;
        if (!anchor) continue;
        const cardPosition = layerPositionForTerrainScreenAnchor(anchorLayer!, anchor).position;
        this.terrainAnchorConnector ??= new TerrainAnchorConnectorPipeline(state.device);
        if (!this.terrainAnchorConnector.encode(
          commandEncoder, connector, state.sampler, readView, writeView,
          anchor.contact, { x: (cardPosition.x + 1) / 2, y: (cardPosition.y + 1) / 2 },
          state.outputWidth, state.outputHeight, layer.opacity, resourceLayerId,
        )) continue;
        const previous = readView;
        readView = writeView;
        writeView = previous;
        usePing = !usePing;
        continue;
      }

      const unsupportedAdjustmentEffect = isAdjustmentLayer
        ? layer.effects.find((effect) => !isSupportedAdjustmentEffectType(effect.type))
        : undefined;
      if (unsupportedAdjustmentEffect) {
        const error = new UnsupportedAdjustmentEffectError(
          layer.id,
          unsupportedAdjustmentEffect.id,
          unsupportedAdjustmentEffect.type,
        );
        if (state.particleQuality === 'export') {
          throw error;
        }
        log.warn('Skipping adjustment layer with unsupported effect', {
          layerId: layer.id,
          effectId: unsupportedAdjustmentEffect.id,
          effectType: unsupportedAdjustmentEffect.type,
        });
        continue;
      }

      const adjustmentEffects = resolveSurfaceFrameEffects(layer.effects, data.displayedMediaTime);
      const visualAdjustmentEffects = adjustmentEffects.filter(effect => !effect.type.startsWith('audio-'));

      // Get uniform buffer
      const uniformBuffer = this.compositorPipeline.getOrCreateUniformBuffer(resourceLayerId);

      // Calculate aspect ratios
      const intrinsicWidth = layer.source?.intrinsicWidth;
      const intrinsicHeight = layer.source?.intrinsicHeight;
      // Canvas-backed sources can resize without rebuilding the durable layer
      // metadata (notably an iPad live camera after an orientation change).
      // The collected dimensions describe the texture being composited now;
      // stale intrinsic metadata would squeeze that texture into the old ratio.
      const useRenderedSourceDimensions = Boolean(layer.source?.canvasElement);
      const sourceWidth = isAdjustmentLayer
        ? referenceWidth
        : !useRenderedSourceDimensions
          && typeof intrinsicWidth === 'number' && Number.isFinite(intrinsicWidth) && intrinsicWidth > 0
          ? intrinsicWidth
          : data.sourceWidth;
      const sourceHeight = isAdjustmentLayer
        ? referenceHeight
        : !useRenderedSourceDimensions
          && typeof intrinsicHeight === 'number' && Number.isFinite(intrinsicHeight) && intrinsicHeight > 0
          ? intrinsicHeight
          : data.sourceHeight;
      const sourceAspect = sourceWidth / sourceHeight;
      const outputAspect = state.outputWidth / state.outputHeight;
      const sourcePixelScale = calculateSourcePixelScale(
        sourceWidth,
        sourceHeight,
        referenceWidth,
        referenceHeight,
      );

      // Get mask texture (single lookup instead of two)
      const maskLookupId = layer.maskClipId || layer.id;
      const maskInfo = this.maskTextureManager.getMaskInfo(maskLookupId);
      const hasMask = maskInfo.hasMask;
      const maskTextureView = maskInfo.view;
      if (layer.sourceClipId) nodePreviewTextureTap.capture(`mask:${layer.sourceClipId}`, state.device, commandEncoder, state.sampler, maskTextureView, sourceWidth, sourceHeight);

      this.maskTextureManager.logMaskState(maskLookupId, hasMask);

      const orderedColorIndex = !isAdjustmentLayer && !!this.colorPipeline && !state.skipEffects && layer.colorCorrection?.enabled
        ? Math.min(visualAdjustmentEffects.length, Math.max(0, Math.trunc(layer.colorCorrection.stackIndex)))
        : null;
      const beforeColorEffects = orderedColorIndex === null ? visualAdjustmentEffects : visualAdjustmentEffects.slice(0, orderedColorIndex);
      const afterColorEffects = orderedColorIndex === null ? [] : visualAdjustmentEffects.slice(orderedColorIndex);
      const forceOrderedPasses = orderedColorIndex !== null || visualAdjustmentEffects.some(effect => nodePreviewTextureTap.has(`effect:${effect.id}`));
      const beforeColorStack = splitLayerEffects(beforeColorEffects, state.skipEffects, forceOrderedPasses);
      const afterColorStack = splitLayerEffects(afterColorEffects, state.skipEffects, forceOrderedPasses);
      const inlineEffects = beforeColorStack.inlineEffects;
      const complexEffects = [...(beforeColorStack.complexEffects ?? []), ...(afterColorStack.complexEffects ?? [])];
      const renderEffects = [...(beforeColorStack.renderEffects ?? []), ...(afterColorStack.renderEffects ?? [])];
      const unsupportedAfterRenderEffect = [...(beforeColorStack.unsupportedAfterRenderEffect ?? []), ...(afterColorStack.unsupportedAfterRenderEffect ?? [])];
      if (unsupportedAfterRenderEffect?.length) {
        log.warn('Ignoring effects after terminal render effect', {
          layerId: layer.id,
          effects: unsupportedAfterRenderEffect.map((effect) => effect.type),
        });
      }

      const requiresEffectTargets = isAdjustmentLayer
        && (
          !!complexEffects?.length
          || !!renderEffects?.length
        );
      if (
        requiresEffectTargets
        && (!state.effectTempView || !state.effectTempView2)
      ) {
        const error = new Error(
          `Adjustment layer ${layer.id} requires effect render targets`,
        );
        if (state.particleQuality === 'export') {
          throw error;
        }
        log.warn('Skipping adjustment layer without effect render targets', {
          layerId: layer.id,
        });
        continue;
      }

      const hasColorCorrection = !isAdjustmentLayer
        && !!this.colorPipeline
        && !state.skipEffects
        && !!layer.colorCorrection?.enabled;
      const colorPreview = !!layer.sourceClipId && (nodePreviewTextureTap.has(`color-input:${layer.sourceClipId}`)
        || nodePreviewTextureTap.has(`color:${layer.sourceClipId}`) || nodePreviewTextureTap.matching(`color-node:${layer.sourceClipId}:`).length > 0);
      const requestedTerrainProjection = !isAdjustmentLayer
        ? layer.terrainProjection
        : undefined;
      const terrainProjection = !isAdjustmentLayer
        ? resolveTerrainProjection(requestedTerrainProjection, displayedMediaTimes, sourceTransforms)
        : null;
      const requestedTrackingProjection = !isAdjustmentLayer
        ? layer.trackingProjection
        : undefined;
      const trackingProjection = !isAdjustmentLayer
        ? resolvePlanarTrackingProjection(requestedTrackingProjection, displayedMediaTimes, sourceTransforms)
        : null;
      // A terrain attachment has no meaningful flat fallback: showing it as a
      // regular layer would detach it from a held/missing source video frame.
      if (requestedTerrainProjection && !terrainProjection) continue;
      if (requestedTrackingProjection && !trackingProjection) continue;
      const needsSourcePreprocess =
        (hasColorCorrection || colorPreview ||
          !!(complexEffects && complexEffects.length > 0) ||
          !!(renderEffects && renderEffects.length > 0) ||
          (!!(terrainProjection || trackingProjection) && !!data.externalTexture)) &&
        !!state.effectTempView &&
        !!state.effectTempView2;
      const effectSourceRotation = needsSourcePreprocess
        ? getVideoFrameEffectSourceRotation(layer)
        : 0;

      // Update uniforms (includes inline effect params)
      this.compositorPipeline.updateLayerUniforms(
        layer,
        sourceAspect,
        outputAspect,
        hasMask,
        uniformBuffer,
        inlineEffects,
        sourcePixelScale,
        effectSourceRotation === 0 ? undefined : 0,
      );

      // Track which ping-pong buffer we're reading from for cache key
      const isPingBase = readView === state.pingView;

      // Determine the source texture/view to use for compositing
      // Adjustment layers process the accumulated frame below them. readView
      // remains the untouched snapshot while effects render into temp views.
      let sourceTextureView = isAdjustmentLayer ? readView : data.textureView;
      let sourceExternalTexture = isAdjustmentLayer ? null : data.externalTexture;
      let useExternalTexture = !isAdjustmentLayer && data.isVideo && !!data.externalTexture;

      if (needsSourcePreprocess && state.effectTempView && state.effectTempView2) {
        let copied = false;
        let copiedToTempView = false;

        if (useExternalTexture && sourceExternalTexture) {
          const copyPipeline = this.compositorPipeline.getExternalCopyPipeline?.(
            effectSourceRotation,
          );
          const copyBindGroup = copyPipeline
            ? this.compositorPipeline.createExternalCopyBindGroup?.(
                state.sampler,
                sourceExternalTexture,
                resourceLayerId
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
            copyPass.draw(3);
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

            const applyComplexEffects = (effects: typeof complexEffects, compare: boolean) => {
              if (!effects.length || !sourceTextureView) return;
              const inputView = sourceTextureView;
              const effectOutput = inputView === state.effectTempView ? state.effectTempView2! : state.effectTempView!;
              const effectResult = this.effectsPipeline.applyEffects(
                commandEncoder, effects, state.sampler, inputView, effectOutput,
                state.effectTempView!, state.effectTempView2!, state.outputWidth, state.outputHeight,
                state.effectTempTexture, state.effectTempTexture2,
                compare && state.effectCompareView && state.splitCompare
                  ? { outputView: state.effectCompareView, settings: state.splitCompare }
                  : undefined,
                state.motionTime ?? layer.source?.mediaTime ?? 0,
                state.frameHistory ? { ...state.frameHistory, scopeId: JSON.stringify([state.historyScopeId ?? 'timeline', resourceLayerId]) } : undefined,
                state.effectRenderClock ? { ...state.effectRenderClock, scopeId: JSON.stringify([state.effectRenderClock.scopeId, resourceLayerId]) } : undefined,
              );
              sourceTextureView = effectResult.finalView;
            };
            const applyRenderEffects = (effects: typeof renderEffects) => {
              if (!effects.length || !sourceTextureView) return;
              const renderEffect = effects[0];
              const inputView = sourceTextureView;
              const particleAccumulation = inputView === state.effectTempView ? state.effectTempView2! : state.effectTempView!;
              const particleOutput = particleAccumulation === state.effectTempView ? state.effectTempView2! : state.effectTempView!;
              try {
                getPixelParticleDisintegrateRenderer(state.device).render({
                  commandEncoder, sampler: state.sampler, sourceView: inputView,
                  accumulationView: particleAccumulation, outputView: particleOutput,
                  outputWidth: state.outputWidth, outputHeight: state.outputHeight, effect: renderEffect,
                  motionTime: layer.source?.mediaTime ?? state.motionTime ?? 0,
                  quality: state.particleQuality ?? 'preview',
                });
                sourceTextureView = particleOutput;
              } catch (error) {
                log.warn('Particle render effect failed; falling back to source texture', { layerId: layer.id, effectType: renderEffect.type, error });
              }
            };

            applyComplexEffects(beforeColorStack.complexEffects ?? [], orderedColorIndex === null || (!hasColorCorrection && !afterColorStack.complexEffects?.length));
            applyRenderEffects(beforeColorStack.renderEffects ?? []);

            if (layer.sourceClipId && colorPreview) {
              nodePreviewTextureTap.capture(`color-input:${layer.sourceClipId}`, state.device, commandEncoder, state.sampler, sourceTextureView, sourceWidth, sourceHeight);
              this.colorPipeline?.previewGradeOutputs(layer.sourceClipId, commandEncoder, layer.colorCorrection, state.sampler, sourceTextureView, { width: sourceWidth, height: sourceHeight });
            }
            if (hasColorCorrection) {
              const colorResult = this.colorPipeline!.applyGrade(
                commandEncoder,
                layer.colorCorrection,
                state.sampler,
                sourceTextureView,
                state.effectTempView2,
                resourceLayerId,
                undefined,
                { width: state.outputWidth, height: state.outputHeight },
              );
              sourceTextureView = colorResult.finalView;
            }
            if (layer.sourceClipId) nodePreviewTextureTap.capture(`color:${layer.sourceClipId}`, state.device, commandEncoder, state.sampler, sourceTextureView, sourceWidth, sourceHeight);
            applyComplexEffects(afterColorStack.complexEffects ?? [], true);
            applyRenderEffects(afterColorStack.renderEffects ?? []);
          }
        }
      }

      if (terrainProjection) {
        if (!sourceTextureView) {
          log.warn('Skipping terrain projection without a sampleable source texture', {
            layerId: layer.id,
            sourceType: layer.source?.type,
          });
          continue;
        }
        const projected = this.effectsPipeline.projectTerrainContent(
          commandEncoder,
          terrainProjection,
          state.sampler,
          sourceTextureView,
          readView,
          writeView,
          state.outputWidth,
          state.outputHeight,
          layer.opacity,
          resourceLayerId,
        );
        if (!projected) continue;
        const previous = readView;
        readView = writeView;
        writeView = previous;
        usePing = !usePing;
        continue;
      }

      if (trackingProjection) {
        if (!sourceTextureView) {
          log.warn('Skipping planar tracking projection without a sampleable source texture', {
            layerId: layer.id,
            sourceType: layer.source?.type,
          });
          continue;
        }
        this.planarTrackingProjection ??= new PlanarTrackingProjectionPipeline(state.device);
        const projected = this.planarTrackingProjection.encode(
          commandEncoder,
          trackingProjection,
          state.sampler,
          sourceTextureView,
          readView,
          writeView,
          state.outputWidth,
          state.outputHeight,
          layer.opacity,
          resourceLayerId,
        );
        if (!projected) continue;
        const previous = readView;
        readView = writeView;
        writeView = previous;
        usePing = !usePing;
        continue;
      }

      if (inlineEffects.operatorProgram) {
        const effect = adjustmentEffects.find(item => item.enabled && isLocalImageEffectType(item.type));
        const source = useExternalTexture && sourceExternalTexture
          ? { kind: 'external' as const, texture: sourceExternalTexture }
          : sourceTextureView ? { kind: 'texture' as const, view: sourceTextureView } : undefined;
        if (effect && source) captureImageOperatorPreviews({ effect, source, device: state.device,
          encoder: commandEncoder, sampler: state.sampler, width: sourceWidth, height: sourceHeight,
          timelineTimeSeconds: state.motionTime ?? 0 });
      }
      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;
      // Text canvases are edited in-place and can also be replaced when the
      // composition resolution changes. Caching their bind group by layer ID
      // can keep sampling the previous GPU texture until a full refresh.
      const isStaticTextureSource = !!layer.source?.imageElement;

      if (useExternalTexture && sourceExternalTexture) {
        if (!isStaticTextureSource) {
          this.compositorPipeline.invalidateBindGroupCache(resourceLayerId);
        }
        pipeline = this.compositorPipeline.getExternalCompositePipeline(inlineEffects.operatorProgram)!;
        bindGroup = this.compositorPipeline.createExternalCompositeBindGroup(
          state.sampler,
          readView,
          sourceExternalTexture,
          uniformBuffer,
          maskTextureView,
          resourceLayerId,
          isPingBase
        );
      } else if (sourceTextureView) {
        pipeline = this.compositorPipeline.getCompositePipeline(inlineEffects.operatorProgram)!;
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
        const cacheLayerId = canCacheBindGroup ? resourceLayerId : undefined;
        if (!canCacheBindGroup) {
          this.compositorPipeline.invalidateBindGroupCache(resourceLayerId);
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
      compositePass.draw(3);
      compositePass.end();
      if (layer.sourceClipId) nodePreviewTextureTap.draw(`output:${layer.sourceClipId}`, state.device, commandEncoder, state.outputWidth, state.outputHeight, pass => {
        const empty = nodePreviewTextureTap.transparentView(state.device);
        const previewBind = useExternalTexture && sourceExternalTexture
          ? this.compositorPipeline.createExternalCompositeBindGroup(state.sampler, empty, sourceExternalTexture, uniformBuffer, maskTextureView)
          : this.compositorPipeline.createCompositeBindGroup(state.sampler, empty, sourceTextureView!, uniformBuffer, maskTextureView);
        pass.setPipeline(pipeline); pass.setBindGroup(0, previewBind); pass.draw(3);
      });

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
