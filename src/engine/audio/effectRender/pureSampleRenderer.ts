import {
  AUDIO_CHANNEL_SWAP_EFFECT_ID,
  AUDIO_DE_CLICK_EFFECT_ID,
  AUDIO_DELAY_EFFECT_ID,
  AUDIO_EXPANDER_EFFECT_ID,
  AUDIO_LIMITER_EFFECT_ID,
  AUDIO_MONO_SUM_EFFECT_ID,
  AUDIO_NOISE_GATE_EFFECT_ID,
  AUDIO_NOISE_REDUCTION_EFFECT_ID,
  AUDIO_NORMALIZE_EFFECT_ID,
  AUDIO_POLARITY_INVERT_EFFECT_ID,
  AUDIO_REVERB_EFFECT_ID,
  AUDIO_SATURATION_EFFECT_ID,
  AUDIO_SPECTRAL_GATE_EFFECT_ID,
  AUDIO_STEREO_SPLIT_EFFECT_ID,
  type EffectRenderKeyframe,
  type RenderableAudioEffectInstance,
} from './audioEffectRenderContracts';
import { applyExpander, applyNoiseGate, applyNoiseReduction, applyPeakLimiter, applySpectralGate } from './sampleDynamicsProcessors';
import { audioMathProgram, processAudioMathChannels } from '../../../services/operators/audioOperatorGraph';
import { createBufferLike } from '../audioBufferFactory';
import { applyDeClick, applyDelay, applyReverb, applySaturation } from './sampleTimeToneProcessors';
import { applyChannelSwap, applyMonoSum, applyNormalize, applyPolarityInvert, applyStereoSplit } from './sampleUtilityProcessors';

export function isPureSampleEffect(effectId: string): boolean {
  return effectId === 'audio-math' || effectId === AUDIO_LIMITER_EFFECT_ID ||
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

export function renderPureSampleEffect(
  buffer: AudioBuffer,
  effect: RenderableAudioEffectInstance,
  keyframes: EffectRenderKeyframe[],
): AudioBuffer {
  switch (effect.descriptorId) {
    case 'audio-math': {
      const result = createBufferLike(buffer);
      processAudioMathChannels(audioMathProgram(effect.params?.operatorGraph),
        Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
        Array.from({ length: result.numberOfChannels }, (_, channel) => result.getChannelData(channel)));
      return result;
    }
    case AUDIO_LIMITER_EFFECT_ID:
      return applyPeakLimiter(buffer, effect, keyframes);
    case AUDIO_NOISE_GATE_EFFECT_ID:
      return applyNoiseGate(buffer, effect, keyframes);
    case AUDIO_EXPANDER_EFFECT_ID:
      return applyExpander(buffer, effect, keyframes);
    case AUDIO_DELAY_EFFECT_ID:
      return applyDelay(buffer, effect, keyframes);
    case AUDIO_REVERB_EFFECT_ID:
      return applyReverb(buffer, effect, keyframes);
    case AUDIO_SATURATION_EFFECT_ID:
      return applySaturation(buffer, effect, keyframes);
    case AUDIO_DE_CLICK_EFFECT_ID:
      return applyDeClick(buffer, effect, keyframes);
    case AUDIO_NOISE_REDUCTION_EFFECT_ID:
      return applyNoiseReduction(buffer, effect, keyframes);
    case AUDIO_SPECTRAL_GATE_EFFECT_ID:
      return applySpectralGate(buffer, effect, keyframes);
    case AUDIO_POLARITY_INVERT_EFFECT_ID:
      return applyPolarityInvert(buffer, effect);
    case AUDIO_MONO_SUM_EFFECT_ID:
      return applyMonoSum(buffer);
    case AUDIO_CHANNEL_SWAP_EFFECT_ID:
      return applyChannelSwap(buffer);
    case AUDIO_STEREO_SPLIT_EFFECT_ID:
      return applyStereoSplit(buffer, effect);
    case AUDIO_NORMALIZE_EFFECT_ID:
      return applyNormalize(buffer, effect);
    default:
      return buffer;
  }
}
