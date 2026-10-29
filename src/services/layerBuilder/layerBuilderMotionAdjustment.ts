import type { BlendMode, Effect, Layer, TimelineClip } from '../../types';
import { admitAdjustmentEffectsForRender } from '../motionDesign/adjustment/adjustmentEffectRenderAdmission';
import { adjustmentLayerDefinitionProblem, admitAdjustmentLayerForRender } from '../motionDesign/adjustment/adjustmentLayerRenderAdmission';
import { Logger } from '../logger';
import { getClipTimeInfo } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

const log = Logger.create('MotionAdjustmentLayerBuilder');

export interface MotionAdjustmentCompositionSize {
  width: number;
  height: number;
}

type BuildMotionAdjustmentLayerParams = {
  clip: TimelineClip;
  layerIndex: number;
  ctx: FrameContext;
  transformCache: TransformCache;
  compositionSize: MotionAdjustmentCompositionSize;
  opacityOverride?: number;
};

type BuildMotionAdjustmentLayerFromBaseParams = {
  clip: TimelineClip;
  baseLayer: Omit<Layer, 'source'>;
  compositionSize: MotionAdjustmentCompositionSize;
  surface: 'preview' | 'nested-preview' | 'export';
};

export function buildLayerBuilderMotionAdjustmentLayer(
  params: BuildMotionAdjustmentLayerParams,
): Layer | null {
  const {
    clip,
    layerIndex,
    ctx,
    transformCache,
    compositionSize,
    opacityOverride,
  } = params;
  const timeInfo = getClipTimeInfo(ctx, clip);
  const transform = transformCache.getTransform(
    `${ctx.activeCompId}_${layerIndex}_${clip.id}`,
    ctx.getInterpolatedTransform(clip.id, timeInfo.clipLocalTime),
  );
  const baseLayer: Omit<Layer, 'source'> = {
    id: `${ctx.activeCompId}_layer_${layerIndex}_${clip.id}`,
    name: clip.name,
    sourceClipId: clip.id,
    visible: true,
    opacity: opacityOverride === undefined
      ? transform.opacity
      : transform.opacity * opacityOverride,
    blendMode: transform.blendMode as BlendMode,
    effects: ctx.getInterpolatedEffects(clip.id, timeInfo.clipLocalTime),
    colorCorrection: ctx.getInterpolatedColorCorrection(clip.id, timeInfo.clipLocalTime),
    position: transform.position,
    anchor: transform.anchor,
    scale: transform.scale,
    rotation: transform.rotation,
  };
  if (clip.masks?.some((mask) => mask.enabled !== false)) {
    baseLayer.maskClipId = clip.id;
    baseLayer.maskInvert = false;
    baseLayer.masks = structuredClone(clip.masks);
  }
  if (clip.sourceRect) baseLayer.sourceRect = { ...clip.sourceRect };

  return buildMotionAdjustmentLayerFromBase({
    clip,
    baseLayer,
    compositionSize,
    surface: 'preview',
  });
}

/**
 * Shared admission boundary for main, nested, and export builders. Layer-level state an adjustment
 * layer cannot render (transform, 3D, crop rectangle, transition, scene graph, custom nodes, an
 * unsupported mix) is skipped property by property (adjustmentLayerRenderAdmission.ts): the layer
 * renders without it, the log names it once, and the inspector, phone sheets and export notes show
 * it. Effects are admitted one by one (adjustmentEffectRenderAdmission.ts). Only a broken layer
 * definition stops the layer: preview leaves it out (the inspector says "Render blocked"), export
 * aborts with the reason instead of producing different media.
 */
export function buildMotionAdjustmentLayerFromBase(
  params: BuildMotionAdjustmentLayerFromBaseParams,
): Layer | null {
  const { clip, baseLayer, compositionSize, surface } = params;

  const problem = adjustmentLayerDefinitionProblem(clip) ?? compositionSizeProblem(compositionSize);
  if (problem) {
    reportOnce(`invalid|${clip.id}|${surface}|${problem}`, () => log.warn('Motion adjustment layer rejected by render admission', {
      clipId: clip.id, surface, reason: problem,
    }));
    if (surface === 'export') throw new Error(`Adjustment layer "${clip.name}" cannot render: ${problem}`);
    return null;
  }
  const admission = admitAdjustmentLayerForRender(clip, baseLayer);
  for (const item of admission.skipped) {
    reportOnce(`skip|${clip.id}|${item.code}`, () => log.warn('Adjustment layer property skipped; the rest of the layer renders', {
      clipId: clip.id, surface, property: item.code, reason: item.reason,
    }));
  }
  const normalizedEffects = normalizeAdjustmentEffects(clip.id, admission.layer.effects, surface);
  return {
    ...admission.layer,
    effects: normalizedEffects,
    source: {
      type: 'motion-adjustment',
      motion: structuredClone(clip.motion!),
      intrinsicWidth: compositionSize.width,
      intrinsicHeight: compositionSize.height,
    },
  };
}

function compositionSizeProblem(size: MotionAdjustmentCompositionSize): string | null {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? null : 'Motion adjustment composition size must be finite and positive';
}

const reportedEffectIssues = new Set<string>();

/**
 * Logs each skipped layer property once per layer, each bypassed effect once per layer and effect,
 * and each replaced value once per layer, effect and parameter. Keys never contain the value: an
 * animated value must not log every frame.
 */
function reportOnce(key: string, report: () => void): void {
  if (reportedEffectIssues.has(key)) return;
  if (reportedEffectIssues.size > 512) reportedEffectIssues.clear();
  reportedEffectIssues.add(key);
  report();
}

function normalizeAdjustmentEffects(
  layerId: string,
  effects: readonly Effect[],
  surface: BuildMotionAdjustmentLayerFromBaseParams['surface'],
): Effect[] {
  const admission = admitAdjustmentEffectsForRender(layerId, effects);
  for (const item of admission.bypassed) {
    reportOnce(`bypass|${layerId}|${item.effectId}|${item.effectType}`, () => log.warn('Adjustment effect bypassed; the rest of the layer renders', {
      clipId: layerId, surface, effectId: item.effectId, effectType: item.effectType, reason: item.reason,
    }));
  }
  for (const item of admission.adjusted) {
    reportOnce(`adjust|${layerId}|${item.effectId}|${item.parameter}`, () => log.warn('Adjustment effect parameter adjusted for rendering', {
      clipId: layerId, surface, effectId: item.effectId, effectType: item.effectType, reason: item.message,
    }));
  }
  return admission.effects;
}
