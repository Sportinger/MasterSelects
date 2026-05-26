import { describe, expect, it } from 'vitest';
import {
  getAudioEqAudibleStateForIdentity,
  getAudioEqLegacyBandGains,
  isAudioEqAudibleStateDefault,
  normalizeAudioEqParams,
  normalizeLegacyParametricAudioEqParams,
} from '../../../src/engine/audio';
import { getAudioEffectParamPathValue, mergeAudioEffectParamPatch } from '../../../src/utils/audioEffectParamPath';

describe('audio eq foundation', () => {
  it('normalizes legacy 10-band params into canonical v2 state', () => {
    const normalized = normalizeAudioEqParams({ band31: -2, band1k: 3 });

    expect(normalized).toMatchObject({
      schemaVersion: 2,
      audible: {
        presetKind: '10-band-graphic',
        phaseMode: 'zero-latency',
        characterMode: 'clean',
      },
      display: {
        analyzerMode: 'off',
        analyzerRangeDb: 12,
        graphRangeDb: 12,
      },
    });
    expect(normalized.audible.bands).toHaveLength(10);
    expect(normalized.audible.bands.find(band => band.id === 'band31')).toMatchObject({ frequencyHz: 31, gainDb: -2 });
    expect(normalized.audible.bands.find(band => band.id === 'band1k')).toMatchObject({ frequencyHz: 1000, gainDb: 3 });
  });

  it('keeps display state out of audible identity', () => {
    const eq = normalizeAudioEqParams({ band1k: 4 });
    const changedDisplay = normalizeAudioEqParams({
      eq: {
        ...eq,
        display: {
          ...eq.display,
          analyzerMode: 'pre-post',
          analyzerRangeDb: 30,
          graphRangeDb: 30,
          selectedBandIds: ['band1k'],
        },
      },
    });

    expect(getAudioEqAudibleStateForIdentity({ eq: changedDisplay })).toEqual(getAudioEqAudibleStateForIdentity({ eq }));
  });

  it('maps legacy parametric eq params into one canonical bell band', () => {
    const normalized = normalizeLegacyParametricAudioEqParams({ frequencyHz: 2400, gainDb: -5, q: 3.2 });

    expect(normalized.audible).toMatchObject({
      presetKind: 'parametric',
      phaseMode: 'zero-latency',
      characterMode: 'clean',
    });
    expect(normalized.audible.bands).toEqual([
      expect.objectContaining({
        id: 'band-parametric-1',
        type: 'bell',
        frequencyHz: 2400,
        gainDb: -5,
        q: 3.2,
      }),
    ]);
  });

  it('supports legacy route gain extraction from flat and structured params', () => {
    const flat = getAudioEqLegacyBandGains({ band31: -1, band1k: 2 });
    const structured = getAudioEqLegacyBandGains({
      eq: normalizeAudioEqParams({ band31: -1, band1k: 2 }),
    });

    expect(flat).toEqual(structured);
    expect(flat[0]).toBe(-1);
    expect(flat[5]).toBe(2);
  });

  it('detects default audible state independent of display state', () => {
    const eq = normalizeAudioEqParams({});

    expect(isAudioEqAudibleStateDefault({
      eq: {
        ...eq,
        display: {
          ...eq.display,
          analyzerMode: 'post',
          selectedBandIds: ['band1k'],
        },
      },
    })).toBe(true);
    expect(isAudioEqAudibleStateDefault({ band1k: 1 })).toBe(false);
  });

  it('applies nested EQ param paths by stable band id', () => {
    const params = mergeAudioEffectParamPatch(
      { band1k: 2 },
      { 'eq.audible.bands.band1k.gainDb': 5 },
      'audio-eq',
    );

    expect(getAudioEffectParamPathValue(params.eq, ['audible', 'bands', 'band1k', 'gainDb'])).toBe(5);
    expect(normalizeAudioEqParams(params).audible.bands.find(band => band.id === 'band1k')).toMatchObject({
      gainDb: 5,
    });
  });
});
