import {
  parseEffectProperty,
  type AnimatableProperty,
  type EffectProperty,
} from '../../../types/animationProperties';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../types';

function randomSuffix(): string {
  return Math.random().toString(36).substr(2, 5);
}

export function generateClipboardKeyframeId(): string {
  return `kf_${Date.now()}_${randomSuffix()}`;
}

export function cloneClipboardEffect(effect: Effect): Effect {
  return {
    ...effect,
    params: structuredClone(effect.params),
  };
}

export function cloneClipboardKeyframe(keyframe: Keyframe): Keyframe {
  return structuredClone(keyframe);
}

export function clampClipboardKeyframeTime(time: number, duration: number): number {
  return Math.max(0, Math.min(duration, time));
}

export function parseClipboardEffectKeyframeProperty(property: AnimatableProperty) {
  return property.startsWith('effect.')
    ? parseEffectProperty(property as EffectProperty)
    : null;
}

export function getClipboardTargetClipIds(explicitTargets: string[] | undefined, selectedClipIds: Set<string>): string[] {
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [...selectedClipIds];
  return [...new Set(ids)];
}
