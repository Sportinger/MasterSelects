import { createAudioEqBand, createDefaultAudioEqDisplayState, createTenBandGraphicAudioEqParams } from './AudioEqDefaults';
import type { AudioEqAnalyzerView, AudioEqParamsV2 } from './AudioEqTypes';

export interface AudioEqVisualFixtureCase {
  id: string;
  title: string;
  caption: string;
  compact?: boolean;
  params: AudioEqParamsV2;
  analyzer?: AudioEqAnalyzerView;
}

function createLogFrequencySpectrum(length: number, seed: number): Float32Array {
  const values = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / Math.max(1, length - 1);
    const lowRise = 18 * Math.exp(-Math.pow((t - 0.12) / 0.16, 2));
    const vocalPeak = 12 * Math.exp(-Math.pow((t - 0.52) / 0.12, 2));
    const air = 9 * Math.exp(-Math.pow((t - 0.82) / 0.2, 2));
    const ripple = Math.sin((t * 34 + seed) * Math.PI) * 2.2 + Math.sin((t * 91 + seed * 0.37) * Math.PI) * 1.2;
    values[index] = -82 + lowRise + vocalPeak + air + ripple;
  }
  return values;
}

export function createSyntheticAudioEqAnalyzerView(seed = 1): AudioEqAnalyzerView {
  const preDb = createLogFrequencySpectrum(192, seed);
  const postDb = new Float32Array(preDb.length);
  const peakDb = new Float32Array(preDb.length);

  for (let index = 0; index < preDb.length; index += 1) {
    const t = index / Math.max(1, preDb.length - 1);
    const lowControl = 5.5 * Math.exp(-Math.pow((t - 0.16) / 0.12, 2));
    const deEss = 7.5 * Math.exp(-Math.pow((t - 0.74) / 0.06, 2));
    const highLift = 3.4 * Math.exp(-Math.pow((t - 0.9) / 0.12, 2));
    postDb[index] = preDb[index] - lowControl - deEss + highLift;
    peakDb[index] = Math.max(preDb[index], postDb[index]) + 2.5;
  }

  return { preDb, postDb, peakDb };
}

function withDisplay(
  params: AudioEqParamsV2,
  rangeDb: 3 | 6 | 12 | 30,
  selectedBandIds: string[],
  analyzerMode: AudioEqParamsV2['display']['analyzerMode'] = 'pre-post',
  soloBandIds: string[] = [],
): AudioEqParamsV2 {
  return {
    ...params,
    display: {
      ...createDefaultAudioEqDisplayState(),
      ...params.display,
      analyzerMode,
      graphRangeDb: rangeDb,
      analyzerRangeDb: rangeDb,
      selectedBandIds,
      soloBandIds,
    },
  };
}

function createGraphicTenBandCase(): AudioEqParamsV2 {
  const params = createTenBandGraphicAudioEqParams();
  const gains = [3.5, -6.5, 5, -3, 0.5, 2, 6, 0.5, -7, 2.5];
  return withDisplay({
    ...params,
    audible: {
      ...params.audible,
      bands: params.audible.bands.map((band, index) => ({
        ...band,
        gainDb: gains[index] ?? 0,
        q: index === 8 ? 1.8 : 1.2,
      })),
    },
  }, 12, ['band2k']);
}

function createParametricCase(): AudioEqParamsV2 {
  const params = createTenBandGraphicAudioEqParams();
  return withDisplay({
    ...params,
    audible: {
      presetKind: 'parametric',
      phaseMode: 'natural',
      characterMode: 'clean',
      bands: [
        createAudioEqBand({ id: 'hp-cleanup', type: 'low-cut', frequencyHz: 36, gainDb: 0, q: 0.72, slopeDbPerOct: 24 }),
        createAudioEqBand({ id: 'mud-dip', type: 'bell', frequencyHz: 240, gainDb: -4.6, q: 2.4 }),
        createAudioEqBand({ id: 'body', type: 'low-shelf', frequencyHz: 115, gainDb: 2.2, q: 0.9 }),
        createAudioEqBand({ id: 'presence', type: 'bell', frequencyHz: 2750, gainDb: 5.8, q: 0.82 }),
        createAudioEqBand({ id: 'sibilance-notch', type: 'notch', frequencyHz: 6900, gainDb: 0, q: 9.5 }),
        createAudioEqBand({ id: 'air', type: 'high-shelf', frequencyHz: 11800, gainDb: 3.3, q: 0.72 }),
      ],
    },
  }, 12, ['presence']);
}

function createMasteringCase(): AudioEqParamsV2 {
  const params = createTenBandGraphicAudioEqParams();
  return withDisplay({
    ...params,
    audible: {
      presetKind: 'mastering',
      phaseMode: 'linear',
      characterMode: 'subtle',
      bands: [
        createAudioEqBand({ id: 'sub-trim', type: 'low-cut', frequencyHz: 24, gainDb: 0, q: 0.71, slopeDbPerOct: 18 }),
        createAudioEqBand({ id: 'low-weight', type: 'low-shelf', frequencyHz: 88, gainDb: 1.4, q: 0.68 }),
        createAudioEqBand({ id: 'low-ring', type: 'bell', frequencyHz: 178, gainDb: -2.2, q: 5.6 }),
        createAudioEqBand({ id: 'box-control', type: 'bell', frequencyHz: 410, gainDb: -1.6, q: 2.1 }),
        createAudioEqBand({ id: 'forward', type: 'bell', frequencyHz: 1600, gainDb: 1.8, q: 1.05 }),
        createAudioEqBand({ id: 'harsh-node', type: 'bell', frequencyHz: 3150, gainDb: -3.4, q: 6.8, dynamic: { enabled: true, mode: 'compress', thresholdDb: -27, rangeDb: 5, ratio: 2.5, attackMs: 12, releaseMs: 135, sidechainMode: 'self' } }),
        createAudioEqBand({ id: 'de-ess-wide', type: 'bell', frequencyHz: 7200, gainDb: -2.5, q: 3.5, spectralDynamics: { enabled: true, mode: 'compress', thresholdDb: -34, rangeDb: 6, ratio: 3, attackMs: 4, releaseMs: 90, resolution: 'balanced' } }),
        createAudioEqBand({ id: 'air-polish', type: 'high-shelf', frequencyHz: 13200, gainDb: 1.9, q: 0.7 }),
      ],
    },
  }, 6, ['de-ess-wide'], 'pre-post', ['de-ess-wide']);
}

function createCompactInsertCase(): AudioEqParamsV2 {
  const params = createTenBandGraphicAudioEqParams();
  return withDisplay({
    ...params,
    audible: {
      presetKind: '3-band',
      phaseMode: 'zero-latency',
      characterMode: 'warm',
      bands: [
        createAudioEqBand({ id: 'low', type: 'low-shelf', frequencyHz: 130, gainDb: -1.5, q: 0.8 }),
        createAudioEqBand({ id: 'mid', type: 'bell', frequencyHz: 950, gainDb: 2.8, q: 1.4 }),
        createAudioEqBand({ id: 'high', type: 'high-shelf', frequencyHz: 9200, gainDb: 2.1, q: 0.74 }),
      ],
    },
  }, 12, ['mid'], 'post');
}

export function createAudioEqVisualFixtureCases(): AudioEqVisualFixtureCase[] {
  return [
    {
      id: 'graphic',
      title: '10-Band Graphic',
      caption: 'Legacy-compatible graphic curve with colored band response areas.',
      params: createGraphicTenBandCase(),
      analyzer: createSyntheticAudioEqAnalyzerView(0.1),
    },
    {
      id: 'parametric',
      title: 'Parametric Sculpt',
      caption: 'Free band layout with shelves, cuts, a notch and a summed response curve.',
      params: createParametricCase(),
      analyzer: createSyntheticAudioEqAnalyzerView(0.7),
    },
    {
      id: 'mastering',
      title: 'Mastering / Dynamic',
      caption: 'Dense mastering view prepared for dynamic and spectral band states.',
      params: createMasteringCase(),
      analyzer: createSyntheticAudioEqAnalyzerView(1.4),
    },
    {
      id: 'compact',
      title: 'Compact Insert',
      caption: 'Track-strip sized 3-band control with the same renderer.',
      compact: true,
      params: createCompactInsertCase(),
      analyzer: createSyntheticAudioEqAnalyzerView(2.2),
    },
  ];
}
