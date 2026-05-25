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
import type { AudioEffectInstance, Keyframe, Effect, AnimatableProperty } from '../../types';
import { normalizeEasingType } from '../../utils/easing';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  type AudioEffectId,
  type AudioEffectParamValue,
} from './AudioEffectRegistry';

const log = Logger.create('AudioEffectRenderer');

// Standard 10-band EQ frequencies
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// EQ parameter names matching the effect params
export const EQ_BAND_PARAMS = getAudioEffectParamNames('audio-eq');

const AUDIO_EQ_EFFECT_ID = 'audio-eq' satisfies AudioEffectId;
const AUDIO_VOLUME_EFFECT_ID = 'audio-volume' satisfies AudioEffectId;
const AUDIO_VOLUME_PARAM = getAudioEffectParamNames(AUDIO_VOLUME_EFFECT_ID)[0] ?? 'volume';
const LEGACY_AUDIO_EFFECT_RENDER_ORDER = [
  AUDIO_EQ_EFFECT_ID,
  AUDIO_VOLUME_EFFECT_ID,
] as const satisfies readonly AudioEffectId[];

type RenderableAudioEffectInstance = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

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
    const duration = clipDuration ?? buffer.duration;

    const renderableEffects = this.getRenderableAudioEffects(effects);
    const hasEffectsToApply = renderableEffects.some(effect =>
      this.shouldRenderAudioEffect(effect, keyframes)
    );

    // If no effects or all defaults, return original buffer
    if (!hasEffectsToApply) {
      log.debug('No effects to apply, returning original');
      return buffer;
    }

    log.debug(`Rendering effects for ${duration.toFixed(2)}s audio`);

    onProgress?.({ phase: 'preparing', percent: 0 });

    // Create offline context
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    // Create source
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    // Build effect chain
    let currentNode: AudioNode = source;

    for (const effect of renderableEffects) {
      const descriptor = getAudioEffect(effect.type);
      if (!descriptor) continue;

      if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
        currentNode = this.createEQChain(
          offlineContext,
          currentNode,
          effect,
          keyframes,
          duration
        );
      }

      if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
        currentNode = this.createGainNode(
          offlineContext,
          currentNode,
          effect,
          keyframes,
          duration
        );
      }
    }

    // Connect to destination
    currentNode.connect(offlineContext.destination);

    onProgress?.({ phase: 'rendering', percent: 50 });

    // Start source and render
    source.start(0);
    const renderedBuffer = await offlineContext.startRendering();

    onProgress?.({ phase: 'complete', percent: 100 });

    log.debug(`Rendered ${renderedBuffer.duration.toFixed(2)}s with effects`);

    return renderedBuffer;
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
    return this.renderEffects(
      buffer,
      effectStack.flatMap(effect => {
        const legacyEffect = this.audioEffectInstanceToLegacyEffect(effect);
        return legacyEffect ? [legacyEffect] : [];
      }),
      keyframes,
      clipDuration,
      onProgress
    );
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

  /**
   * Check if a selected legacy audio effect needs offline rendering.
   */
  private shouldRenderAudioEffect(effect: Effect, keyframes: Keyframe[]): boolean {
    if (effect.enabled === false) {
      return false;
    }

    const descriptor = getAudioEffect(effect.type);
    if (!descriptor) return false;

    if (this.hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return this.hasNonDefaultEQ(effect);
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return this.hasNonDefaultVolume(effect);
    }

    return false;
  }

  private audioEffectInstanceToLegacyEffect(
    effect: RenderableAudioEffectInstance
  ): Effect | null {
    const descriptor = getAudioEffect(effect.descriptorId);
    if (!descriptor) return null;

    return {
      id: effect.id,
      name: descriptor.name,
      type: descriptor.id,
      enabled: effect.enabled !== false && effect.disabled !== true && effect.bypassed !== true,
      params: { ...effect.params },
    };
  }

  /**
   * Create 10-band EQ filter chain
   */
  private createEQChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    eqEffect: Effect,
    keyframes: Keyframe[],
    duration: number
  ): AudioNode {
    const filters: BiquadFilterNode[] = [];

    // Create filter for each band
    EQ_FREQUENCIES.forEach((freq, index) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4; // Standard Q for 10-band EQ

      // Get default gain from effect params
      const paramName = EQ_BAND_PARAMS[index];
      const defaultGain = (eqEffect.params?.[paramName] as number) ??
        this.getNumericEffectParamDefault(AUDIO_EQ_EFFECT_ID, paramName, 0);

      // Get keyframes for this band
      const property = `effect.${eqEffect.id}.${paramName}` as AnimatableProperty;
      const bandKeyframes = keyframes.filter(k => k.property === property);

      if (bandKeyframes.length > 0) {
        // Automate the gain parameter
        this.automateParam(filter.gain, bandKeyframes, defaultGain, duration);
      } else {
        // Set constant value
        filter.gain.value = defaultGain;
      }

      filters.push(filter);
    });

    // Connect filters in series
    inputNode.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }

    // Return last filter as output
    return filters[filters.length - 1];
  }

  /**
   * Create gain node for volume control
   */
  private createGainNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    volumeEffect: Effect,
    keyframes: Keyframe[],
    duration: number
  ): AudioNode {
    const gainNode = context.createGain();

    // Get default volume
    const defaultVolume = (volumeEffect.params?.[AUDIO_VOLUME_PARAM] as number) ??
      this.getNumericEffectParamDefault(AUDIO_VOLUME_EFFECT_ID, AUDIO_VOLUME_PARAM, 1);

    // Get keyframes for volume
    const property = `effect.${volumeEffect.id}.${AUDIO_VOLUME_PARAM}` as AnimatableProperty;
    const volumeKeyframes = keyframes.filter(k => k.property === property);

    if (volumeKeyframes.length > 0) {
      // Automate the gain parameter
      this.automateParam(gainNode.gain, volumeKeyframes, defaultVolume, duration);
    } else {
      // Set constant value
      gainNode.gain.value = defaultVolume;
    }

    inputNode.connect(gainNode);
    return gainNode;
  }

  /**
   * Automate an AudioParam using keyframes
   */
  private automateParam(
    param: AudioParam,
    keyframes: Keyframe[],
    defaultValue: number,
    duration: number
  ): void {
    if (keyframes.length === 0) {
      param.setValueAtTime(defaultValue, 0);
      return;
    }

    // Sort keyframes by time
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);

    // Set initial value at time 0
    if (sorted[0].time > 0) {
      // Interpolate value at time 0
      const valueAt0 = this.interpolateValue(sorted, 0, defaultValue);
      param.setValueAtTime(valueAt0, 0);
    }

    // Process each keyframe
    for (let i = 0; i < sorted.length; i++) {
      const kf = sorted[i];
      const time = Math.max(0, kf.time);

      // Ensure gain values are positive (required for exponential ramp)
      const value = kf.property.includes('volume')
        ? Math.max(0.0001, kf.value)
        : kf.value;

      if (i === 0) {
        // First keyframe - set initial value
        param.setValueAtTime(value, time);
      } else {
        // Subsequent keyframes - ramp to value
        const prevKf = sorted[i - 1];

        switch (normalizeEasingType(kf.easing, 'linear')) {
          case 'linear':
            param.linearRampToValueAtTime(value, time);
            break;

          case 'ease-in':
          case 'ease-out':
          case 'ease-in-out':
            // Approximate with exponential for smooth curves
            // Only use exponential if value > 0
            if (value > 0 && param.value > 0) {
              param.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
            } else {
              param.linearRampToValueAtTime(value, time);
            }
            break;

          case 'bezier':
            // For bezier, sample the curve at multiple points
            this.automateBezier(param, prevKf, kf);
            break;

          default:
            // Step/hold
            param.setValueAtTime(value, time);
        }
      }
    }

    // Hold last value until end
    const lastKf = sorted[sorted.length - 1];
    if (lastKf.time < duration) {
      param.setValueAtTime(lastKf.value, lastKf.time);
    }
  }

  /**
   * Automate using bezier curve by sampling points
   */
  private automateBezier(
    param: AudioParam,
    prevKf: Keyframe,
    kf: Keyframe
  ): void {
    // Sample bezier curve at multiple points
    const numSamples = 10;
    const duration = kf.time - prevKf.time;

    for (let i = 1; i <= numSamples; i++) {
      const t = i / numSamples;
      const time = prevKf.time + t * duration;

      // Interpolate using the keyframe interpolation utility
      // This handles bezier handles properly
      const value = this.bezierInterpolate(prevKf, kf, t);

      param.linearRampToValueAtTime(value, time);
    }
  }

  /**
   * Bezier interpolation between two keyframes
   */
  private bezierInterpolate(prevKf: Keyframe, kf: Keyframe, t: number): number {
    // If no handles, use linear
    if (!prevKf.handleOut && !kf.handleIn) {
      return prevKf.value + (kf.value - prevKf.value) * t;
    }

    // Cubic bezier with handles
    const p0 = prevKf.value;
    const p3 = kf.value;

    // Handle positions (time, value) relative to keyframe
    const h1 = prevKf.handleOut || { x: 0.33, y: 0 };
    const h2 = kf.handleIn || { x: -0.33, y: 0 };

    // Convert to absolute values
    const valueDiff = p3 - p0;
    const p1 = p0 + h1.y * valueDiff;
    const p2 = p3 + h2.y * valueDiff;

    // Cubic bezier formula
    const mt = 1 - t;
    return mt * mt * mt * p0 +
           3 * mt * mt * t * p1 +
           3 * mt * t * t * p2 +
           t * t * t * p3;
  }

  /**
   * Interpolate value at a specific time using keyframes
   */
  private interpolateValue(keyframes: Keyframe[], time: number, defaultValue: number): number {
    if (keyframes.length === 0) return defaultValue;

    const sorted = [...keyframes].sort((a, b) => a.time - b.time);

    // Before first keyframe
    if (time <= sorted[0].time) {
      return sorted[0].value;
    }

    // After last keyframe
    if (time >= sorted[sorted.length - 1].time) {
      return sorted[sorted.length - 1].value;
    }

    // Find surrounding keyframes
    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i + 1].time) {
        const t = (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
        return sorted[i].value + (sorted[i + 1].value - sorted[i].value) * t;
      }
    }

    return defaultValue;
  }

  /**
   * Check if effect has keyframes
   */
  private hasEffectKeyframes(keyframes: Keyframe[], effectId: string): boolean {
    return keyframes.some(k => k.property.startsWith(`effect.${effectId}.`));
  }

  /**
   * Get a registry default param value for an audio effect.
   */
  private getEffectParamDefault(
    effectId: AudioEffectId,
    paramName: string
  ): AudioEffectParamValue | undefined {
    return getAudioEffectDefaultParams(effectId)[paramName];
  }

  /**
   * Get a numeric registry default param value.
   */
  private getNumericEffectParamDefault(
    effectId: AudioEffectId,
    paramName: string,
    fallback: number
  ): number {
    const defaultValue = this.getEffectParamDefault(effectId, paramName);
    return typeof defaultValue === 'number' ? defaultValue : fallback;
  }

  /**
   * Check if volume has a non-default value.
   */
  private hasNonDefaultVolume(volumeEffect: Effect): boolean {
    const defaultVolume = this.getNumericEffectParamDefault(
      AUDIO_VOLUME_EFFECT_ID,
      AUDIO_VOLUME_PARAM,
      1
    );
    const value = (volumeEffect.params?.[AUDIO_VOLUME_PARAM] as number) ?? defaultVolume;
    return value !== defaultVolume;
  }

  /**
   * Check if EQ has non-default values
   */
  private hasNonDefaultEQ(eqEffect: Effect): boolean {
    const defaults = getAudioEffectDefaultParams(AUDIO_EQ_EFFECT_ID);

    return EQ_BAND_PARAMS.some(param => {
      const value = eqEffect.params?.[param] as number;
      const defaultValue = defaults[param];
      return value !== undefined &&
        typeof defaultValue === 'number' &&
        Math.abs(value - defaultValue) > 0.01;
    });
  }

  /**
   * Apply simple gain without automation (utility function)
   */
  async applyGain(buffer: AudioBuffer, gain: number): Promise<AudioBuffer> {
    if (Math.abs(gain - 1) < 0.001) {
      return buffer;
    }

    const audioContext = new AudioContext();
    const newBuffer = audioContext.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const inputData = buffer.getChannelData(ch);
      const outputData = newBuffer.getChannelData(ch);

      for (let i = 0; i < buffer.length; i++) {
        outputData[i] = inputData[i] * gain;
      }
    }

    audioContext.close();
    return newBuffer;
  }

  /**
   * Apply simple EQ without automation (utility function)
   */
  async applyEQ(buffer: AudioBuffer, gains: number[]): Promise<AudioBuffer> {
    // Check if all gains are zero (no EQ)
    if (gains.every(g => Math.abs(g) < 0.01)) {
      return buffer;
    }

    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    // Create and connect filters
    const filters = EQ_FREQUENCIES.map((freq, i) => {
      const filter = offlineContext.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4;
      filter.gain.value = gains[i] ?? 0;
      return filter;
    });

    source.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(offlineContext.destination);

    source.start(0);
    return await offlineContext.startRendering();
  }
}

// Default instance
export const audioEffectRenderer = new AudioEffectRenderer();
