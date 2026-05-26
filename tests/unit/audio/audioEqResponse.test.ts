import { describe, expect, it } from 'vitest';
import {
  AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES,
  addAudioEqBand,
  compileAudioEqPlan,
  createAudioEqGraphViewModel,
  createAudioEqResponseSet,
  createLogFrequencySamples,
  isAudioEqAutomationOrphaned,
  removeAudioEqBand,
  reorderAudioEqBand,
  updateAudioEqBand,
} from '../../../src/engine/audio';

function nearestIndex(values: Float32Array, target: number): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

describe('audio eq response', () => {
  it('creates deterministic log-frequency samples', () => {
    const samples = createLogFrequencySamples(5, 20, 20_000);

    expect([...samples].map(value => Math.round(value))).toEqual([20, 112, 632, 3557, 20000]);
  });

  it('generates true bell response data with summed response', () => {
    const response = createAudioEqResponseSet({ band1k: 6 }, { sampleCount: 256, sampleRate: 48_000 });
    const centerIndex = nearestIndex(response.frequenciesHz, 1000);
    const lowIndex = nearestIndex(response.frequenciesHz, 60);

    expect(response.bandResponsesDb.get('band1k')?.[centerIndex]).toBeGreaterThan(5.4);
    expect(Math.abs(response.summedResponseDb[centerIndex] - response.bandResponsesDb.get('band1k')![centerIndex])).toBeLessThan(0.001);
    expect(Math.abs(response.summedResponseDb[lowIndex])).toBeLessThan(0.25);
  });

  it('compiles diagnostics for delegated phase and character processors', () => {
    const plan = compileAudioEqPlan({
      eq: {
        schemaVersion: 2,
        audible: {
          presetKind: 'custom',
          phaseMode: 'linear',
          characterMode: 'warm',
          bands: [
            {
              id: 'steep-cut',
              enabled: true,
              type: 'low-cut',
              frequencyHz: 80,
              gainDb: 0,
              q: 0.707,
              slopeDbPerOct: 14.2,
              stereoMode: 'stereo',
            },
          ],
        },
        display: {
          analyzerMode: 'off',
          analyzerRangeDb: 12,
          graphRangeDb: 12,
          pianoDisplay: false,
          selectedBandIds: [],
        },
      },
    });

    expect(plan.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      'audio-eq-linear-phase-fir-processor',
      'audio-eq-character-mode-sample-processor',
      'audio-eq-fractional-slope-approximated',
    ]));
    expect(plan.latencySamples).toBe(AUDIO_EQ_LINEAR_PHASE_LATENCY_SAMPLES);
  });

  it('compiles steeper cut slopes as deterministic biquad cascades', () => {
    const plan = compileAudioEqPlan({
      eq: {
        schemaVersion: 2,
        audible: {
          presetKind: 'custom',
          phaseMode: 'zero-latency',
          characterMode: 'clean',
          bands: [{
            id: 'steep-cut',
            enabled: true,
            type: 'low-cut',
            frequencyHz: 100,
            gainDb: 0,
            q: 0.707,
            slopeDbPerOct: 48,
            stereoMode: 'stereo',
          }],
        },
        display: {
          analyzerMode: 'off',
          analyzerRangeDb: 12,
          graphRangeDb: 12,
          pianoDisplay: false,
          selectedBandIds: [],
        },
      },
    });

    expect(plan.bands[0]?.coefficients).toHaveLength(4);
  });

  it('builds graph view model handles and selected ids from canonical state', () => {
    const viewModel = createAudioEqGraphViewModel({
      eq: {
        schemaVersion: 2,
        audible: {
          presetKind: 'custom',
          phaseMode: 'zero-latency',
          characterMode: 'clean',
          bands: [
            {
              id: 'focus',
              enabled: true,
              type: 'bell',
              frequencyHz: 1000,
              gainDb: 6,
              q: 1.4,
              stereoMode: 'stereo',
            },
          ],
        },
        display: {
          analyzerMode: 'off',
          analyzerRangeDb: 12,
          graphRangeDb: 12,
          pianoDisplay: false,
          selectedBandIds: ['focus'],
        },
      },
    }, { width: 600, height: 240, sampleCount: 128, devicePixelRatio: 2 });

    expect(viewModel.devicePixelRatio).toBe(2);
    expect(viewModel.selectedBandIds).toEqual(['focus']);
    expect(viewModel.bandResponses).toHaveLength(1);
    expect(viewModel.bandResponses[0].handle.x).toBeGreaterThan(0);
    expect(viewModel.bandResponses[0].handle.x).toBeLessThan(600);
    expect(viewModel.bandResponses[0].handle.y).toBeLessThan(120);
    expect(viewModel.summedResponseDb.length).toBe(128);
  });

  it('projects analyzer post spectrum from the current EQ response', () => {
    const inputSpectrum = new Float32Array(128).fill(-60);
    const viewModel = createAudioEqGraphViewModel({
      eq: {
        schemaVersion: 2,
        audible: {
          presetKind: 'custom',
          phaseMode: 'zero-latency',
          characterMode: 'clean',
          bands: [
            {
              id: 'focus',
              enabled: true,
              type: 'bell',
              frequencyHz: 1000,
              gainDb: 6,
              q: 1.4,
              stereoMode: 'stereo',
            },
          ],
        },
        display: {
          analyzerMode: 'pre-post',
          analyzerRangeDb: 12,
          graphRangeDb: 12,
          pianoDisplay: false,
          selectedBandIds: ['focus'],
        },
      },
    }, {
      width: 600,
      height: 240,
      sampleCount: 128,
      analyzer: { postDb: inputSpectrum },
    });

    const analyzer = viewModel.analyzer;
    expect(analyzer?.preDb).toBe(inputSpectrum);
    expect(analyzer?.postDb).toBeDefined();
    const centerIndex = nearestIndex(viewModel.xFrequenciesHz, 1000);
    const lowIndex = nearestIndex(viewModel.xFrequenciesHz, 60);

    expect((analyzer?.postDb?.[centerIndex] ?? -60) - inputSpectrum[centerIndex]).toBeGreaterThan(5);
    expect(Math.abs((analyzer?.postDb?.[lowIndex] ?? -60) - inputSpectrum[lowIndex])).toBeLessThan(1);
  });

  it('supports band add, update, reorder, remove, and orphan automation checks', () => {
    const added = addAudioEqBand({}, { id: 'custom', frequencyHz: 1200, gainDb: 3 });
    const updated = updateAudioEqBand(added, 'custom', { gainDb: -4, q: 2 });
    const reordered = reorderAudioEqBand(updated, 'custom', 0);
    const removed = removeAudioEqBand(reordered, 'custom');

    expect(updated.audible.bands.find(band => band.id === 'custom')).toMatchObject({ gainDb: -4, q: 2 });
    expect(reordered.audible.bands[0].id).toBe('custom');
    expect(isAudioEqAutomationOrphaned('effect.eq.eq.audible.bands.custom.gainDb', removed)).toBe(true);
    expect(isAudioEqAutomationOrphaned('effect.eq.eq.audible.bands.band1k.gainDb', removed)).toBe(false);
  });
});
