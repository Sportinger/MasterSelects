import type { BlendMode, Effect, Layer, TimelineClip } from '../../types';
import type { JsonObject } from '../motionDesign/adjustment/contracts';
import { adaptTimelineEffectsToMotionAdjustmentContracts } from '../motionDesign/adjustment/supportedEffectContractAdapter';
import { isSupportedAdjustmentEffectType } from '../motionDesign/adjustment/supportedEffects';
import { Logger } from '../logger';
import { getClipTimeInfo } from './FrameContext';
import type { TransformCache } from './TransformCache';
import type { FrameContext } from './types';

const log = Logger.create('MotionAdjustmentLayerBuilder');
const IDENTITY_EPSILON = 0.000001;
const SUPPORTED_ADJUSTMENT_BLEND_MODES = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
]);

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
 * Shared fail-closed admission boundary for main, nested, and export builders.
 * Only effect data admitted by the frozen Adjustment 1.0 adapter reaches the
 * compositor. Adjustment transforms stay identity-only in v1.
 */
export function buildMotionAdjustmentLayerFromBase(
  params: BuildMotionAdjustmentLayerFromBaseParams,
): Layer | null {
  const { clip, baseLayer, compositionSize, surface } = params;

  try {
    assertRenderableAdjustmentClip(clip, baseLayer, compositionSize);
    const normalizedEffects = normalizeAdjustmentEffects(clip.id, baseLayer.effects);
    return {
      ...baseLayer,
      effects: normalizedEffects,
      source: {
        type: 'motion-adjustment',
        motion: structuredClone(clip.motion!),
        intrinsicWidth: compositionSize.width,
        intrinsicHeight: compositionSize.height,
      },
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    log.warn('Motion adjustment layer rejected by render admission', {
      clipId: clip.id,
      surface,
      reason: failure.message,
    });
    // Interactive preview can omit one invalid layer and keep the editor
    // responsive. Export must abort instead of silently producing wrong media.
    if (surface === 'export') throw failure;
    return null;
  }
}

function normalizeAdjustmentEffects(layerId: string, effects: readonly Effect[]): Effect[] {
  const admitted = adaptTimelineEffectsToMotionAdjustmentContracts({
    layerId,
    effects: effects.map((effect) => ({
      id: effect.id,
      name: effect.name,
      type: effect.type,
      enabled: effect.enabled,
      params: effect.params as JsonObject,
    })),
  });

  return admitted.map((effect, index) => {
    if (!isSupportedAdjustmentEffectType(effect.effectType)) {
      throw new Error(`Unsupported admitted motion adjustment effect: ${effect.effectType}`);
    }
    return {
      id: effect.id,
      name: effects[index]?.name ?? effect.effectType,
      type: effect.effectType,
      enabled: effect.enabled,
      params: { ...effect.parameters },
    };
  });
}

function assertRenderableAdjustmentClip(
  clip: TimelineClip,
  baseLayer: Omit<Layer, 'source'>,
  compositionSize: MotionAdjustmentCompositionSize,
): void {
  if (
    clip.source?.type !== 'motion-adjustment'
    || clip.motion?.version !== 1
    || clip.motion.kind !== 'adjustment'
    || clip.motion.shape !== undefined
    || clip.motion.appearance !== undefined
    || clip.motion.replicator !== undefined
    || clip.motion.modifierStack !== undefined
    || clip.motion.replicatorRecovery !== undefined
  ) {
    throw new Error('Invalid motion adjustment layer definition');
  }
  if (
    !Number.isFinite(compositionSize.width)
    || !Number.isFinite(compositionSize.height)
    || compositionSize.width <= 0
    || compositionSize.height <= 0
  ) {
    throw new Error('Motion adjustment composition size must be finite and positive');
  }
  if (!hasIdentityAdjustmentTransform(baseLayer)) {
    throw new Error('Motion adjustment transforms must remain identity in v1');
  }
  if (
    !Number.isFinite(baseLayer.opacity)
    || baseLayer.opacity < 0
    || baseLayer.opacity > 1
    || !SUPPORTED_ADJUSTMENT_BLEND_MODES.has(baseLayer.blendMode)
  ) {
    throw new Error('Motion adjustment mix is outside the supported v1 contract');
  }
  if (
    clip.is3D === true
    || baseLayer.is3D === true
    || baseLayer.sourceRect !== undefined
    || clip.transitionRender !== undefined
    || baseLayer.transitionRender !== undefined
    || clip.colorCorrection !== undefined
    || baseLayer.colorCorrection !== undefined
    || clip.nodeGraph !== undefined
  ) {
    throw new Error('Motion adjustment layer uses unsupported render properties');
  }
}

function hasIdentityAdjustmentTransform(layer: Omit<Layer, 'source'>): boolean {
  const rotation = typeof layer.rotation === 'number'
    ? { x: 0, y: 0, z: layer.rotation }
    : layer.rotation;
  return isIdentityNumber(layer.position.x, 0)
    && isIdentityNumber(layer.position.y, 0)
    && isIdentityNumber(layer.position.z, 0)
    && isIdentityNumber(layer.scale.x, 1)
    && isIdentityNumber(layer.scale.y, 1)
    && isIdentityNumber(layer.scale.z, 1)
    && isIdentityNumber(rotation.x, 0)
    && isIdentityNumber(rotation.y, 0)
    && isIdentityNumber(rotation.z, 0);
}

function isIdentityNumber(value: number | undefined, identity: number): boolean {
  const resolved = value ?? identity;
  return Number.isFinite(resolved)
    && Math.abs(resolved - identity) <= IDENTITY_EPSILON;
}
