// Timeline store utility functions

import type { EffectType } from '../../types';
import type { AudioEffectParamValue } from '../../types/audio';
import { getDefaultParams as getRegistryDefaultParams, hasEffect } from '../../effects';
import {
  getAudioEffectDefaultParams,
  hasAudioEffect,
} from '../../engine/audio/AudioEffectRegistry';
// Helper to seek video and wait for it to be ready
export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Seek timeout')), 3000);

    const onSeeked = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };

    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

// Helper function to get default effect parameters
// Now uses the modular effect registry, with fallback for audio effects
export function getDefaultEffectParams(type: string | EffectType): Record<string, AudioEffectParamValue> {
  // Check if effect exists in the new registry
  if (hasEffect(type)) {
    return getRegistryDefaultParams(type);
  }

  if (hasAudioEffect(type)) {
    return getAudioEffectDefaultParams(type);
  }

  return {};
}

// Quantize time to 30fps for caching
export function quantizeTime(time: number): number {
  return Math.round(time * 30) / 30;
}
