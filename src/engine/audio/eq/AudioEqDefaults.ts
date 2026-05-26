import {
  AUDIO_EQ_SCHEMA_VERSION,
  type AudioEqBand,
  type AudioEqBandDynamics,
  type AudioEqBandSpectralDynamics,
  type AudioEqDisplayStateV2,
  type AudioEqParamsV2,
  type AudioEqPresetKind,
} from './AudioEqTypes';

export const AUDIO_EQ_LEGACY_BANDS = Object.freeze([
  { id: 'band31', frequencyHz: 31 },
  { id: 'band62', frequencyHz: 62 },
  { id: 'band125', frequencyHz: 125 },
  { id: 'band250', frequencyHz: 250 },
  { id: 'band500', frequencyHz: 500 },
  { id: 'band1k', frequencyHz: 1000 },
  { id: 'band2k', frequencyHz: 2000 },
  { id: 'band4k', frequencyHz: 4000 },
  { id: 'band8k', frequencyHz: 8000 },
  { id: 'band16k', frequencyHz: 16000 },
]);

export const AUDIO_EQ_DEFAULT_Q = 1.4;

export const AUDIO_EQ_DEFAULT_BAND_DYNAMICS = Object.freeze({
  enabled: false,
  mode: 'compress',
  thresholdDb: -30,
  rangeDb: 6,
  ratio: 3,
  attackMs: 8,
  releaseMs: 120,
  sidechainMode: 'self',
} satisfies AudioEqBandDynamics);

export const AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS = Object.freeze({
  enabled: false,
  mode: 'compress',
  thresholdDb: -34,
  rangeDb: 6,
  ratio: 3,
  attackMs: 4,
  releaseMs: 120,
  resolution: 'balanced',
} satisfies AudioEqBandSpectralDynamics);

export function createDefaultAudioEqBandDynamics(): AudioEqBandDynamics {
  return { ...AUDIO_EQ_DEFAULT_BAND_DYNAMICS };
}

export function createDefaultAudioEqBandSpectralDynamics(): AudioEqBandSpectralDynamics {
  return { ...AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS };
}

export function createDefaultAudioEqDisplayState(): AudioEqDisplayStateV2 {
  return {
    analyzerMode: 'off',
    analyzerRangeDb: 12,
    pianoDisplay: false,
    graphRangeDb: 12,
    showPhaseCurve: false,
    showGainReduction: false,
    selectedBandIds: [],
    soloBandIds: [],
  };
}

export function createAudioEqBand(input: Partial<AudioEqBand> & Pick<AudioEqBand, 'id' | 'frequencyHz'>): AudioEqBand {
  return {
    id: input.id,
    enabled: input.enabled ?? true,
    type: input.type ?? 'bell',
    frequencyHz: input.frequencyHz,
    gainDb: input.gainDb ?? 0,
    q: input.q ?? AUDIO_EQ_DEFAULT_Q,
    ...(input.slopeDbPerOct !== undefined ? { slopeDbPerOct: input.slopeDbPerOct } : {}),
    ...(input.brickwall !== undefined ? { brickwall: input.brickwall } : {}),
    stereoMode: input.stereoMode ?? 'stereo',
    ...(input.channelMask ? { channelMask: [...input.channelMask] } : {}),
    ...(input.dynamic ? { dynamic: { ...input.dynamic } } : {}),
    ...(input.spectralDynamics ? { spectralDynamics: { ...input.spectralDynamics } } : {}),
  };
}

export function createTenBandGraphicAudioEqParams(): AudioEqParamsV2 {
  return {
    schemaVersion: AUDIO_EQ_SCHEMA_VERSION,
    audible: {
      presetKind: '10-band-graphic',
      phaseMode: 'zero-latency',
      characterMode: 'clean',
      bands: AUDIO_EQ_LEGACY_BANDS.map(band => createAudioEqBand(band)),
    },
    display: createDefaultAudioEqDisplayState(),
  };
}

export function createParametricAudioEqParams(input: {
  frequencyHz?: number;
  gainDb?: number;
  q?: number;
} = {}): AudioEqParamsV2 {
  return {
    schemaVersion: AUDIO_EQ_SCHEMA_VERSION,
    audible: {
      presetKind: 'parametric',
      phaseMode: 'zero-latency',
      characterMode: 'clean',
      bands: [
        createAudioEqBand({
          id: 'band-parametric-1',
          frequencyHz: input.frequencyHz ?? 1000,
          gainDb: input.gainDb ?? 0,
          q: input.q ?? 1,
        }),
      ],
    },
    display: createDefaultAudioEqDisplayState(),
  };
}

export function createDefaultAudioEqParams(presetKind: AudioEqPresetKind = '10-band-graphic'): AudioEqParamsV2 {
  if (presetKind === 'parametric') {
    return createParametricAudioEqParams();
  }

  const params = createTenBandGraphicAudioEqParams();
  params.audible.presetKind = presetKind;
  return params;
}
