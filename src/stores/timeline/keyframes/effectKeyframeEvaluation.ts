// Keyframed effect parameters at a clip-local time. The timeline (getInterpolatedEffects) and the
// composition evaluator (nested compositions, transition-mapped clips, shared scenes, export) both
// call this, so every render path sees the same values, including the distance a keyframed rate has
// travelled (EffectParam.integratedAs: Perspective Grid Speed, Color Wheel Spin).
import type { AnimatableProperty } from '../types';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import { effectRateTravelParams, withoutRuntimeTravelParams } from '../../../effects';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { integrateKeyframedRateBetween } from '../../../utils/speedIntegration';
import { Logger } from '../../../services/logger';
import { getLegacyEffectKeyframeBaseValue, mergeLegacyEffectParamPatch, parseEffectKeyframeProperty } from './audioEffectKeyframeValues';

const log = Logger.create('EffectKeyframes');

/**
 * Keyed parameter names per effect id, once per keyframe array. Timeline edits replace keyframe
 * arrays (as keyframesForProperty relies on), so a frame only looks up the effects it renders
 * instead of filtering every transform and effect key of the clip again.
 */
const keyedParamsByArray = new WeakMap<readonly Keyframe[], ReadonlyMap<string, readonly string[]>>();
function keyedEffectParams(keyframes: readonly Keyframe[]): ReadonlyMap<string, readonly string[]> {
  let byEffect = keyedParamsByArray.get(keyframes);
  if (!byEffect) {
    const names = new Map<string, Set<string>>();
    for (const keyframe of keyframes) {
      if (!keyframe.property.startsWith('effect.')) continue;
      const parsed = parseEffectKeyframeProperty(keyframe.property);
      if (!parsed) continue;
      let set = names.get(parsed.effectId);
      if (!set) { set = new Set(); names.set(parsed.effectId, set); }
      set.add(parsed.paramName);
    }
    byEffect = new Map([...names].map(([effectId, set]) => [effectId, [...set]]));
    keyedParamsByArray.set(keyframes, byEffect);
  }
  return byEffect;
}

/**
 * Loading strips stored travel (migratePersistedEffectOperatorGraph, persisted history). An instance
 * that still carries one renders without it: the copy is kept per instance, so repeated evaluation
 * returns the same object, and the path that stored it is reported once per effect.
 */
const withoutTravelCopies = new WeakMap<Effect, Effect>();
const reportedStoredTravel = new Set<string>();
function withoutStoredTravel(effect: Effect): Effect {
  const params = withoutRuntimeTravelParams(effect.type, effect.params);
  if (params === effect.params) return effect;
  let copy = withoutTravelCopies.get(effect);
  if (!copy) {
    copy = { ...effect, params };
    withoutTravelCopies.set(effect, copy);
    if (!reportedStoredTravel.has(effect.id)) {
      if (reportedStoredTravel.size > 256) reportedStoredTravel.clear();
      reportedStoredTravel.add(effect.id);
      log.warn(`${effect.name} stores a runtime-only travel parameter; it is ignored (computed from the keyframed rate while rendering).`);
    }
  }
  return copy;
}

/**
 * Distance a keyframed rate has travelled at `localTime`: ∫ v from −`rateClockStart` to `localTime`,
 * with v holding the first key's value before it. Unkeyed, a packer moves by rate × the clock the
 * renderer passes it (timeline or composition time); the clip starts at `rateClockStart` on that
 * clock, so a rate keyed at its constant value travels the same distance, and adding the first key
 * does not move the pattern. Keys at negative local times (a head trim keeps keys anchored on the
 * timeline) are integrated where they are, so a trim does not shift the phase of a keyed ramp.
 */
function rateTravel(keyframes: Keyframe[], property: AnimatableProperty, localTime: number, baseValue: number, rateClockStart: number): number {
  const clockStart = Number.isFinite(rateClockStart) ? rateClockStart : 0;
  return integrateKeyframedRateBetween(keyframes, property, -clockStart, localTime, baseValue);
}

function evaluateKeyedEffect(effect: Effect, keyedNames: readonly string[], keyframes: Keyframe[],
  localTime: number, rateClockStart: number): Effect {
  const rates = effectRateTravelParams(effect.type);
  let params = effect.params;
  // Stored numeric parameters first, then keyed ones the instance does not store (legacy order).
  const keyed = new Set(keyedNames);
  const ordered = [
    ...Object.keys(effect.params).filter(name => typeof effect.params[name] === 'number' && keyed.has(name)),
    ...keyedNames.filter(name => typeof effect.params[name] !== 'number'),
  ];
  for (const paramName of ordered) {
    const property = `effect.${effect.id}.${paramName}` as AnimatableProperty;
    const baseValue = getLegacyEffectKeyframeBaseValue(effect, paramName);
    if (baseValue === undefined) continue;
    params = mergeLegacyEffectParamPatch({ ...effect, params },
      { [paramName]: interpolateKeyframes(keyframes, property, localTime, baseValue) });
    const travel = rates.find(([rate]) => rate === paramName)?.[1];
    if (travel) params[travel] = rateTravel(keyframes, property, localTime, baseValue, rateClockStart);
  }
  return params === effect.params ? effect : { ...effect, params };
}

/**
 * The effects with their keyframed parameters evaluated at `localTime` (seconds since the clip start).
 * Effects without keys come back as the same objects, and without any effect keys the input array is
 * returned unchanged, so per-frame evaluation keeps identities stable. Pass the store's keyframe
 * array itself: the property index and the rate integrals are cached per array.
 */
export function evaluateEffectKeyframes(effects: readonly Effect[], keyframes: readonly Keyframe[],
  localTime: number, rateClockStart = 0): Effect[] {
  const keyedParams = keyedEffectParams(keyframes);
  // interpolateKeyframes and the rate integrals read the array and never mutate it.
  const store = keyframes as Keyframe[];
  let changed = false;
  const result = effects.map(effect => {
    const base = withoutStoredTravel(effect);
    const keyedNames = keyedParams.get(effect.id);
    const evaluated = keyedNames ? evaluateKeyedEffect(base, keyedNames, store, localTime, rateClockStart) : base;
    if (evaluated !== effect) changed = true;
    return evaluated;
  });
  return changed ? result : effects as Effect[];
}
