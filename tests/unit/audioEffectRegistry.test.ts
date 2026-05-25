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
  it('registers only the existing audio effect descriptors', () => {
    expect(Array.from(AUDIO_EFFECT_REGISTRY.keys())).toEqual(['audio-volume', 'audio-eq']);
    expect(getAllAudioEffects().map(effect => effect.id)).toEqual(['audio-volume', 'audio-eq']);
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
