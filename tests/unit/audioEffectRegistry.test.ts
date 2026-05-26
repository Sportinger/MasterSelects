import { describe, expect, it } from 'vitest';
import {
  AUDIO_EFFECT_REGISTRY,
  AUDIO_EQ_BAND_PARAMS,
  getAllAudioEffects,
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  hasAudioEffect,
} from '../../src/engine/audio/AudioEffectRegistry';

describe('AudioEffectRegistry', () => {
  it('registers professional audio effect descriptors in stable UI/render order', () => {
    expect(Array.from(AUDIO_EFFECT_REGISTRY.keys())).toEqual([
      'audio-volume',
      'audio-pan',
      'audio-eq',
      'audio-parametric-eq',
      'audio-high-pass',
      'audio-low-pass',
      'audio-hum-notch',
      'audio-de-click',
      'audio-noise-reduction',
      'audio-compressor',
      'audio-de-esser',
      'audio-limiter',
      'audio-noise-gate',
      'audio-expander',
      'audio-delay',
      'audio-reverb',
      'audio-saturation',
      'audio-polarity-invert',
      'audio-mono-sum',
      'audio-channel-swap',
      'audio-stereo-split',
    ]);
    expect(getAllAudioEffects().map(effect => effect.id)).toEqual([
      'audio-volume',
      'audio-pan',
      'audio-eq',
      'audio-parametric-eq',
      'audio-high-pass',
      'audio-low-pass',
      'audio-hum-notch',
      'audio-de-click',
      'audio-noise-reduction',
      'audio-compressor',
      'audio-de-esser',
      'audio-limiter',
      'audio-noise-gate',
      'audio-expander',
      'audio-delay',
      'audio-reverb',
      'audio-saturation',
      'audio-polarity-invert',
      'audio-mono-sum',
      'audio-channel-swap',
      'audio-stereo-split',
    ]);
  });

  it('describes audio-volume defaults and params', () => {
    expect(hasAudioEffect('audio-volume')).toBe(true);
    expect(getAudioEffect('audio-volume')).toMatchObject({
      id: 'audio-volume',
      name: 'Volume',
      paramNames: ['volume'],
    });
    expect(getAudioEffectDefaultParams('audio-volume')).toEqual({ volume: 1 });
    expect(getAudioEffectParamNames('audio-volume')).toEqual(['volume']);
    expect(getAudioEffect('audio-pan')).toMatchObject({
      id: 'audio-pan',
      name: 'Pan',
      category: 'gain',
      paramNames: ['pan'],
    });
    expect(getAudioEffectDefaultParams('audio-pan')).toEqual({ pan: 0 });
    expect(getAudioEffectParamNames('audio-pan')).toEqual(['pan']);
  });

  it('describes audio-eq defaults and params in renderer order', () => {
    expect(hasAudioEffect('audio-eq')).toBe(true);
    expect(getAudioEffect('audio-eq')).toMatchObject({
      id: 'audio-eq',
      name: 'EQ',
      paramNames: AUDIO_EQ_BAND_PARAMS,
    });
    expect(getAudioEffectParamNames('audio-eq')).toEqual([
      'band31',
      'band62',
      'band125',
      'band250',
      'band500',
      'band1k',
      'band2k',
      'band4k',
      'band8k',
      'band16k',
    ]);
    expect(getAudioEffectDefaultParams('audio-eq')).toEqual({
      band31: 0,
      band62: 0,
      band125: 0,
      band250: 0,
      band500: 0,
      band1k: 0,
      band2k: 0,
      band4k: 0,
      band8k: 0,
      band16k: 0,
    });
  });

  it('describes filter and dynamics defaults', () => {
    expect(getAudioEffect('audio-parametric-eq')).toMatchObject({
      id: 'audio-parametric-eq',
      name: 'Parametric EQ',
      category: 'eq',
      paramNames: ['frequencyHz', 'gainDb', 'q'],
    });
    expect(getAudioEffectDefaultParams('audio-parametric-eq')).toEqual({
      frequencyHz: 1000,
      gainDb: 0,
      q: 1,
    });

    expect(getAudioEffect('audio-high-pass')).toMatchObject({
      id: 'audio-high-pass',
      name: 'High Pass Filter',
      category: 'filter',
      paramNames: ['frequencyHz', 'q'],
    });
    expect(getAudioEffectDefaultParams('audio-high-pass')).toEqual({ frequencyHz: 20, q: 0.707 });

    expect(getAudioEffect('audio-low-pass')).toMatchObject({
      id: 'audio-low-pass',
      name: 'Low Pass Filter',
      category: 'filter',
      paramNames: ['frequencyHz', 'q'],
    });
    expect(getAudioEffectDefaultParams('audio-low-pass')).toEqual({ frequencyHz: 22000, q: 0.707 });

    expect(getAudioEffect('audio-hum-notch')).toMatchObject({
      id: 'audio-hum-notch',
      name: 'Hum Notch',
      category: 'repair',
      defaultAudible: true,
      paramNames: ['frequencyHz', 'q', 'harmonics', 'mix'],
    });
    expect(getAudioEffectDefaultParams('audio-hum-notch')).toEqual({
      frequencyHz: 50,
      q: 30,
      harmonics: 2,
      mix: 1,
    });

    expect(getAudioEffect('audio-de-click')).toMatchObject({
      id: 'audio-de-click',
      name: 'De-click',
      category: 'repair',
      defaultAudible: true,
      paramNames: ['threshold', 'ratio', 'mix'],
    });
    expect(getAudioEffectDefaultParams('audio-de-click')).toEqual({
      threshold: 0.35,
      ratio: 4,
      mix: 1,
    });

    expect(getAudioEffect('audio-noise-reduction')).toMatchObject({
      id: 'audio-noise-reduction',
      name: 'Noise Reduction',
      category: 'repair',
      paramNames: ['thresholdDb', 'reductionDb', 'sensitivity', 'attackMs', 'releaseMs', 'mix'],
    });
    expect(getAudioEffectDefaultParams('audio-noise-reduction')).toEqual({
      thresholdDb: -60,
      reductionDb: 0,
      sensitivity: 1,
      attackMs: 5,
      releaseMs: 160,
      mix: 0,
    });

    expect(getAudioEffect('audio-compressor')).toMatchObject({
      id: 'audio-compressor',
      name: 'Compressor',
      category: 'dynamics',
    });
    expect(getAudioEffectDefaultParams('audio-compressor')).toEqual({
      thresholdDb: 0,
      ratio: 1,
      kneeDb: 0,
      attackMs: 10,
      releaseMs: 120,
      makeupGainDb: 0,
    });
    expect(getAudioEffect('audio-de-esser')).toMatchObject({
      id: 'audio-de-esser',
      name: 'De-esser',
      category: 'dynamics',
      paramNames: ['frequencyHz', 'thresholdDb', 'ratio', 'kneeDb', 'attackMs', 'releaseMs', 'makeupGainDb'],
    });
    expect(getAudioEffectDefaultParams('audio-de-esser')).toEqual({
      frequencyHz: 6500,
      thresholdDb: 0,
      ratio: 1,
      kneeDb: 6,
      attackMs: 1,
      releaseMs: 80,
      makeupGainDb: 0,
    });

    expect(getAudioEffectDefaultParams('audio-limiter')).toEqual({
      ceilingDb: 0,
      inputGainDb: 0,
    });
    expect(getAudioEffectDefaultParams('audio-noise-gate')).toEqual({
      thresholdDb: -120,
      floorDb: -80,
      attackMs: 2,
      releaseMs: 80,
    });
    expect(getAudioEffect('audio-expander')).toMatchObject({
      id: 'audio-expander',
      name: 'Expander',
      category: 'dynamics',
      paramNames: ['thresholdDb', 'ratio', 'rangeDb', 'attackMs', 'releaseMs'],
    });
    expect(getAudioEffectDefaultParams('audio-expander')).toEqual({
      thresholdDb: 0,
      ratio: 1,
      rangeDb: 0,
      attackMs: 2,
      releaseMs: 120,
    });
    expect(getAudioEffect('audio-delay')).toMatchObject({
      id: 'audio-delay',
      name: 'Delay',
      category: 'time',
      paramNames: ['delayMs', 'feedback', 'mix', 'toneHz'],
    });
    expect(getAudioEffectDefaultParams('audio-delay')).toEqual({
      delayMs: 250,
      feedback: 0,
      mix: 0,
      toneHz: 12000,
    });
    expect(getAudioEffect('audio-reverb')).toMatchObject({
      id: 'audio-reverb',
      name: 'Reverb',
      category: 'time',
      paramNames: ['roomSize', 'decaySeconds', 'damping', 'mix'],
    });
    expect(getAudioEffectDefaultParams('audio-reverb')).toEqual({
      roomSize: 0.35,
      decaySeconds: 1.2,
      damping: 0.35,
      mix: 0,
    });
    expect(getAudioEffect('audio-saturation')).toMatchObject({
      id: 'audio-saturation',
      name: 'Saturation',
      category: 'distortion',
      paramNames: ['driveDb', 'toneHz', 'mix'],
    });
    expect(getAudioEffectDefaultParams('audio-saturation')).toEqual({
      driveDb: 0,
      toneHz: 16000,
      mix: 0,
    });
    expect(getAudioEffect('audio-polarity-invert')).toMatchObject({
      id: 'audio-polarity-invert',
      name: 'Polarity Invert',
      category: 'utility',
      defaultAudible: true,
      paramNames: ['channelMode'],
    });
    expect(getAudioEffectDefaultParams('audio-polarity-invert')).toEqual({
      channelMode: 'all',
    });
    expect(getAudioEffect('audio-mono-sum')).toMatchObject({
      id: 'audio-mono-sum',
      name: 'Mono Sum',
      category: 'utility',
      defaultAudible: true,
      paramNames: [],
    });
    expect(getAudioEffectDefaultParams('audio-mono-sum')).toEqual({});
    expect(getAudioEffect('audio-channel-swap')).toMatchObject({
      id: 'audio-channel-swap',
      name: 'Channel Swap',
      category: 'utility',
      defaultAudible: true,
      paramNames: [],
    });
    expect(getAudioEffectDefaultParams('audio-channel-swap')).toEqual({});
    expect(getAudioEffect('audio-stereo-split')).toMatchObject({
      id: 'audio-stereo-split',
      name: 'Stereo Split',
      category: 'utility',
      defaultAudible: true,
      paramNames: ['sourceChannel'],
    });
    expect(getAudioEffectDefaultParams('audio-stereo-split')).toEqual({ sourceChannel: 0 });
  });

  it('returns defensive copies for arrays and default params', () => {
    const paramNames = getAudioEffectParamNames('audio-volume');
    paramNames.push('mutated');

    const defaults = getAudioEffectDefaultParams('audio-volume');
    defaults.volume = 0.5;

    expect(getAudioEffectParamNames('audio-volume')).toEqual(['volume']);
    expect(getAudioEffectDefaultParams('audio-volume')).toEqual({ volume: 1 });
  });

  it('handles unknown ids without fallback behavior', () => {
    expect(hasAudioEffect('brightness')).toBe(false);
    expect(getAudioEffect('brightness')).toBeUndefined();
    expect(getAudioEffectParamNames('brightness')).toEqual([]);
    expect(getAudioEffectDefaultParams('brightness')).toEqual({});
  });
});
