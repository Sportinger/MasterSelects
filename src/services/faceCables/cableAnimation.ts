import type { Keyframe } from '../../types/keyframes';
import { createEffectProperty } from '../../types/animationProperties';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import type { FaceCableConfig } from './cableData';

export const CABLE_ANIMATED_PARAMETERS = ['slack', 'windZ', 'windGusts', 'stiffness', 'gravity', 'damping', 'viscosity', 'width'] as const;
export type CableAnimatedParameter = typeof CABLE_ANIMATED_PARAMETERS[number];
export const cableProperty = (effectId: string, cableId: string, key: CableAnimatedParameter) =>
  createEffectProperty(effectId, `cable_${cableId}_${key}`);

export function sampleCableConfig(config: FaceCableConfig, effectId: string, keys: Keyframe[], time: number): FaceCableConfig {
  const result = { ...config };
  for (const key of CABLE_ANIMATED_PARAMETERS) {
    const value = interpolateKeyframes(keys, cableProperty(effectId, config.id, key), time, config[key] ?? 0);
    if (!Number.isFinite(value)) continue;
    result[key] = key === 'slack' ? Math.max(1.05, value) : key === 'width' ? Math.max(1, value)
      : key === 'damping' ? Math.max(0.2, value) : key === 'windZ' ? value
      : key === 'gravity' ? Math.max(0, value) : Math.max(0, Math.min(1, value));
  }
  return result;
}
