import { describe, expect, it } from 'vitest';
import {
  applyAudioEqCurveFit,
  applyAudioEqMatch,
  applyAudioEqSpectrumGrabPeak,
  createAudioEqParamsForPresetKind,
  detectAudioEqSpectrumGrabPeaks,
  fitAudioEqBandsToCurve,
} from '../../../src/engine/audio';

function makeSpectrum(length: number, peaks: Array<{ index: number; height: number }>): Float32Array {
  const values = new Float32Array(length);
  values.fill(-78);
  for (const peak of peaks) {
    for (let offset = -6; offset <= 6; offset += 1) {
      const index = Math.max(0, Math.min(length - 1, peak.index + offset));
      values[index] = Math.max(values[index] ?? -78, -78 + peak.height * Math.exp(-(offset * offset) / 7));
    }
  }
  return values;
}

describe('audio eq generators', () => {
  it('fits editable bell bands from a sketched response curve', () => {
    const fit = fitAudioEqBandsToCurve([
      { frequencyHz: 40, gainDb: 0 },
      { frequencyHz: 120, gainDb: 5.5 },
      { frequencyHz: 450, gainDb: -4 },
      { frequencyHz: 1600, gainDb: 3.2 },
      { frequencyHz: 6000, gainDb: -6 },
      { frequencyHz: 16_000, gainDb: 0 },
    ], { maxBands: 4, idPrefix: 'sketch' });

    expect(fit.bands.length).toBeGreaterThanOrEqual(3);
    expect(fit.bands.length).toBeLessThanOrEqual(4);
    expect(fit.bands.every(band => band.type === 'bell')).toBe(true);
    expect(fit.bands.some(band => band.gainDb < -3)).toBe(true);
    expect(fit.bands.some(band => band.gainDb > 3)).toBe(true);
  });

  it('applies sketch output as normal selected custom bands', () => {
    const params = createAudioEqParamsForPresetKind('10-band-graphic');
    const next = applyAudioEqCurveFit(params, [
      { frequencyHz: 80, gainDb: -3 },
      { frequencyHz: 1000, gainDb: 6 },
      { frequencyHz: 10_000, gainDb: 0 },
    ], { maxBands: 3, source: 'sketch' });

    expect(next.audible.presetKind).toBe('custom');
    expect(next.audible.bands.length).toBeGreaterThan(0);
    expect(next.display.selectedBandIds).toEqual(next.audible.bands.map(band => band.id));
    expect(next.provenance?.sketch?.fittedBandIds).toEqual(next.audible.bands.map(band => band.id));
  });

  it('detects stable spectrum peaks and creates a surgical grab band', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    const peaks = detectAudioEqSpectrumGrabPeaks(makeSpectrum(128, [
      { index: 42, height: 24 },
      { index: 91, height: 16 },
    ]), { maxPeaks: 4, minProminenceDb: 5 });

    expect(peaks.length).toBe(2);
    expect(peaks[0]?.prominenceDb).toBeGreaterThan(10);

    const next = applyAudioEqSpectrumGrabPeak(params, peaks[0]!);
    const grabbed = next.audible.bands.find(band => band.id.startsWith('grab-'));
    expect(grabbed).toBeTruthy();
    expect(grabbed?.q).toBeGreaterThan(1);
    expect(next.display.selectedBandIds).toContain(grabbed?.id);
  });

  it('fits an editable match curve from source and target spectra', () => {
    const source = makeSpectrum(96, [{ index: 28, height: 10 }]);
    const target = makeSpectrum(96, [{ index: 64, height: 24 }]);
    const params = createAudioEqParamsForPresetKind('parametric');
    const matched = applyAudioEqMatch(params, source, target, {
      amount: 0.8,
      smoothing: 0.35,
      maxBands: 6,
    });

    expect(matched.audible.presetKind).toBe('custom');
    expect(matched.audible.bands.length).toBeGreaterThan(0);
    expect(matched.provenance?.match).toMatchObject({
      enabled: true,
      amount: 0.8,
      smoothing: 0.35,
    });
  });
});
