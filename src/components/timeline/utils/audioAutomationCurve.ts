import type { AudioEffectInstance, Effect, Keyframe } from '../../../types';

type AudioEffectInstanceWithRuntimeFlags = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

export interface ResolveAudioVolumeAutomationCurveInput {
  keyframes: readonly Keyframe[];
  legacyEffects?: readonly Effect[];
  audioEffectStack?: readonly AudioEffectInstance[];
  clipDuration: number;
}

export interface AudioAutomationCurveKeyframe {
  id: string;
  time: number;
  value: number;
  easing: string;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

function parseVolumeEffectId(property: string): string | null {
  const match = /^effect\.([^.]+)\.volume$/.exec(property);
  return match?.[1] ?? null;
}

function isEnabledAudioVolumeEffect(effect: Effect): boolean {
  return effect.enabled !== false && effect.type === 'audio-volume';
}

function isEnabledAudioVolumeInstance(effect: AudioEffectInstance): boolean {
  const runtimeEffect = effect as AudioEffectInstanceWithRuntimeFlags;
  return effect.enabled !== false
    && runtimeEffect.disabled !== true
    && runtimeEffect.bypassed !== true
    && effect.descriptorId === 'audio-volume';
}

function normalizeGainForCurve(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function resolveAudioVolumeAutomationCurveKeyframes({
  keyframes,
  legacyEffects = [],
  audioEffectStack = [],
  clipDuration,
}: ResolveAudioVolumeAutomationCurveInput): AudioAutomationCurveKeyframe[] {
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) return [];

  const volumeEffectIds = new Set<string>();
  legacyEffects
    .filter(isEnabledAudioVolumeEffect)
    .forEach(effect => volumeEffectIds.add(effect.id));
  audioEffectStack
    .filter(isEnabledAudioVolumeInstance)
    .forEach(effect => volumeEffectIds.add(effect.id));

  if (volumeEffectIds.size === 0) return [];

  return keyframes
    .map((keyframe): AudioAutomationCurveKeyframe | null => {
      const effectId = parseVolumeEffectId(keyframe.property);
      if (!effectId || !volumeEffectIds.has(effectId)) return null;
      if (!Number.isFinite(keyframe.time) || keyframe.time < 0 || keyframe.time > clipDuration) return null;

      return {
        id: keyframe.id,
        time: keyframe.time,
        value: normalizeGainForCurve(keyframe.value),
        easing: keyframe.easing,
        handleIn: keyframe.handleIn,
        handleOut: keyframe.handleOut,
      };
    })
    .filter((keyframe): keyframe is AudioAutomationCurveKeyframe => keyframe !== null)
    .toSorted((a, b) => a.time - b.time);
}
