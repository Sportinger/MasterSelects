/**
 * AudioEffectRenderer - Apply EQ and volume effects with keyframe automation
 *
 * Uses OfflineAudioContext for sample-accurate offline rendering of:
 * - 10-band parametric EQ
 * - Volume/gain with keyframe automation
 *
 * Features:
 * - Keyframe interpolation for smooth automation
 * - Bezier curve support
 * - Offline rendering (not real-time)
 */

import { Logger } from '../../services/logger';
import type { AudioEffectInstance, Keyframe, Effect, EffectType } from '../../types';
import {
  getAudioEffect,
  getAudioEffectParamNames,
} from './AudioEffectRegistry';
import { isAudioEqAudibleStateDefault } from './eq/AudioEqIdentity';
import { createBufferLike } from './audioBufferFactory';
import {
  AUDIO_EQ_EFFECT_ID,
  AUDIO_VOLUME_EFFECT_ID,
  AUDIO_VOLUME_PARAM,
  LEGACY_AUDIO_EFFECT_RENDER_ORDER,
  bezierInterpolate,
  getNumericEffectParamDefault,
  hasEffectKeyframes,
  hasNonDefaultRegistryParams,
  hasRenderableAudioEffect,
  interpolateValue,
  type RenderableAudioEffectInstance,
} from './effectRender/audioEffectRenderContracts';
import { applySampleAccurateEQ } from './effectRender/eqSampleRenderer';
import { applyStaticEQ, renderOfflineNodeEffects } from './effectRender/offlineNodeRenderer';
import { isPureSampleEffect, renderPureSampleEffect } from './effectRender/pureSampleRenderer';

const log = Logger.create('AudioEffectRenderer');

// Standard 10-band EQ frequencies
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// EQ parameter names matching the effect params
export const EQ_BAND_PARAMS = getAudioEffectParamNames('audio-eq');

function hasNonDefaultVolume(volumeEffect: Effect): boolean {
  const defaultVolume = getNumericEffectParamDefault(
    AUDIO_VOLUME_EFFECT_ID,
    AUDIO_VOLUME_PARAM,
    1
  );
  const value = (volumeEffect.params?.[AUDIO_VOLUME_PARAM] as number) ?? defaultVolume;
  return value !== defaultVolume;
}

function hasNonDefaultEQ(eqEffect: Effect): boolean {
  return !isAudioEqAudibleStateDefault(eqEffect.params);
}

export interface EffectRenderProgress {
  phase: 'preparing' | 'rendering' | 'complete';
  percent: number;
}

export type EffectRenderProgressCallback = (progress: EffectRenderProgress) => void;

export class AudioEffectRenderer {
  /**
   * Render all audio effects for a clip
   * @param buffer - Source AudioBuffer (already speed-processed)
   * @param effects - Array of effects (audio-eq, audio-volume)
   * @param keyframes - All keyframes for this clip
   * @param clipDuration - Duration for automation (usually same as buffer duration)
   * @param onProgress - Optional progress callback
   * @returns Processed AudioBuffer
   */
  async renderEffects(
    buffer: AudioBuffer,
    effects: Effect[],
    keyframes: Keyframe[],
    clipDuration?: number,
    onProgress?: EffectRenderProgressCallback
  ): Promise<AudioBuffer> {
    const renderableEffects = this.getRenderableAudioEffects(effects)
      .filter(effect => this.shouldRenderAudioEffect(effect, keyframes));
    return this.renderEffectInstances(
      buffer,
      renderableEffects.flatMap(effect => {
        const descriptor = getAudioEffect(effect.type);
        if (!descriptor) return [];
        return [{
          id: effect.id,
          descriptorId: descriptor.id,
          enabled: effect.enabled !== false,
          params: { ...effect.params },
          automationMode: 'clip' as const,
        }];
      }),
      keyframes,
      clipDuration,
      onProgress
    );
  }

  /**
   * Render registry-backed audio effect instances from the new audio graph
   * contract through the legacy-compatible offline renderer path.
   */
  async renderEffectInstances(
    buffer: AudioBuffer,
    effectStack: readonly AudioEffectInstance[],
    keyframes: Keyframe[],
    clipDuration?: number,
    onProgress?: EffectRenderProgressCallback
  ): Promise<AudioBuffer> {
    const duration = clipDuration ?? buffer.duration;
    const renderableEffects = this.getRenderableAudioEffectInstances(effectStack);
    const effectsToApply = renderableEffects.filter(effect =>
      this.shouldRenderAudioEffectInstance(effect, keyframes)
    );

    if (effectsToApply.length === 0) {
      log.debug('No effects to apply, returning original');
      return buffer;
    }

    log.debug(`Rendering ${effectsToApply.length} audio effects for ${duration.toFixed(2)}s audio`);

    onProgress?.({ phase: 'preparing', percent: 0 });

    let workingBuffer = buffer;
    let pendingOfflineEffects: RenderableAudioEffectInstance[] = [];

    const flushOfflineEffects = async () => {
      if (pendingOfflineEffects.length === 0) return;
      workingBuffer = await renderOfflineNodeEffects(
        workingBuffer,
        pendingOfflineEffects,
        keyframes,
        duration,
      );
      pendingOfflineEffects = [];
    };

    for (const effect of effectsToApply) {
      if (effect.descriptorId === AUDIO_EQ_EFFECT_ID) {
        if (hasEffectKeyframes(keyframes, effect.id)) {
          pendingOfflineEffects.push(effect);
        } else {
          await flushOfflineEffects();
          workingBuffer = applySampleAccurateEQ(workingBuffer, effect);
        }
        continue;
      }

      if (isPureSampleEffect(effect.descriptorId)) {
        await flushOfflineEffects();
        workingBuffer = renderPureSampleEffect(workingBuffer, effect, keyframes);
      } else {
        pendingOfflineEffects.push(effect);
      }
    }

    await flushOfflineEffects();

    onProgress?.({ phase: 'complete', percent: 100 });
    log.debug(`Rendered ${workingBuffer.duration.toFixed(2)}s with effects`);
    return workingBuffer;
  }

  /**
   * Select legacy audio effects that have registry descriptors, preserving the
   * historical EQ -> volume render chain independently of UI stack order.
   */
  private getRenderableAudioEffects(effects: Effect[]): Effect[] {
    return LEGACY_AUDIO_EFFECT_RENDER_ORDER.flatMap(effectId => {
      const descriptor = getAudioEffect(effectId);
      if (!descriptor) return [];

      const effect = effects.find(candidate =>
        candidate.type === descriptor.id &&
        candidate.enabled !== false
      );
      return effect ? [effect] : [];
    });
  }

  private getRenderableAudioEffectInstances(
    effectStack: readonly AudioEffectInstance[]
  ): RenderableAudioEffectInstance[] {
    return effectStack.flatMap(effect => {
      if (!hasRenderableAudioEffect(effect)) return [];
      return [{
        ...effect,
        params: { ...effect.params },
      }];
    });
  }

  /**
   * Check if a selected legacy audio effect needs offline rendering.
   */
  private shouldRenderAudioEffect(effect: Effect, keyframes: Keyframe[]): boolean {
    if (effect.enabled === false) {
      return false;
    }

    const descriptor = getAudioEffect(effect.type);
    if (!descriptor) return false;

    if (hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return hasNonDefaultEQ(effect);
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return hasNonDefaultVolume(effect);
    }

    if (descriptor.defaultAudible === true) {
      return true;
    }

    return hasNonDefaultRegistryParams(descriptor.id, effect.params);
  }

  private shouldRenderAudioEffectInstance(
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[]
  ): boolean {
    if (effect.enabled === false || effect.disabled === true || effect.bypassed === true) {
      return false;
    }

    const descriptor = getAudioEffect(effect.descriptorId);
    if (!descriptor) return false;

    if (hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return hasNonDefaultRegistryParams(descriptor.id, effect.params);
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return hasNonDefaultEQ(effect as unknown as Effect);
    }

    if (descriptor.defaultAudible === true) {
      return true;
    }

    return hasNonDefaultRegistryParams(descriptor.id, effect.params);
  }

  audioEffectInstanceToLegacyEffect(
    effect: RenderableAudioEffectInstance
  ): Effect | null {
    const descriptor = getAudioEffect(effect.descriptorId);
    if (!descriptor) return null;

    return {
      id: effect.id,
      name: descriptor.name,
      type: descriptor.id as EffectType,
      enabled: effect.enabled !== false && effect.disabled !== true && effect.bypassed !== true,
      params: { ...effect.params },
    };
  }

  /**
   * Test seams: the audio effect renderer suites exercise these behaviors
   * through renderer instances. They are thin delegations to the extracted
   * effectRender helpers and the module-level default detectors.
   * (`protected` keeps them off the public API without tripping
   * noUnusedLocals on never-called private members.)
   */
  protected hasEffectKeyframes(keyframes: Keyframe[], effectId: string): boolean {
    return hasEffectKeyframes(keyframes, effectId);
  }

  protected hasNonDefaultEQ(eqEffect: Effect): boolean {
    return hasNonDefaultEQ(eqEffect);
  }

  protected hasNonDefaultVolume(volumeEffect: Effect): boolean {
    return hasNonDefaultVolume(volumeEffect);
  }

  protected interpolateValue(keyframes: Keyframe[], time: number, defaultValue: number): number {
    return interpolateValue(keyframes, time, defaultValue);
  }

  protected bezierInterpolate(prevKf: Keyframe, kf: Keyframe, t: number): number {
    return bezierInterpolate(prevKf, kf, t);
  }

  /**
   * Apply simple gain without automation (utility function)
   */
  async applyGain(buffer: AudioBuffer, gain: number): Promise<AudioBuffer> {
    if (Math.abs(gain - 1) < 0.001) {
      return buffer;
    }

    const newBuffer = createBufferLike(buffer);

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const inputData = buffer.getChannelData(ch);
      const outputData = newBuffer.getChannelData(ch);

      for (let i = 0; i < buffer.length; i++) {
        outputData[i] = inputData[i] * gain;
      }
    }

    return newBuffer;
  }

  /**
   * Apply simple EQ without automation (utility function)
   */
  async applyEQ(buffer: AudioBuffer, gains: number[]): Promise<AudioBuffer> {
    return applyStaticEQ(buffer, gains, EQ_FREQUENCIES);
  }
}

// Default instance
export const audioEffectRenderer = new AudioEffectRenderer();
