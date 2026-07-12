import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import type { ClipMask } from '../../types/masks';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import {
  isValidTransitionSourceMap,
  resolveTransitionSourceMapTime,
} from '../timeline/transitionSourceMap';
import {
  evaluateCompositionClipEffects,
  evaluateCompositionClipMasks,
  evaluateCompositionClipTransform,
} from './keyframeEvaluation';

/** The serializable animation fields shared by runtime and persisted clips. */
export type TransitionMappedAnimationClip = Pick<
  TimelineClip | SerializableClip,
  'transform' | 'effects' | 'masks' | 'transitionSourceMap'
>;

export interface TransitionMappedAnimation {
  transform: ClipTransform;
  effects: Effect[];
  masks: ClipMask[] | undefined;
  /** Parent-local time for v2 maps, otherwise the composition-local time. */
  animationTime: number;
}

function cloneEffects(effects: Effect[]): Effect[] {
  return structuredClone(effects);
}

function evaluateSingleDomain(
  clip: TransitionMappedAnimationClip,
  keyframes: readonly Keyframe[] | undefined,
  compositionLocalTime: number,
): TransitionMappedAnimation {
  return {
    transform: structuredClone(evaluateCompositionClipTransform(
      clip.transform,
      keyframes,
      compositionLocalTime,
    )),
    effects: cloneEffects(evaluateCompositionClipEffects(clip.effects, keyframes, compositionLocalTime)),
    masks: evaluateCompositionClipMasks(clip.masks, keyframes, compositionLocalTime),
    animationTime: compositionLocalTime,
  };
}

function multiplyRelative(original: number, generated: number, base: number): number {
  // A zero base has no stable relative factor; retain the original animation instead.
  return base === 0 ? original : original * (generated / base);
}

function composeScaleAxis(
  original: number | undefined,
  generated: number | undefined,
  base: number | undefined,
): number | undefined {
  if (original === undefined && generated === undefined && base === undefined) return undefined;
  return multiplyRelative(original ?? 1, generated ?? 1, base ?? 1);
}

function composeTransforms(
  original: ClipTransform,
  generated: ClipTransform,
  parentBase: ClipTransform,
): ClipTransform {
  const scaleAll = composeScaleAxis(
    original.scale.all,
    generated.scale.all,
    parentBase.scale.all,
  );
  const scaleZ = composeScaleAxis(
    original.scale.z,
    generated.scale.z,
    parentBase.scale.z,
  );

  return {
    opacity: multiplyRelative(original.opacity, generated.opacity, parentBase.opacity),
    blendMode: generated.blendMode,
    position: {
      x: original.position.x + generated.position.x - parentBase.position.x,
      y: original.position.y + generated.position.y - parentBase.position.y,
      z: original.position.z + generated.position.z - parentBase.position.z,
    },
    scale: {
      ...(scaleAll === undefined ? {} : { all: scaleAll }),
      x: multiplyRelative(original.scale.x, generated.scale.x, parentBase.scale.x),
      y: multiplyRelative(original.scale.y, generated.scale.y, parentBase.scale.y),
      ...(scaleZ === undefined ? {} : { z: scaleZ }),
    },
    rotation: {
      x: original.rotation.x + generated.rotation.x - parentBase.rotation.x,
      y: original.rotation.y + generated.rotation.y - parentBase.rotation.y,
      z: original.rotation.z + generated.rotation.z - parentBase.rotation.z,
    },
  };
}

function evaluateEffectsByDomain(
  effects: Effect[],
  sourceEffectCount: number,
  parentKeyframes: readonly Keyframe[],
  animationTime: number,
  generatedKeyframes: readonly Keyframe[] | undefined,
  compositionLocalTime: number,
): Effect[] {
  return effects.map((effect, index) => cloneEffects(evaluateCompositionClipEffects(
    [effect],
    index < sourceEffectCount ? parentKeyframes : generatedKeyframes,
    index < sourceEffectCount ? animationTime : compositionLocalTime,
  ))[0]!);
}

function evaluateMasksByDomain(
  masks: ClipMask[] | undefined,
  sourceMaskCount: number,
  parentKeyframes: readonly Keyframe[],
  animationTime: number,
  generatedKeyframes: readonly Keyframe[] | undefined,
  compositionLocalTime: number,
): ClipMask[] | undefined {
  return masks?.map((mask, index) => evaluateCompositionClipMasks(
    [mask],
    index < sourceMaskCount ? parentKeyframes : generatedKeyframes,
    index < sourceMaskCount ? animationTime : compositionLocalTime,
  )![0]!);
}

function hasMatchingSourcePrefix<T extends { id: string }>(
  items: readonly T[] | undefined,
  sourceIds: readonly string[],
): boolean {
  return sourceIds.length === 0 ||
    (items !== undefined &&
      items.length >= sourceIds.length &&
      sourceIds.every((id, index) => items[index]?.id === id));
}

/**
 * Evaluates generated composition animation in composition time and a v2
 * transition source snapshot in its independent parent-local animation time.
 * Returns null for malformed v2 maps, a mismatched source prefix, or an
 * unresolved v2 animation time.
 */
export function evaluateTransitionMappedAnimation(
  clip: TransitionMappedAnimationClip,
  keyframes: readonly Keyframe[] | undefined,
  compositionLocalTime: number,
): TransitionMappedAnimation | null {
  const sourceMap = clip.transitionSourceMap;
  if (sourceMap?.version !== 2) {
    return evaluateSingleDomain(clip, keyframes, compositionLocalTime);
  }
  if (!isValidTransitionSourceMap(sourceMap)) return null;

  const mappedTime = resolveTransitionSourceMapTime(sourceMap, compositionLocalTime);
  const animationTime = mappedTime?.animationTime;
  if (typeof animationTime !== 'number' || !Number.isFinite(animationTime)) return null;

  const parentAnimation = sourceMap.parent.animation;
  if (!hasMatchingSourcePrefix(clip.effects, parentAnimation.sourceEffectIds) ||
    !hasMatchingSourcePrefix(clip.masks, parentAnimation.sourceMaskIds)) {
    return null;
  }
  const originalTransform = evaluateCompositionClipTransform(
    parentAnimation.baseTransform,
    parentAnimation.keyframes,
    animationTime,
  );
  const generatedTransform = evaluateCompositionClipTransform(
    clip.transform,
    keyframes,
    compositionLocalTime,
  );

  return {
    transform: composeTransforms(originalTransform, generatedTransform, parentAnimation.baseTransform),
    effects: evaluateEffectsByDomain(
      clip.effects,
      parentAnimation.sourceEffectIds.length,
      parentAnimation.keyframes,
      animationTime,
      keyframes,
      compositionLocalTime,
    ),
    masks: evaluateMasksByDomain(
      clip.masks,
      parentAnimation.sourceMaskIds.length,
      parentAnimation.keyframes,
      animationTime,
      keyframes,
      compositionLocalTime,
    ),
    animationTime,
  };
}
