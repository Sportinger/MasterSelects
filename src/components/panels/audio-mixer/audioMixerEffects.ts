import { getAudioEffect } from '../../../engine/audio/AudioEffectRegistry';
import type { AudioEffectInstance } from '../../../types/audio';

export function getEffectName(effect: AudioEffectInstance): string {
  return getAudioEffect(effect.descriptorId)?.name ?? effect.descriptorId;
}

export function getEffectRackLabel(effect: AudioEffectInstance): string {
  const name = getEffectName(effect);
  return name.length > 17 ? `${name.slice(0, 16)}...` : name;
}
