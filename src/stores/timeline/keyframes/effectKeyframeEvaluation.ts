// Keyframed effect parameters at a clip-local time. The timeline (getInterpolatedEffects) and the
// composition evaluator (nested compositions, transition-mapped clips, shared scenes, export) both
// call this, so every render path sees the same values, including the distance a keyframed rate has
// travelled (EffectParam.integratedAs: Perspective Grid Speed, Color Wheel Spin).
import type { AnimatableProperty } from '../types';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import { getEffect } from '../../../effects';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { integrateKeyframedRate } from '../../../utils/speedIntegration';
import { getLegacyEffectKeyframeBaseValue, mergeLegacyEffectParamPatch, parseEffectKeyframeProperty } from './audioEffectKeyframeValues';

type RateTravel = readonly [rate: string, travel: string];
const rateTravelCache = new Map<string, readonly RateTravel[]>();

/** Rate parameters of an effect type and the runtime-only parameter their travelled distance goes to. */
export function effectRateTravelParams(effectType: string): readonly RateTravel[] {
  let entries = rateTravelCache.get(effectType);
  if (!entries) {
    entries = Object.entries(getEffect(effectType)?.params ?? {})
      .flatMap(([name, definition]) => definition.integratedAs ? [[name, definition.integratedAs] as const] : []);
    rateTravelCache.set(effectType, entries);
  }
  return entries;
}

const hasStoredTravel = (effect: Effect) => effectRateTravelParams(effect.type).some(([, travel]) => travel in effect.params);

/**
 * Distance a keyframed rate has travelled at `localTime`: v(0) × `rateClockStart` + ∫₀^localTime v.
 * Unkeyed, a packer moves by rate × the clock the renderer passes it (timeline or composition time);
 * the clip starts at `rateClockStart` on that clock, so a rate keyed at its constant value travels the
 * same distance, and adding the first key does not move the pattern.
 */
function rateTravel(keyframes: Keyframe[], property: AnimatableProperty, localTime: number, baseValue: number, rateClockStart: number): number {
  const startRate = interpolateKeyframes(keyframes, property, 0, baseValue);
  const travelled = localTime > 0 ? integrateKeyframedRate(keyframes, property, localTime, baseValue) : startRate * localTime;
  return startRate * (Number.isFinite(rateClockStart) ? rateClockStart : 0) + travelled;
}

/**
 * The effects with their keyframed parameters evaluated at `localTime` (seconds since the clip start).
 * Travel parameters stored on an instance (an AI tool or an old save) are dropped: they are runtime-only
 * and would freeze the pattern. Without effect keyframes the input array is returned unchanged.
 */
export function evaluateEffectKeyframes(effects: readonly Effect[], keyframes: readonly Keyframe[],
  localTime: number, rateClockStart = 0): Effect[] {
  const effectKeyframes = keyframes.filter(keyframe => keyframe.property.startsWith('effect.'));
  if (effectKeyframes.length === 0 && !effects.some(hasStoredTravel)) return effects as Effect[];
  const allKeyframes = [...keyframes];

  return effects.map(effect => {
    const rates = effectRateTravelParams(effect.type);
    let params = { ...effect.params };
    for (const [, travel] of rates) delete params[travel];
    const paramNames = new Set<string>();
    Object.keys(effect.params).forEach(paramName => {
      if (typeof effect.params[paramName] === 'number') paramNames.add(paramName);
    });
    effectKeyframes.forEach(keyframe => {
      const effectProperty = parseEffectKeyframeProperty(keyframe.property);
      if (effectProperty?.effectId === effect.id) paramNames.add(effectProperty.paramName);
    });

    paramNames.forEach(paramName => {
      const property = `effect.${effect.id}.${paramName}` as AnimatableProperty;
      if (!effectKeyframes.some(keyframe => keyframe.property === property)) return;
      const baseValue = getLegacyEffectKeyframeBaseValue(effect, paramName);
      if (baseValue === undefined) return;
      params = mergeLegacyEffectParamPatch({ ...effect, params },
        { [paramName]: interpolateKeyframes(allKeyframes, property, localTime, baseValue) });
      const travel = rates.find(([rate]) => rate === paramName)?.[1];
      if (travel) params[travel] = rateTravel(allKeyframes, property, localTime, baseValue, rateClockStart);
    });

    return { ...effect, params };
  });
}
