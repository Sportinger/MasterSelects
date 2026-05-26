import { describe, expect, it } from 'vitest';
import { buildAudioRepairSuggestions } from '../../../src/services/audio/audioRepairSuggestions';

describe('audio repair suggestions', () => {
  it('suggests deterministic repair operations from cached summaries', () => {
    const suggestions = buildAudioRepairSuggestions({
      loudness: {
        sampleRate: 48_000,
        duration: 12,
        curves: [],
        summary: {
          integratedLufs: -31,
          truePeakDbtp: -0.2,
          samplePeakDbfs: -0.4,
          rmsDbfs: -28,
        },
      },
      frequency: {
        sampleRate: 48_000,
        duration: 12,
        fftSize: 2048,
        hopSize: 512,
        summary: {
          spectralCentroidHz: 240,
          lowEnergyShare: 0.62,
          midEnergyShare: 0.32,
          highEnergyShare: 0.06,
          dominantBandId: 'mains',
        },
        bands: [
          {
            bandId: 'mains',
            label: '50 Hz',
            minFrequency: 45,
            maxFrequency: 55,
            rmsDb: -21,
            peakDb: -12,
            energyShare: 0.24,
            centroidHz: 50,
          },
        ],
      },
      phase: {
        sampleRate: 48_000,
        duration: 12,
        windowDuration: 0.4,
        hopDuration: 0.1,
        points: [],
        summary: {
          averageCorrelation: 0.12,
          minimumCorrelation: -0.58,
          maximumCorrelation: 0.8,
          negativeCorrelationPercent: 22,
          averageMidSideRatioDb: 5,
          stereoWidth: 1.5,
          monoCompatible: false,
        },
      },
    });

    expect(suggestions.map(suggestion => suggestion.kind)).toEqual([
      'loudness-match',
      'mono-compatibility',
      'hum-notch',
      'de-click',
    ]);
    expect(suggestions[0].operation).toEqual({
      editType: 'repair',
      params: expect.objectContaining({ repairType: 'loudness-match', targetDb: -18 }),
    });
    expect(suggestions.find(suggestion => suggestion.kind === 'hum-notch')?.operation.params)
      .toMatchObject({ repairType: 'hum-notch', baseFrequencyHz: 50 });
    expect(suggestions.find(suggestion => suggestion.kind === 'mono-compatibility')?.operation)
      .toMatchObject({ editType: 'mono-sum' });
  });

  it('returns no suggestions for normal, mono-compatible material', () => {
    expect(buildAudioRepairSuggestions({
      loudness: {
        sampleRate: 48_000,
        duration: 5,
        curves: [],
        summary: {
          integratedLufs: -18,
          truePeakDbtp: -3,
          rmsDbfs: -20,
        },
      },
      frequency: {
        sampleRate: 48_000,
        duration: 5,
        fftSize: 2048,
        hopSize: 512,
        summary: {
          spectralCentroidHz: 1800,
          lowEnergyShare: 0.18,
          midEnergyShare: 0.6,
          highEnergyShare: 0.22,
        },
        bands: [],
      },
      phase: {
        sampleRate: 48_000,
        duration: 5,
        windowDuration: 0.4,
        hopDuration: 0.1,
        points: [],
        summary: {
          averageCorrelation: 0.72,
          minimumCorrelation: 0.1,
          maximumCorrelation: 1,
          negativeCorrelationPercent: 0,
          averageMidSideRatioDb: -8,
          stereoWidth: 0.6,
          monoCompatible: true,
        },
      },
    })).toEqual([]);
  });
});
