import type { ClipMask } from '../../types/masks';
import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import type { SerializableClip } from '../../types/timeline';
import { getTransitionOpacityReference } from './transitionSourceMap';

/**
 * Content a transition template generates inside its composition: keyframes
 * with `<clipId>:kf:` ids, `transition-effect:` effects and `transition-comp:`
 * masks. Everything else on a linked clip is the user's or the source clip's.
 */
export function isGeneratedTransitionKeyframeId(clipId: string, keyframeId: string): boolean {
  return keyframeId.startsWith(`${clipId}:kf:`);
}

export function isGeneratedTransitionEffect(effect: Effect): boolean {
  return effect.id.startsWith('transition-effect:');
}

export function isGeneratedTransitionMask(mask: ClipMask): boolean {
  return mask.id.startsWith('transition-comp:');
}

export function mergeGeneratedEffects(
  existing: SerializableClip['effects'],
  generated: SerializableClip['effects'],
): SerializableClip['effects'] {
  return [
    ...(existing ?? []).filter((effect) => !isGeneratedTransitionEffect(effect)),
    ...(generated ?? []).filter(isGeneratedTransitionEffect),
  ];
}

export function mergeGeneratedMasks(
  existing: SerializableClip['masks'],
  generated: SerializableClip['masks'],
): SerializableClip['masks'] {
  const masks = [
    ...(existing ?? []).filter((mask) => !isGeneratedTransitionMask(mask)),
    ...(generated ?? []).filter(isGeneratedTransitionMask),
  ];
  return masks.length > 0 ? masks : undefined;
}

const EPSILON = 1e-4;

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) <= EPSILON;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * True when a stored generated keyframe is exactly what a template made: the
 * regenerated keyframe, or what the materializer wrote before revision 1,
 * which did not scale recipe opacity by the clip's own opacity yet.
 */
function isUntouchedGeneratedKeyframe(existing: Keyframe, regenerated: Keyframe, clipOpacity: number): boolean {
  if (!sameNumber(existing.time, regenerated.time) ||
    (existing.easing ?? 'linear') !== (regenerated.easing ?? 'linear') ||
    (existing.hold === true) !== (regenerated.hold === true) ||
    !sameJson(existing.handleIn, regenerated.handleIn) ||
    !sameJson(existing.handleOut, regenerated.handleOut) ||
    !sameJson(existing.rotationInterpolation, regenerated.rotationInterpolation) ||
    !sameJson(existing.pathValue, regenerated.pathValue)) {
    return false;
  }
  if (sameNumber(existing.value, regenerated.value)) return true;
  return existing.property === 'opacity' &&
    sameNumber(existing.value * getTransitionOpacityReference(clipOpacity), regenerated.value);
}

function findRegeneratedKeyframe(existing: Keyframe, regenerated: readonly Keyframe[]): Keyframe | undefined {
  return regenerated.find((candidate) => candidate.id === existing.id) ??
    regenerated.find((candidate) => candidate.property === existing.property && sameNumber(candidate.time, existing.time));
}

function upgradeGeneratedItems<T extends { id: string }>(
  existing: readonly T[],
  generated: readonly T[],
  isGenerated: (item: T) => boolean,
  isUntouched: (item: T, regenerated: T) => boolean,
  findRegenerated: (item: T, regenerated: readonly T[]) => T | undefined,
  kept: string[],
): T[] {
  const regenerated = generated.filter(isGenerated);
  const editedByRegeneratedId = new Map<string, T>();
  for (const item of existing) {
    if (!isGenerated(item)) continue;
    const match = findRegenerated(item, regenerated);
    // A generated item the template no longer makes is dropped with the old recipe.
    if (match && !isUntouched(item, match)) editedByRegeneratedId.set(match.id, item);
  }
  kept.push(...[...editedByRegeneratedId.values()].map((item) => item.id));
  return [
    ...existing.filter((item) => !isGenerated(item)),
    ...regenerated.map((item) => editedByRegeneratedId.get(item.id) ?? item),
  ];
}

/**
 * Template upgrade of one linked clip: the recipe-owned content (generated
 * keyframes, effects, masks, blend windows and render settings) is rebuilt,
 * except generated items the user edited inside the composition, which are
 * kept and listed in `kept`. The user's own keyframes, effects, masks, grade
 * and transform stay as they are.
 */
export function upgradeGeneratedClipContent(
  refreshed: SerializableClip,
  existing: SerializableClip,
  generated: SerializableClip,
  kept: string[],
): SerializableClip {
  const clipOpacity = existing.transform?.opacity ?? 1;
  const keyframes = upgradeGeneratedItems(
    existing.keyframes ?? [],
    generated.keyframes ?? [],
    (keyframe) => isGeneratedTransitionKeyframeId(existing.id, keyframe.id),
    (keyframe, regenerated) => isUntouchedGeneratedKeyframe(keyframe, regenerated, clipOpacity),
    findRegeneratedKeyframe,
    kept,
  );
  const findById = <T extends { id: string }>(item: T, candidates: readonly T[]) =>
    candidates.find((candidate) => candidate.id === item.id);
  const effects = upgradeGeneratedItems(
    existing.effects ?? [],
    generated.effects ?? [],
    isGeneratedTransitionEffect,
    (effect, regenerated) => effect.enabled === regenerated.enabled && sameJson(effect.params, regenerated.params),
    findById,
    kept,
  );
  const masks = upgradeGeneratedItems(
    existing.masks ?? [],
    generated.masks ?? [],
    isGeneratedTransitionMask,
    (mask, regenerated) => sameJson(mask, regenerated),
    findById,
    kept,
  );
  return {
    ...refreshed,
    transitionRender: generated.transitionRender ? structuredClone(generated.transitionRender) : undefined,
    effects,
    masks: masks.length > 0 ? masks : undefined,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
  };
}

/**
 * True when a linked clip holds changes the template would not recreate:
 * keyframes, effects or masks that are neither generated nor copied from the
 * source clip (the regenerated linked clip carries the source clip's own).
 */
export function hasUserContentOnLinkedClip(existing: SerializableClip, regenerated: SerializableClip | undefined): boolean {
  const regeneratedIds = new Set([
    ...(regenerated?.keyframes ?? []).map((keyframe) => keyframe.id),
    ...(regenerated?.effects ?? []).map((effect) => effect.id),
    ...(regenerated?.masks ?? []).map((mask) => mask.id),
  ]);
  const animation = existing.transitionSourceMap?.version === 2 ? existing.transitionSourceMap.parent.animation : undefined;
  const sourceIds = new Set([...(animation?.sourceEffectIds ?? []), ...(animation?.sourceMaskIds ?? [])]);
  const isUserItem = (id: string) => !regeneratedIds.has(id) && !sourceIds.has(id);
  return (existing.keyframes ?? []).some((keyframe) =>
    !isGeneratedTransitionKeyframeId(existing.id, keyframe.id) && isUserItem(keyframe.id)) ||
    (existing.effects ?? []).some((effect) => !isGeneratedTransitionEffect(effect) && isUserItem(effect.id)) ||
    (existing.masks ?? []).some((mask) => !isGeneratedTransitionMask(mask) && isUserItem(mask.id));
}
