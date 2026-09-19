import { createEffectProperty } from '../../types/animationProperties';
import type { Keyframe } from '../../types/keyframes';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { cableWindAtTime } from './cableDepth';

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
  const force = cableWindAtTime(Math.max(0, v.globalWindStrength), Math.max(0, Math.min(1, v.globalWindGusts)), time);
  const yaw = v.globalWindYaw * Math.PI / 180, pitch = Math.max(-90, Math.min(90, v.globalWindPitch)) * Math.PI / 180;
  return { windX: force * Math.sin(yaw) * Math.cos(pitch), windY: -force * Math.sin(pitch), windZ: force * Math.cos(yaw) * Math.cos(pitch) };
}
