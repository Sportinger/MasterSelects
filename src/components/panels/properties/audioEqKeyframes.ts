import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
} from '../../../engine/audio/eq/AudioEqDefaults';
import type { AudioEqBand } from '../../../engine/audio/eq/AudioEqTypes';
import type { AnimatableProperty } from '../../../types';
import { createEffectProperty } from '../../../types';

export type AudioEqKeyframeEntry = {
  property: AnimatableProperty;
  value: number;
};

export function createAudioEqBandNumericProperty(effectId: string, bandId: string, paramPath: string): AnimatableProperty {
  return createEffectProperty(effectId, `eq.audible.bands.${bandId}.${paramPath}`);
}

function bandEntry(effectId: string, bandId: string, paramPath: string, value: number): AudioEqKeyframeEntry {
  return {
    property: createAudioEqBandNumericProperty(effectId, bandId, paramPath),
    value,
  };
}

export function getAudioEqBandNumericKeyframeEntries(effectId: string, band: AudioEqBand): AudioEqKeyframeEntry[] {
  return [
    bandEntry(effectId, band.id, 'frequencyHz', band.frequencyHz),
    bandEntry(effectId, band.id, 'gainDb', band.gainDb),
    bandEntry(effectId, band.id, 'q', band.q),
    ...(band.slopeDbPerOct !== undefined
      ? [bandEntry(effectId, band.id, 'slopeDbPerOct', band.slopeDbPerOct)]
      : []),
    bandEntry(effectId, band.id, 'dynamic.thresholdDb', band.dynamic?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb),
    bandEntry(effectId, band.id, 'dynamic.rangeDb', band.dynamic?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb),
    bandEntry(effectId, band.id, 'dynamic.ratio', band.dynamic?.ratio ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio),
    bandEntry(effectId, band.id, 'dynamic.attackMs', band.dynamic?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs),
    bandEntry(effectId, band.id, 'dynamic.releaseMs', band.dynamic?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs),
    ...(band.dynamic?.sidechainFilterHz !== undefined
      ? [bandEntry(effectId, band.id, 'dynamic.sidechainFilterHz', band.dynamic.sidechainFilterHz)]
      : []),
    ...(band.dynamic?.sidechainFilterQ !== undefined
      ? [bandEntry(effectId, band.id, 'dynamic.sidechainFilterQ', band.dynamic.sidechainFilterQ)]
      : []),
    bandEntry(effectId, band.id, 'spectralDynamics.thresholdDb', band.spectralDynamics?.thresholdDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb),
    bandEntry(effectId, band.id, 'spectralDynamics.rangeDb', band.spectralDynamics?.rangeDb ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb),
    bandEntry(effectId, band.id, 'spectralDynamics.ratio', band.spectralDynamics?.ratio ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio),
    bandEntry(effectId, band.id, 'spectralDynamics.attackMs', band.spectralDynamics?.attackMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs),
    bandEntry(effectId, band.id, 'spectralDynamics.releaseMs', band.spectralDynamics?.releaseMs ?? AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs),
  ];
}

export function getAudioEqAllNumericKeyframeEntries(effectId: string, bands: readonly AudioEqBand[]): AudioEqKeyframeEntry[] {
  return bands.flatMap(band => getAudioEqBandNumericKeyframeEntries(effectId, band));
}
