import { directionFromAngles, periodicWindModulation, windForce } from '../operators/wind';
import { createEffectProperty } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';

export const SHARED_WIND_FIELDS = {
  globalWindStrength: { label: 'Strength', default: 5, min: 0, max: 30 },
  globalWindYaw: { label: 'Direction', default: 0, min: -180, max: 180 },
  globalWindPitch: { label: 'Elevation', default: 0, min: -90, max: 90 },
  globalWindGusts: { label: 'Shared gusts', default: 0.25, min: 0, max: 1 },
} as const;
export type SharedWindField = keyof typeof SHARED_WIND_FIELDS;
export function sharedWindValues(params: Record<string, unknown>, effectId: string, keys: Keyframe[], time: number) {
  return Object.fromEntries(Object.entries(SHARED_WIND_FIELDS).map(([key, spec]) => {
    const base = Number(params[key] ?? spec.default);
    const value = interpolateKeyframes(keys, createEffectProperty(effectId, key), time, base);
    return [key, Number.isFinite(value) ? value : spec.default];
  })) as Record<SharedWindField, number>;
}
/** Zero degrees blows toward the viewer; 180 blows into the face. */
export function sharedCableWind(params: Record<string, unknown>, effectId: string, keys: Keyframe[], time: number) {
  if (!params.sharedWind) return null;
  const v = sharedWindValues(params, effectId, keys, time);
  const force = windForce(directionFromAngles(v.globalWindYaw, Math.max(-90, Math.min(90, v.globalWindPitch))),
    Math.max(0, v.globalWindStrength), Math.max(0, Math.min(1, v.globalWindGusts)), periodicWindModulation(time));
  return { windX: force[0], windY: -force[1], windZ: force[2] };
}
