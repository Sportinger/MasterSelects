import type { AnimatableProperty, EasingType } from '../../types/animationProperties';
import { createEffectProperty } from '../../types/animationProperties';
import type { EffectType } from '../../types/effects';

export const PARTICLE_DISINTEGRATE_EFFECT_TYPE: EffectType = 'pixel-particle-disintegrate';
export const PARTICLE_DISINTEGRATE_OUTRO_DURATION_SECONDS = 1;

export interface ParticleDisintegrateOutroKeyframe {
  readonly property: AnimatableProperty;
  readonly value: number;
  readonly time: number;
  readonly easing: EasingType;
}

export interface AddParticleDisintegrateOutroPresetOptions {
  readonly clipId: string;
  readonly clipDuration: number;
  readonly durationSeconds?: number;
  readonly addClipEffect: (clipId: string, effectType: EffectType) => string | null | undefined;
  readonly addKeyframe: (
    clipId: string,
    property: AnimatableProperty,
    value: number,
    time?: number,
    easing?: EasingType,
  ) => void;
}

function normalizedDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildParticleDisintegrateOutroKeyframes(
  effectId: string,
  clipDuration: number,
  durationSeconds = PARTICLE_DISINTEGRATE_OUTRO_DURATION_SECONDS,
): ParticleDisintegrateOutroKeyframe[] {
  const endTime = normalizedDuration(clipDuration);
  const requestedDuration = normalizedDuration(durationSeconds);
  const fadeDuration = endTime > 0
    ? Math.min(endTime, Math.max(0.1, requestedDuration || PARTICLE_DISINTEGRATE_OUTRO_DURATION_SECONDS))
    : 0;
  const startTime = Math.max(0, endTime - fadeDuration);
  const property = createEffectProperty(effectId, 'progress') as AnimatableProperty;

  return [
    { property, value: 0, time: startTime, easing: 'linear' },
    { property, value: 1, time: endTime, easing: 'ease-in-out' },
  ];
}

export function addParticleDisintegrateOutroPreset(
  options: AddParticleDisintegrateOutroPresetOptions,
): string | null {
  const effectId = options.addClipEffect(options.clipId, PARTICLE_DISINTEGRATE_EFFECT_TYPE);
  if (!effectId) return null;

  for (const keyframe of buildParticleDisintegrateOutroKeyframes(
    effectId,
    options.clipDuration,
    options.durationSeconds,
  )) {
    options.addKeyframe(
      options.clipId,
      keyframe.property,
      keyframe.value,
      keyframe.time,
      keyframe.easing,
    );
  }

  return effectId;
}
