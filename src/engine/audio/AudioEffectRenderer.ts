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
import { analyzeAudioBufferLoudnessSummary } from '../../services/audio/LoudnessEnvelopeGenerator';
import type { AudioEffectInstance, Keyframe, Effect, EffectType, AnimatableProperty } from '../../types';
import { normalizeEasingType } from '../../utils/easing';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  type AudioEffectId,
  type AudioEffectParamValue,
} from './AudioEffectRegistry';
import { normalizeAudioEqParams } from './eq/AudioEqLegacy';
import { isAudioEqAudibleStateDefault } from './eq/AudioEqIdentity';
import {
  processAudioEqChannels,
} from './eq/AudioEqDynamic';
import { processAudioEqCharacterChannels } from './eq/AudioEqCharacter';
import {
  hasAudioEqSpectralDynamicsBands,
  processAudioEqSpectralDynamicsChannels,
} from './eq/AudioEqSpectralDynamics';
import {
  hasAudioEqLinearPhaseMode,
  processAudioEqLinearPhaseChannels,
} from './eq/AudioEqLinearPhase';
import type { AudioEqBand, AudioEqBandType } from './eq/AudioEqTypes';
import { createSpectralGateState, processSpectralGateBlock } from './spectralGateProcessor';

const log = Logger.create('AudioEffectRenderer');

// Standard 10-band EQ frequencies
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// EQ parameter names matching the effect params
export const EQ_BAND_PARAMS = getAudioEffectParamNames('audio-eq');

const AUDIO_EQ_EFFECT_ID = 'audio-eq' satisfies AudioEffectId;
const AUDIO_VOLUME_EFFECT_ID = 'audio-volume' satisfies AudioEffectId;
const AUDIO_PAN_EFFECT_ID = 'audio-pan' satisfies AudioEffectId;
const AUDIO_NORMALIZE_EFFECT_ID = 'audio-normalize' satisfies AudioEffectId;
const AUDIO_PARAMETRIC_EQ_EFFECT_ID = 'audio-parametric-eq' satisfies AudioEffectId;
const AUDIO_HIGH_PASS_EFFECT_ID = 'audio-high-pass' satisfies AudioEffectId;
const AUDIO_LOW_PASS_EFFECT_ID = 'audio-low-pass' satisfies AudioEffectId;
const AUDIO_HUM_NOTCH_EFFECT_ID = 'audio-hum-notch' satisfies AudioEffectId;
const AUDIO_DE_CLICK_EFFECT_ID = 'audio-de-click' satisfies AudioEffectId;
const AUDIO_NOISE_REDUCTION_EFFECT_ID = 'audio-noise-reduction' satisfies AudioEffectId;
const AUDIO_SPECTRAL_GATE_EFFECT_ID = 'audio-spectral-gate' satisfies AudioEffectId;
const AUDIO_COMPRESSOR_EFFECT_ID = 'audio-compressor' satisfies AudioEffectId;
const AUDIO_DE_ESSER_EFFECT_ID = 'audio-de-esser' satisfies AudioEffectId;
const AUDIO_LIMITER_EFFECT_ID = 'audio-limiter' satisfies AudioEffectId;
const AUDIO_NOISE_GATE_EFFECT_ID = 'audio-noise-gate' satisfies AudioEffectId;
const AUDIO_EXPANDER_EFFECT_ID = 'audio-expander' satisfies AudioEffectId;
const AUDIO_DELAY_EFFECT_ID = 'audio-delay' satisfies AudioEffectId;
const AUDIO_REVERB_EFFECT_ID = 'audio-reverb' satisfies AudioEffectId;
const AUDIO_SATURATION_EFFECT_ID = 'audio-saturation' satisfies AudioEffectId;
const AUDIO_POLARITY_INVERT_EFFECT_ID = 'audio-polarity-invert' satisfies AudioEffectId;
const AUDIO_MONO_SUM_EFFECT_ID = 'audio-mono-sum' satisfies AudioEffectId;
const AUDIO_CHANNEL_SWAP_EFFECT_ID = 'audio-channel-swap' satisfies AudioEffectId;
const AUDIO_STEREO_SPLIT_EFFECT_ID = 'audio-stereo-split' satisfies AudioEffectId;
const AUDIO_VOLUME_PARAM = getAudioEffectParamNames(AUDIO_VOLUME_EFFECT_ID)[0] ?? 'volume';
const LEGACY_AUDIO_EFFECT_RENDER_ORDER = [
  AUDIO_HIGH_PASS_EFFECT_ID,
  AUDIO_LOW_PASS_EFFECT_ID,
  AUDIO_HUM_NOTCH_EFFECT_ID,
  AUDIO_DE_CLICK_EFFECT_ID,
  AUDIO_NOISE_REDUCTION_EFFECT_ID,
  AUDIO_SPECTRAL_GATE_EFFECT_ID,
  AUDIO_EQ_EFFECT_ID,
  AUDIO_PARAMETRIC_EQ_EFFECT_ID,
  AUDIO_DE_ESSER_EFFECT_ID,
  AUDIO_COMPRESSOR_EFFECT_ID,
  AUDIO_NOISE_GATE_EFFECT_ID,
  AUDIO_EXPANDER_EFFECT_ID,
  AUDIO_DELAY_EFFECT_ID,
  AUDIO_REVERB_EFFECT_ID,
  AUDIO_SATURATION_EFFECT_ID,
  AUDIO_POLARITY_INVERT_EFFECT_ID,
  AUDIO_MONO_SUM_EFFECT_ID,
  AUDIO_CHANNEL_SWAP_EFFECT_ID,
  AUDIO_STEREO_SPLIT_EFFECT_ID,
  AUDIO_NORMALIZE_EFFECT_ID,
  AUDIO_LIMITER_EFFECT_ID,
  AUDIO_PAN_EFFECT_ID,
  AUDIO_VOLUME_EFFECT_ID,
] as const satisfies readonly AudioEffectId[];

const DEFAULT_PARAM_EPSILON = 0.001;
function getBiquadTypeForAudioEqBand(band: AudioEqBand): BiquadFilterType {
  const bandType: AudioEqBandType = band.type;
  switch (bandType) {
    case 'bell':
      return 'peaking';
    case 'low-shelf':
      return 'lowshelf';
    case 'high-shelf':
      return 'highshelf';
    case 'low-cut':
      return 'highpass';
    case 'high-cut':
      return 'lowpass';
    case 'notch':
      return 'notch';
    case 'band-pass':
      return 'bandpass';
    case 'all-pass':
      return 'allpass';
    case 'tilt-shelf':
      return band.gainDb >= 0 ? 'highshelf' : 'lowshelf';
    default:
      return 'peaking';
  }
}

type RenderableAudioEffectInstance = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

function hasRenderableAudioEffect(effect: AudioEffectInstance & { bypassed?: boolean; disabled?: boolean }): boolean {
  return effect.enabled !== false &&
    effect.disabled !== true &&
    effect.bypassed !== true &&
    getAudioEffect(effect.descriptorId) !== undefined;
}

function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

function linearToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return -Infinity;
  return 20 * Math.log10(value);
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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
      workingBuffer = await this.renderOfflineNodeEffects(
        workingBuffer,
        pendingOfflineEffects,
        keyframes,
        duration,
      );
      pendingOfflineEffects = [];
    };

    for (const effect of effectsToApply) {
      if (effect.descriptorId === AUDIO_EQ_EFFECT_ID) {
        if (this.hasEffectKeyframes(keyframes, effect.id)) {
          pendingOfflineEffects.push(effect);
        } else {
          await flushOfflineEffects();
          workingBuffer = this.applySampleAccurateEQ(workingBuffer, effect);
        }
        continue;
      }

      if (this.isPureSampleEffect(effect.descriptorId)) {
        await flushOfflineEffects();
        workingBuffer = this.renderPureSampleEffect(workingBuffer, effect, keyframes);
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

    if (this.hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return this.hasNonDefaultEQ(effect);
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return this.hasNonDefaultVolume(effect);
    }

    if (descriptor.defaultAudible === true) {
      return true;
    }

    return this.hasNonDefaultRegistryParams(descriptor.id, effect.params);
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

    if (this.hasEffectKeyframes(keyframes, effect.id)) {
      return true;
    }

    if (descriptor.id === AUDIO_VOLUME_EFFECT_ID) {
      return this.hasNonDefaultRegistryParams(descriptor.id, effect.params);
    }

    if (descriptor.id === AUDIO_EQ_EFFECT_ID) {
      return this.hasNonDefaultEQ(effect as unknown as Effect);
    }

    if (descriptor.defaultAudible === true) {
      return true;
    }

    return this.hasNonDefaultRegistryParams(descriptor.id, effect.params);
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

  private async renderOfflineNodeEffects(
    buffer: AudioBuffer,
    effects: readonly RenderableAudioEffectInstance[],
    keyframes: Keyframe[],
    duration: number,
  ): Promise<AudioBuffer> {
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    let currentNode: AudioNode = source;

    for (const effect of effects) {
      switch (effect.descriptorId) {
        case AUDIO_EQ_EFFECT_ID:
          currentNode = this.createEQChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_PARAMETRIC_EQ_EFFECT_ID:
          currentNode = this.createParametricEQNode(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_VOLUME_EFFECT_ID:
          currentNode = this.createGainNode(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_PAN_EFFECT_ID:
          currentNode = this.createPanNode(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_HIGH_PASS_EFFECT_ID:
          currentNode = this.createFilterNode(offlineContext, currentNode, effect, 'highpass', keyframes, duration);
          break;
        case AUDIO_LOW_PASS_EFFECT_ID:
          currentNode = this.createFilterNode(offlineContext, currentNode, effect, 'lowpass', keyframes, duration);
          break;
        case AUDIO_HUM_NOTCH_EFFECT_ID:
          currentNode = this.createHumNotchChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_COMPRESSOR_EFFECT_ID:
          currentNode = this.createCompressorChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
        case AUDIO_DE_ESSER_EFFECT_ID:
          currentNode = this.createDeEsserChain(offlineContext, currentNode, effect, keyframes, duration);
          break;
      }
    }

    currentNode.connect(offlineContext.destination);
    source.start(0);
    return offlineContext.startRendering();
  }

  private isPureSampleEffect(effectId: string): boolean {
    return effectId === AUDIO_LIMITER_EFFECT_ID ||
      effectId === AUDIO_NOISE_GATE_EFFECT_ID ||
      effectId === AUDIO_EXPANDER_EFFECT_ID ||
      effectId === AUDIO_DELAY_EFFECT_ID ||
      effectId === AUDIO_REVERB_EFFECT_ID ||
      effectId === AUDIO_SATURATION_EFFECT_ID ||
      effectId === AUDIO_DE_CLICK_EFFECT_ID ||
      effectId === AUDIO_NOISE_REDUCTION_EFFECT_ID ||
      effectId === AUDIO_SPECTRAL_GATE_EFFECT_ID ||
      effectId === AUDIO_POLARITY_INVERT_EFFECT_ID ||
      effectId === AUDIO_MONO_SUM_EFFECT_ID ||
      effectId === AUDIO_CHANNEL_SWAP_EFFECT_ID ||
      effectId === AUDIO_NORMALIZE_EFFECT_ID ||
      effectId === AUDIO_STEREO_SPLIT_EFFECT_ID;
  }

  private renderPureSampleEffect(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    switch (effect.descriptorId) {
      case AUDIO_LIMITER_EFFECT_ID:
        return this.applyPeakLimiter(buffer, effect, keyframes);
      case AUDIO_NOISE_GATE_EFFECT_ID:
        return this.applyNoiseGate(buffer, effect, keyframes);
      case AUDIO_EXPANDER_EFFECT_ID:
        return this.applyExpander(buffer, effect, keyframes);
      case AUDIO_DELAY_EFFECT_ID:
        return this.applyDelay(buffer, effect, keyframes);
      case AUDIO_REVERB_EFFECT_ID:
        return this.applyReverb(buffer, effect, keyframes);
      case AUDIO_SATURATION_EFFECT_ID:
        return this.applySaturation(buffer, effect, keyframes);
      case AUDIO_DE_CLICK_EFFECT_ID:
        return this.applyDeClick(buffer, effect, keyframes);
      case AUDIO_NOISE_REDUCTION_EFFECT_ID:
        return this.applyNoiseReduction(buffer, effect, keyframes);
      case AUDIO_SPECTRAL_GATE_EFFECT_ID:
        return this.applySpectralGate(buffer, effect, keyframes);
      case AUDIO_POLARITY_INVERT_EFFECT_ID:
        return this.applyPolarityInvert(buffer, effect);
      case AUDIO_MONO_SUM_EFFECT_ID:
        return this.applyMonoSum(buffer);
      case AUDIO_CHANNEL_SWAP_EFFECT_ID:
        return this.applyChannelSwap(buffer);
      case AUDIO_STEREO_SPLIT_EFFECT_ID:
        return this.applyStereoSplit(buffer, effect);
      case AUDIO_NORMALIZE_EFFECT_ID:
        return this.applyNormalize(buffer, effect);
      default:
        return buffer;
    }
  }

  private createParametricEQNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    eqEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    const frequency = this.getNumericEffectParam(eqEffect, 'frequencyHz', 1000);
    const gain = this.getNumericEffectParam(eqEffect, 'gainDb', 0);
    const q = this.getNumericEffectParam(eqEffect, 'q', 1);

    this.automateEffectParam(filter.frequency, eqEffect, 'frequencyHz', frequency, keyframes, duration);
    this.automateEffectParam(filter.gain, eqEffect, 'gainDb', gain, keyframes, duration);
    this.automateEffectParam(filter.Q, eqEffect, 'q', q, keyframes, duration);

    inputNode.connect(filter);
    return filter;
  }

  private createFilterNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    filterEffect: RenderableAudioEffectInstance,
    type: BiquadFilterType,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const filter = context.createBiquadFilter();
    filter.type = type;
    const effectId = filterEffect.descriptorId as AudioEffectId;
    const defaultFrequency = this.getNumericEffectParamDefault(effectId, 'frequencyHz', type === 'highpass' ? 20 : 22000);
    const defaultQ = this.getNumericEffectParamDefault(effectId, 'q', 0.707);
    const frequency = this.getNumericEffectParam(filterEffect, 'frequencyHz', defaultFrequency);
    const q = this.getNumericEffectParam(filterEffect, 'q', defaultQ);

    this.automateEffectParam(filter.frequency, filterEffect, 'frequencyHz', frequency, keyframes, duration);
    this.automateEffectParam(filter.Q, filterEffect, 'q', q, keyframes, duration);

    inputNode.connect(filter);
    return filter;
  }

  private createHumNotchChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    humEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const nyquist = Math.max(20, context.sampleRate / 2 - 1);
    const baseFrequency = clamp(this.getNumericEffectParam(humEffect, 'frequencyHz', 50), 20, nyquist);
    const q = clamp(this.getNumericEffectParam(humEffect, 'q', 30), 1, 80);
    const harmonicCount = Math.max(1, Math.min(8, Math.round(this.getNumericEffectParam(humEffect, 'harmonics', 2))));
    const mix = clamp(this.getNumericEffectParam(humEffect, 'mix', 1), 0, 1);
    const activeHarmonics = Array.from({ length: harmonicCount }, (_, index) => index + 1)
      .filter(harmonic => baseFrequency * harmonic < nyquist);

    if (activeHarmonics.length === 0) {
      return inputNode;
    }

    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const output = context.createGain();
    const filters = activeHarmonics.map(harmonic => {
      const filter = context.createBiquadFilter();
      filter.type = 'notch';
      this.automateEffectParam(
        filter.frequency,
        humEffect,
        'frequencyHz',
        clamp(baseFrequency * harmonic, 20, nyquist),
        keyframes,
        duration,
        value => clamp(value * harmonic, 20, nyquist),
      );
      this.automateEffectParam(
        filter.Q,
        humEffect,
        'q',
        q,
        keyframes,
        duration,
        value => clamp(value, 1, 80),
      );
      return filter;
    });

    this.automateEffectParam(
      dryGain.gain,
      humEffect,
      'mix',
      1 - mix,
      keyframes,
      duration,
      value => 1 - clamp(value, 0, 1),
    );
    this.automateEffectParam(
      wetGain.gain,
      humEffect,
      'mix',
      mix,
      keyframes,
      duration,
      value => clamp(value, 0, 1),
    );

    inputNode.connect(dryGain);
    dryGain.connect(output);
    inputNode.connect(filters[0]);
    for (let index = 0; index < filters.length - 1; index += 1) {
      filters[index].connect(filters[index + 1]);
    }
    filters[filters.length - 1].connect(wetGain);
    wetGain.connect(output);

    return output;
  }

  private createCompressorChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    compressorEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const compressor = context.createDynamicsCompressor();
    const threshold = this.getNumericEffectParam(compressorEffect, 'thresholdDb', 0);
    const ratio = this.getNumericEffectParam(compressorEffect, 'ratio', 1);
    const knee = this.getNumericEffectParam(compressorEffect, 'kneeDb', 0);
    const attackSeconds = this.getNumericEffectParam(compressorEffect, 'attackMs', 10) / 1000;
    const releaseSeconds = this.getNumericEffectParam(compressorEffect, 'releaseMs', 120) / 1000;

    this.automateEffectParam(compressor.threshold, compressorEffect, 'thresholdDb', threshold, keyframes, duration);
    this.automateEffectParam(compressor.ratio, compressorEffect, 'ratio', ratio, keyframes, duration);
    this.automateEffectParam(compressor.knee, compressorEffect, 'kneeDb', knee, keyframes, duration);
    this.automateEffectParam(compressor.attack, compressorEffect, 'attackMs', attackSeconds, keyframes, duration, value => value / 1000);
    this.automateEffectParam(compressor.release, compressorEffect, 'releaseMs', releaseSeconds, keyframes, duration, value => value / 1000);

    inputNode.connect(compressor);

    const makeupGainDb = this.getNumericEffectParam(compressorEffect, 'makeupGainDb', 0);
    if (Math.abs(makeupGainDb) <= 0.001 && !this.hasEffectParamKeyframes(keyframes, compressorEffect.id, 'makeupGainDb')) {
      return compressor;
    }

    const makeupGain = context.createGain();
    this.automateEffectParam(
      makeupGain.gain,
      compressorEffect,
      'makeupGainDb',
      dbToLinearGain(makeupGainDb),
      keyframes,
      duration,
      dbToLinearGain,
    );
    compressor.connect(makeupGain);
    return makeupGain;
  }

  private createDeEsserChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    deEsserEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number,
  ): AudioNode {
    const splitFrequency = this.getNumericEffectParam(deEsserEffect, 'frequencyHz', 6500);
    const threshold = this.getNumericEffectParam(deEsserEffect, 'thresholdDb', 0);
    const ratio = this.getNumericEffectParam(deEsserEffect, 'ratio', 1);
    const knee = this.getNumericEffectParam(deEsserEffect, 'kneeDb', 6);
    const attackSeconds = this.getNumericEffectParam(deEsserEffect, 'attackMs', 1) / 1000;
    const releaseSeconds = this.getNumericEffectParam(deEsserEffect, 'releaseMs', 80) / 1000;
    const makeupGainDb = this.getNumericEffectParam(deEsserEffect, 'makeupGainDb', 0);
    const lowBand = context.createBiquadFilter();
    const highBand = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const makeupGain = context.createGain();
    const output = context.createGain();

    lowBand.type = 'lowpass';
    lowBand.Q.value = 0.707;
    highBand.type = 'highpass';
    highBand.Q.value = 0.707;

    this.automateEffectParam(lowBand.frequency, deEsserEffect, 'frequencyHz', splitFrequency, keyframes, duration);
    this.automateEffectParam(highBand.frequency, deEsserEffect, 'frequencyHz', splitFrequency, keyframes, duration);
    this.automateEffectParam(compressor.threshold, deEsserEffect, 'thresholdDb', threshold, keyframes, duration);
    this.automateEffectParam(compressor.ratio, deEsserEffect, 'ratio', ratio, keyframes, duration);
    this.automateEffectParam(compressor.knee, deEsserEffect, 'kneeDb', knee, keyframes, duration);
    this.automateEffectParam(compressor.attack, deEsserEffect, 'attackMs', attackSeconds, keyframes, duration, value => value / 1000);
    this.automateEffectParam(compressor.release, deEsserEffect, 'releaseMs', releaseSeconds, keyframes, duration, value => value / 1000);
    this.automateEffectParam(
      makeupGain.gain,
      deEsserEffect,
      'makeupGainDb',
      dbToLinearGain(makeupGainDb),
      keyframes,
      duration,
      dbToLinearGain,
    );

    inputNode.connect(lowBand);
    inputNode.connect(highBand);
    lowBand.connect(output);
    highBand.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(output);

    return output;
  }

  /**
   * Create 10-band EQ filter chain
   */
  private createEQChain(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    eqEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number
  ): AudioNode {
    const eq = normalizeAudioEqParams(eqEffect.params);
    const activeBands = eq.audible.bands.filter(band => band.enabled !== false);
    if (activeBands.length === 0) {
      return inputNode;
    }

    const filters = activeBands.map((band) => {
      const filter = context.createBiquadFilter();
      filter.type = getBiquadTypeForAudioEqBand(band);
      this.automateParamByProperties(
        filter.frequency,
        [`effect.${eqEffect.id}.eq.audible.bands.${band.id}.frequencyHz`],
        band.frequencyHz,
        keyframes,
        duration,
        value => Math.max(20, Math.min(22000, value)),
      );
      this.automateParamByProperties(
        filter.Q,
        [`effect.${eqEffect.id}.eq.audible.bands.${band.id}.q`],
        band.q,
        keyframes,
        duration,
        value => Math.max(0.025, Math.min(100, value)),
      );
      this.automateParamByProperties(
        filter.gain,
        [
          `effect.${eqEffect.id}.eq.audible.bands.${band.id}.gainDb`,
          `effect.${eqEffect.id}.${band.id}`,
        ],
        band.gainDb,
        keyframes,
        duration,
      );

      return filter;
    });

    // Connect filters in series
    inputNode.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }

    // Return last filter as output
    return filters[filters.length - 1];
  }

  private applySampleAccurateEQ(
    buffer: AudioBuffer,
    eqEffect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const inputChannels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
    const eqResult = hasAudioEqLinearPhaseMode(eqEffect.params)
      ? processAudioEqLinearPhaseChannels(inputChannels, eqEffect.params, {
          sampleRate: buffer.sampleRate,
        })
      : processAudioEqChannels(
          hasAudioEqSpectralDynamicsBands(eqEffect.params)
            ? processAudioEqSpectralDynamicsChannels(inputChannels, eqEffect.params, {
                sampleRate: buffer.sampleRate,
              }).channels
            : inputChannels,
          eqEffect.params,
          { sampleRate: buffer.sampleRate },
        );
    const characterResult = processAudioEqCharacterChannels(eqResult.channels, eqEffect.params, {
      sampleRate: buffer.sampleRate,
    });
    const output = this.createMutableAudioBufferLike(buffer);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      output.getChannelData(channel).set(characterResult.channels[channel] ?? inputChannels[channel]);
    }
    return output;
  }

  /**
   * Create gain node for volume control
   */
  private createGainNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    volumeEffect: RenderableAudioEffectInstance,
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

  private createPanNode(
    context: OfflineAudioContext,
    inputNode: AudioNode,
    panEffect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
    duration: number
  ): AudioNode {
    const panNode = context.createStereoPanner();
    const pan = clampPan(this.getNumericEffectParam(panEffect, 'pan', 0));
    this.automateEffectParam(panNode.pan, panEffect, 'pan', pan, keyframes, duration, clampPan);
    inputNode.connect(panNode);
    return panNode;
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
    return this.interpolateSortedValue([...keyframes].sort((a, b) => a.time - b.time), time, defaultValue);
  }

  private interpolateSortedValue(sorted: readonly Keyframe[], time: number, defaultValue: number): number {
    if (sorted.length === 0) return defaultValue;
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

  private getNumericEffectParam(
    effect: RenderableAudioEffectInstance,
    paramName: string,
    fallback: number
  ): number {
    const value = effect.params?.[paramName];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  private getBooleanEffectParam(
    effect: RenderableAudioEffectInstance,
    paramName: string,
    fallback: boolean,
  ): boolean {
    const value = effect.params?.[paramName];
    return typeof value === 'boolean' ? value : fallback;
  }

  private getStringEffectParam(
    effect: RenderableAudioEffectInstance,
    paramName: string,
    fallback: string,
  ): string {
    const value = effect.params?.[paramName];
    return typeof value === 'string' ? value : fallback;
  }

  private createNumericSampleParamReader(
    effect: RenderableAudioEffectInstance,
    paramName: string,
    fallback: number,
    keyframes: Keyframe[],
    transformValue: (value: number) => number = value => value,
  ): (time: number) => number {
    const defaultValue = transformValue(this.getNumericEffectParam(effect, paramName, fallback));
    const property = `effect.${effect.id}.${paramName}` as AnimatableProperty;
    const paramKeyframes = keyframes
      .filter(k => k.property === property && Number.isFinite(k.value))
      .map(k => ({ ...k, value: transformValue(k.value) }))
      .toSorted((a, b) => a.time - b.time);

    if (paramKeyframes.length === 0) {
      return () => defaultValue;
    }

    return (time: number) => this.interpolateSortedValue(paramKeyframes, time, defaultValue);
  }

  private hasEffectParamKeyframes(
    keyframes: Keyframe[],
    effectId: string,
    paramName: string,
  ): boolean {
    return keyframes.some(k => k.property === `effect.${effectId}.${paramName}`);
  }

  private automateEffectParam(
    param: AudioParam,
    effect: RenderableAudioEffectInstance,
    paramName: string,
    defaultValue: number,
    keyframes: Keyframe[],
    duration: number,
    transformValue: (value: number) => number = value => value,
  ): void {
    const property = `effect.${effect.id}.${paramName}` as AnimatableProperty;
    const paramKeyframes = keyframes
      .filter(k => k.property === property)
      .map(k => ({ ...k, value: transformValue(k.value) }));

    if (paramKeyframes.length > 0) {
      this.automateParam(param, paramKeyframes, defaultValue, duration);
    } else {
      param.value = defaultValue;
    }
  }

  private automateParamByProperties(
    param: AudioParam,
    properties: readonly string[],
    defaultValue: number,
    keyframes: Keyframe[],
    duration: number,
    transformValue: (value: number) => number = value => value,
  ): void {
    const propertySet = new Set(properties);
    const paramKeyframes = keyframes
      .filter(k => propertySet.has(k.property))
      .map(k => ({ ...k, value: transformValue(k.value) }));

    if (paramKeyframes.length > 0) {
      this.automateParam(param, paramKeyframes, defaultValue, duration);
    } else {
      param.value = defaultValue;
    }
  }

  private hasNonDefaultRegistryParams(
    effectId: AudioEffectId,
    params: Record<string, AudioEffectParamValue> | undefined,
    epsilon = DEFAULT_PARAM_EPSILON,
  ): boolean {
    const descriptor = getAudioEffect(effectId);
    if (!descriptor) return false;

    const defaults = getAudioEffectDefaultParams(effectId);
    return descriptor.paramNames.some(paramName => {
      const defaultValue = defaults[paramName];
      const value = params?.[paramName];
      if (value === undefined) return false;
      if (typeof defaultValue === 'number') {
        return typeof value !== 'number' || Math.abs(value - defaultValue) > epsilon;
      }
      return value !== defaultValue;
    });
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
    return !isAudioEqAudibleStateDefault(eqEffect.params);
  }

  private createMutableAudioBufferLike(buffer: AudioBuffer): AudioBuffer {
    const maybeWindow = globalThis as typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('AudioContext is required for audio effect sample processing.');
    }

    const audioContext = new AudioContextCtor();
    const nextBuffer = audioContext.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );
    audioContext.close();
    return nextBuffer;
  }

  private applyPeakLimiter(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const readCeiling = this.createNumericSampleParamReader(
      effect,
      'ceilingDb',
      0,
      keyframes,
      value => Math.max(0.000001, dbToLinearGain(value)),
    );
    const readInputGain = this.createNumericSampleParamReader(effect, 'inputGainDb', 0, keyframes, dbToLinearGain);
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const ceiling = readCeiling(time);
        const inputGain = readInputGain(time);
        const value = (input[index] ?? 0) * inputGain;
        target[index] = clamp(value, -ceiling, ceiling);
      }
    }

    return output;
  }

  private applyNormalize(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const mode = this.getStringEffectParam(effect, 'mode', 'peak').toLowerCase();
    const allowBoost = this.getBooleanEffectParam(effect, 'allowBoost', true);
    const maxGainDb = clamp(this.getNumericEffectParam(effect, 'maxGainDb', 24), 0, 60);
    const ceilingDb = clamp(this.getNumericEffectParam(effect, 'truePeakCeilingDb', -1), -60, 0);

    let currentDb = -Infinity;
    let targetDb = -Infinity;

    if (mode === 'lufs') {
      const summary = analyzeAudioBufferLoudnessSummary(buffer);
      currentDb = typeof summary.integratedLufs === 'number' ? summary.integratedLufs : -Infinity;
      targetDb = clamp(this.getNumericEffectParam(effect, 'targetLufs', -23), -70, 0);
    } else if (mode === 'rms') {
      currentDb = linearToDb(this.getBufferRms(buffer));
      targetDb = clamp(this.getNumericEffectParam(effect, 'targetRmsDb', -18), -90, 0);
    } else {
      currentDb = linearToDb(this.getBufferPeak(buffer));
      targetDb = clamp(this.getNumericEffectParam(effect, 'targetPeakDb', -1), -60, 0);
    }

    if (!Number.isFinite(currentDb) || currentDb <= -120 || !Number.isFinite(targetDb)) {
      return buffer;
    }

    const upperGainDb = allowBoost ? maxGainDb : 0;
    const gainDb = clamp(targetDb - currentDb, -maxGainDb, upperGainDb);
    if (Math.abs(gainDb) <= 0.05) {
      return buffer;
    }

    const output = this.createMutableAudioBufferLike(buffer);
    const gain = dbToLinearGain(gainDb);
    let outputPeak = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      for (let index = 0; index < buffer.length; index += 1) {
        const sample = (input[index] ?? 0) * gain;
        target[index] = sample;
        outputPeak = Math.max(outputPeak, Math.abs(sample));
      }
    }

    const ceiling = dbToLinearGain(ceilingDb);
    if (outputPeak > ceiling) {
      this.scaleBuffer(output, ceiling / outputPeak);
    }

    return output;
  }

  private getBufferPeak(buffer: AudioBuffer): number {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        peak = Math.max(peak, Math.abs(data[index] ?? 0));
      }
    }
    return peak;
  }

  private getBufferRms(buffer: AudioBuffer): number {
    let sumSquares = 0;
    let totalSamples = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        const sample = data[index] ?? 0;
        sumSquares += sample * sample;
        totalSamples += 1;
      }
    }
    return totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) : 0;
  }

  private scaleBuffer(buffer: AudioBuffer, gain: number): void {
    if (!Number.isFinite(gain) || Math.abs(gain - 1) <= 0.000001) return;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) {
        data[index] *= gain;
      }
    }
  }

  private applyNoiseGate(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const readThreshold = this.createNumericSampleParamReader(effect, 'thresholdDb', -120, keyframes, dbToLinearGain);
    const readFloorGain = this.createNumericSampleParamReader(effect, 'floorDb', -80, keyframes, dbToLinearGain);
    const readAttackMs = this.createNumericSampleParamReader(
      effect,
      'attackMs',
      2,
      keyframes,
      value => Math.max(0.001, value),
    );
    const readReleaseMs = this.createNumericSampleParamReader(
      effect,
      'releaseMs',
      80,
      keyframes,
      value => Math.max(0.001, value),
    );
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      let gain = 1;

      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const sample = input[index] ?? 0;
        const threshold = readThreshold(time);
        const floorGain = readFloorGain(time);
        const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * readAttackMs(time) / 1000));
        const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * readReleaseMs(time) / 1000));
        const targetGain = Math.abs(sample) >= threshold ? 1 : floorGain;
        const coefficient = targetGain > gain ? attackCoefficient : releaseCoefficient;
        gain = targetGain + coefficient * (gain - targetGain);
        target[index] = sample * gain;
      }
    }

    return output;
  }

  private applyExpander(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const readThresholdDb = this.createNumericSampleParamReader(
      effect,
      'thresholdDb',
      0,
      keyframes,
      value => clamp(value, -100, 0),
    );
    const readRatio = this.createNumericSampleParamReader(
      effect,
      'ratio',
      1,
      keyframes,
      value => clamp(value, 1, 20),
    );
    const readRangeDb = this.createNumericSampleParamReader(
      effect,
      'rangeDb',
      0,
      keyframes,
      value => clamp(value, 0, 80),
    );
    const readAttackMs = this.createNumericSampleParamReader(
      effect,
      'attackMs',
      2,
      keyframes,
      value => Math.max(0.001, value),
    );
    const readReleaseMs = this.createNumericSampleParamReader(
      effect,
      'releaseMs',
      120,
      keyframes,
      value => Math.max(0.001, value),
    );
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      let gain = 1;

      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const sample = input[index] ?? 0;
        const thresholdDb = readThresholdDb(time);
        const ratio = readRatio(time);
        const rangeDb = readRangeDb(time);
        const inputDb = 20 * Math.log10(Math.max(0.000001, Math.abs(sample)));
        const reductionDb = ratio <= 1.0001 || rangeDb <= 0.0001 || inputDb >= thresholdDb
          ? 0
          : Math.min(rangeDb, (thresholdDb - inputDb) * (ratio - 1));
        const targetGain = dbToLinearGain(-reductionDb);
        const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * readAttackMs(time) / 1000));
        const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * readReleaseMs(time) / 1000));
        const coefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
        gain = targetGain + coefficient * (gain - targetGain);
        target[index] = sample * gain;
      }
    }

    return output;
  }

  private applyDelay(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const staticMix = clamp(this.getNumericEffectParam(effect, 'mix', 0), 0, 1);
    if (staticMix <= 0.0001 && !this.hasEffectParamKeyframes(keyframes, effect.id, 'mix')) {
      return buffer;
    }

    const readDelayMs = this.createNumericSampleParamReader(
      effect,
      'delayMs',
      250,
      keyframes,
      value => clamp(value, 1, 2000),
    );
    const readFeedback = this.createNumericSampleParamReader(
      effect,
      'feedback',
      0,
      keyframes,
      value => clamp(value, 0, 0.95),
    );
    const readMix = this.createNumericSampleParamReader(
      effect,
      'mix',
      0,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const readToneHz = this.createNumericSampleParamReader(
      effect,
      'toneHz',
      12000,
      keyframes,
      value => clamp(value, 20, buffer.sampleRate / 2 - 1),
    );
    const maxDelaySamples = Math.max(1, Math.round(buffer.sampleRate * 2));
    const ringLength = maxDelaySamples + 1;
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      const feedbackBuffer = new Float32Array(ringLength);
      let writeIndex = 0;
      let toneState = 0;

      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const dry = input[index] ?? 0;
        const delaySamples = Math.max(1, Math.min(maxDelaySamples, Math.round(buffer.sampleRate * readDelayMs(time) / 1000)));
        const readIndex = (writeIndex - delaySamples + ringLength) % ringLength;
        const delayed = feedbackBuffer[readIndex] ?? 0;
        const toneAlpha = 1 - Math.exp(-2 * Math.PI * readToneHz(time) / buffer.sampleRate);
        toneState += toneAlpha * (delayed - toneState);
        const wet = toneState;
        const feedback = readFeedback(time);
        const mix = readMix(time);
        feedbackBuffer[writeIndex] = clamp(dry + wet * feedback, -4, 4);
        target[index] = dry * (1 - mix) + wet * mix;
        writeIndex = (writeIndex + 1) % ringLength;
      }
    }

    return output;
  }

  private applyReverb(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const staticMix = clamp(this.getNumericEffectParam(effect, 'mix', 0), 0, 1);
    if (staticMix <= 0.0001 && !this.hasEffectParamKeyframes(keyframes, effect.id, 'mix')) {
      return buffer;
    }

    const readMix = this.createNumericSampleParamReader(
      effect,
      'mix',
      0,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const readDecaySeconds = this.createNumericSampleParamReader(
      effect,
      'decaySeconds',
      1.2,
      keyframes,
      value => clamp(value, 0.1, 12),
    );
    const readDamping = this.createNumericSampleParamReader(
      effect,
      'damping',
      0.35,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const roomSize = clamp(this.getNumericEffectParam(effect, 'roomSize', 0.35), 0, 1);
    const output = this.createMutableAudioBufferLike(buffer);
    const baseDelaysMs = [23, 31, 37, 43, 53, 61];
    const roomScale = 0.35 + roomSize * 1.65;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      const channelOffset = channel * 0.17;
      const delays = baseDelaysMs.map(delayMs =>
        Math.max(1, Math.round(buffer.sampleRate * (delayMs * (roomScale + channelOffset)) / 1000))
      );
      const lines = delays.map(delay => new Float32Array(delay));
      const positions = delays.map(() => 0);
      const filtered = delays.map(() => 0);

      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const dry = input[index] ?? 0;
        let wet = 0;
        const dampingKeep = 1 - readDamping(time) * 0.72;
        const decaySeconds = readDecaySeconds(time);

        for (let tap = 0; tap < lines.length; tap += 1) {
          const line = lines[tap];
          const position = positions[tap];
          const delayed = line[position] ?? 0;
          const delaySeconds = delays[tap] / buffer.sampleRate;
          const feedback = clamp(Math.pow(0.001, delaySeconds / decaySeconds), 0.08, 0.93);
          filtered[tap] = filtered[tap] * (1 - dampingKeep) + delayed * dampingKeep;
          wet += filtered[tap];
          line[position] = clamp(dry + filtered[tap] * feedback, -4, 4);
          positions[tap] = (position + 1) % line.length;
        }

        wet /= Math.max(1, lines.length);
        const mix = readMix(time);
        target[index] = dry * (1 - mix) + wet * mix;
      }
    }

    return output;
  }

  private applySaturation(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const staticMix = clamp(this.getNumericEffectParam(effect, 'mix', 0), 0, 1);
    if (staticMix <= 0.0001 && !this.hasEffectParamKeyframes(keyframes, effect.id, 'mix')) {
      return buffer;
    }

    const readDriveDb = this.createNumericSampleParamReader(
      effect,
      'driveDb',
      0,
      keyframes,
      value => Math.max(0, value),
    );
    const readToneHz = this.createNumericSampleParamReader(
      effect,
      'toneHz',
      16000,
      keyframes,
      value => clamp(value, 200, buffer.sampleRate / 2 - 1),
    );
    const readMix = this.createNumericSampleParamReader(
      effect,
      'mix',
      0,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      let toneState = 0;

      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const dry = input[index] ?? 0;
        const driveDb = readDriveDb(time);
        const driven = driveDb <= 0.001
          ? dry
          : Math.tanh(dry * dbToLinearGain(driveDb)) / Math.tanh(dbToLinearGain(driveDb));
        const toneAlpha = 1 - Math.exp(-2 * Math.PI * readToneHz(time) / buffer.sampleRate);
        toneState += toneAlpha * (driven - toneState);
        const mix = readMix(time);
        target[index] = clamp(dry * (1 - mix) + toneState * mix, -1, 1);
      }
    }

    return output;
  }

  private applyDeClick(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const readThreshold = this.createNumericSampleParamReader(
      effect,
      'threshold',
      0.35,
      keyframes,
      value => clamp(value, 0.01, 1),
    );
    const readRatio = this.createNumericSampleParamReader(
      effect,
      'ratio',
      4,
      keyframes,
      value => Math.max(1, value),
    );
    const readMix = this.createNumericSampleParamReader(
      effect,
      'mix',
      1,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      if (buffer.length <= 2) {
        target.set(input);
        continue;
      }
      target[0] = input[0] ?? 0;
      target[buffer.length - 1] = input[buffer.length - 1] ?? 0;

      for (let index = 1; index < buffer.length - 1; index += 1) {
        const time = index / buffer.sampleRate;
        const previous = input[index - 1] ?? 0;
        const dry = input[index] ?? 0;
        const next = input[index + 1] ?? 0;
        const prediction = (previous + next) / 2;
        const residual = Math.abs(dry - prediction);
        const neighborEnergy = (Math.abs(previous) + Math.abs(next)) / 2;
        const click = residual >= readThreshold(time) && residual >= neighborEnergy * readRatio(time);
        const mix = readMix(time);
        target[index] = click ? dry * (1 - mix) + prediction * mix : dry;
      }
    }

    return output;
  }

  private calculateNoiseReductionTargetGain(
    envelope: number,
    thresholdDb: number,
    reductionDb: number,
    sensitivity: number,
  ): number {
    if (reductionDb <= 0.0001 || sensitivity <= 0.0001) {
      return 1;
    }
    const envelopeDb = 20 * Math.log10(Math.max(0.000001, envelope));
    if (envelopeDb >= thresholdDb) {
      return 1;
    }
    const reductionRatio = clamp(((thresholdDb - envelopeDb) / 48) * sensitivity, 0, 1);
    return dbToLinearGain(-reductionDb * reductionRatio);
  }

  private applyNoiseReduction(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const staticReductionDb = this.getNumericEffectParam(effect, 'reductionDb', 0);
    const staticMix = clamp(this.getNumericEffectParam(effect, 'mix', 0), 0, 1);
    if (
      (staticReductionDb <= 0.0001 || staticMix <= 0.0001) &&
      !this.hasEffectParamKeyframes(keyframes, effect.id, 'reductionDb') &&
      !this.hasEffectParamKeyframes(keyframes, effect.id, 'mix')
    ) {
      return buffer;
    }

    const readThresholdDb = this.createNumericSampleParamReader(
      effect,
      'thresholdDb',
      -60,
      keyframes,
      value => clamp(value, -100, 0),
    );
    const readReductionDb = this.createNumericSampleParamReader(
      effect,
      'reductionDb',
      0,
      keyframes,
      value => clamp(value, 0, 60),
    );
    const readSensitivity = this.createNumericSampleParamReader(
      effect,
      'sensitivity',
      1,
      keyframes,
      value => clamp(value, 0.1, 4),
    );
    const readAttackMs = this.createNumericSampleParamReader(
      effect,
      'attackMs',
      5,
      keyframes,
      value => Math.max(0.001, value),
    );
    const readReleaseMs = this.createNumericSampleParamReader(
      effect,
      'releaseMs',
      160,
      keyframes,
      value => Math.max(0.001, value),
    );
    const readMix = this.createNumericSampleParamReader(
      effect,
      'mix',
      0,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      let envelope = 0;
      let gain = 1;

      for (let index = 0; index < buffer.length; index += 1) {
        const time = index / buffer.sampleRate;
        const dry = input[index] ?? 0;
        const attackCoefficient = Math.exp(-1 / (buffer.sampleRate * readAttackMs(time) / 1000));
        const releaseCoefficient = Math.exp(-1 / (buffer.sampleRate * readReleaseMs(time) / 1000));
        const amplitude = Math.abs(dry);
        const envelopeCoefficient = amplitude > envelope ? attackCoefficient : releaseCoefficient;
        envelope = amplitude + envelopeCoefficient * (envelope - amplitude);
        const targetGain = this.calculateNoiseReductionTargetGain(
          envelope,
          readThresholdDb(time),
          readReductionDb(time),
          readSensitivity(time),
        );
        const gainCoefficient = targetGain < gain ? attackCoefficient : releaseCoefficient;
        gain = targetGain + gainCoefficient * (gain - targetGain);
        const mix = readMix(time);
        target[index] = dry * (1 - mix) + dry * gain * mix;
      }
    }

    return output;
  }

  private applySpectralGate(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
    keyframes: Keyframe[],
  ): AudioBuffer {
    const staticReductionDb = this.getNumericEffectParam(effect, 'reductionDb', 0);
    const staticMix = clamp(this.getNumericEffectParam(effect, 'mix', 1), 0, 1);
    if (
      (staticReductionDb <= 0.0001 || staticMix <= 0.0001) &&
      !this.hasEffectParamKeyframes(keyframes, effect.id, 'reductionDb') &&
      !this.hasEffectParamKeyframes(keyframes, effect.id, 'mix')
    ) {
      return buffer;
    }

    const readThresholdDb = this.createNumericSampleParamReader(
      effect,
      'thresholdDb',
      -60,
      keyframes,
      value => clamp(value, -100, 0),
    );
    const readReductionDb = this.createNumericSampleParamReader(
      effect,
      'reductionDb',
      0,
      keyframes,
      value => clamp(value, 0, 80),
    );
    const readLowFrequencyHz = this.createNumericSampleParamReader(
      effect,
      'lowFrequencyHz',
      250,
      keyframes,
      value => clamp(value, 20, buffer.sampleRate / 2 - 20),
    );
    const readHighFrequencyHz = this.createNumericSampleParamReader(
      effect,
      'highFrequencyHz',
      5000,
      keyframes,
      value => clamp(value, 40, buffer.sampleRate / 2 - 1),
    );
    const readAttackMs = this.createNumericSampleParamReader(
      effect,
      'attackMs',
      8,
      keyframes,
      value => Math.max(0.001, value),
    );
    const readReleaseMs = this.createNumericSampleParamReader(
      effect,
      'releaseMs',
      180,
      keyframes,
      value => Math.max(0.001, value),
    );
    const readMix = this.createNumericSampleParamReader(
      effect,
      'mix',
      1,
      keyframes,
      value => clamp(value, 0, 1),
    );
    const output = this.createMutableAudioBufferLike(buffer);

    processSpectralGateBlock(
      buffer,
      output,
      time => ({
        thresholdDb: readThresholdDb(time),
        reductionDb: readReductionDb(time),
        lowFrequencyHz: readLowFrequencyHz(time),
        highFrequencyHz: readHighFrequencyHz(time),
        attackMs: readAttackMs(time),
        releaseMs: readReleaseMs(time),
        mix: readMix(time),
      }),
      createSpectralGateState(),
    );
    return output;
  }

  private getChannelMode(effect: RenderableAudioEffectInstance): 'all' | 'left' | 'right' {
    const mode = effect.params?.channelMode;
    return mode === 'left' || mode === 'right' ? mode : 'all';
  }

  private applyPolarityInvert(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    const channelMode = this.getChannelMode(effect);
    const output = this.createMutableAudioBufferLike(buffer);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const input = buffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      const invert =
        channelMode === 'all' ||
        (channelMode === 'left' && channel === 0) ||
        (channelMode === 'right' && channel === 1);

      for (let index = 0; index < buffer.length; index += 1) {
        const sample = input[index] ?? 0;
        target[index] = invert ? -sample : sample;
      }
    }

    return output;
  }

  private applyMonoSum(buffer: AudioBuffer): AudioBuffer {
    if (buffer.numberOfChannels <= 1) {
      return buffer;
    }

    const output = this.createMutableAudioBufferLike(buffer);
    const sourceChannels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));

    for (let index = 0; index < buffer.length; index += 1) {
      let sum = 0;
      for (const source of sourceChannels) {
        sum += source[index] ?? 0;
      }
      const mono = sum / sourceChannels.length;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        output.getChannelData(channel)[index] = mono;
      }
    }

    return output;
  }

  private applyChannelSwap(buffer: AudioBuffer): AudioBuffer {
    if (buffer.numberOfChannels < 2) {
      return buffer;
    }

    const output = this.createMutableAudioBufferLike(buffer);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const sourceChannel = channel === 0 ? 1 : channel === 1 ? 0 : channel;
      output.getChannelData(channel).set(buffer.getChannelData(sourceChannel));
    }

    return output;
  }

  private applyStereoSplit(
    buffer: AudioBuffer,
    effect: RenderableAudioEffectInstance,
  ): AudioBuffer {
    if (buffer.numberOfChannels <= 0) {
      return buffer;
    }

    const sourceChannel = Math.max(
      0,
      Math.min(buffer.numberOfChannels - 1, Math.round(this.getNumericEffectParam(effect, 'sourceChannel', 0))),
    );
    const output = this.createMutableAudioBufferLike(buffer);
    const source = buffer.getChannelData(sourceChannel);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      output.getChannelData(channel).set(source);
    }

    return output;
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
