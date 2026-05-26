export const AUDIO_EQ_SCHEMA_VERSION = 2 as const;
export const AUDIO_EQ_MAX_BANDS = 24 as const;

export type AudioEqPhaseMode = 'zero-latency' | 'natural' | 'linear';
export type AudioEqCharacterMode = 'clean' | 'subtle' | 'warm';
export type AudioEqAnalyzerMode = 'off' | 'pre' | 'post' | 'pre-post';
export type AudioEqPresetKind =
  | '3-band'
  | '10-band-graphic'
  | 'parametric'
  | 'mastering'
  | 'match'
  | 'custom';

export type AudioEqBandType =
  | 'bell'
  | 'low-shelf'
  | 'high-shelf'
  | 'low-cut'
  | 'high-cut'
  | 'notch'
  | 'band-pass'
  | 'tilt-shelf'
  | 'all-pass';

export type AudioEqBandStereoMode =
  | 'stereo'
  | 'left'
  | 'right'
  | 'mid'
  | 'side'
  | 'surround';

export interface AudioEqBandDynamics {
  enabled: boolean;
  mode: 'compress' | 'expand';
  thresholdDb: number;
  rangeDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  sidechainMode: 'self' | 'external';
  sidechainFilterHz?: number;
  sidechainFilterQ?: number;
}

export interface AudioEqBandSpectralDynamics {
  enabled: boolean;
  mode: 'compress' | 'expand';
  thresholdDb: number;
  rangeDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  resolution: 'low-latency' | 'balanced' | 'mastering';
}

export interface AudioEqBand {
  id: string;
  enabled: boolean;
  type: AudioEqBandType;
  frequencyHz: number;
  gainDb: number;
  q: number;
  slopeDbPerOct?: number;
  brickwall?: boolean;
  stereoMode: AudioEqBandStereoMode;
  channelMask?: string[];
  dynamic?: AudioEqBandDynamics;
  spectralDynamics?: AudioEqBandSpectralDynamics;
}

export interface AudioEqAudibleStateV2 {
  presetKind: AudioEqPresetKind;
  phaseMode: AudioEqPhaseMode;
  characterMode: AudioEqCharacterMode;
  bands: AudioEqBand[];
}

export interface AudioEqDisplayStateV2 {
  analyzerMode: AudioEqAnalyzerMode;
  analyzerRangeDb: 3 | 6 | 12 | 30;
  pianoDisplay: boolean;
  graphRangeDb: 3 | 6 | 12 | 30;
  showPhaseCurve?: boolean;
  showGainReduction?: boolean;
  selectedBandIds?: string[];
  soloBandIds?: string[];
}

export interface AudioEqMatchState {
  enabled: boolean;
  sourceRef?: string;
  targetRef?: string;
  amount: number;
  smoothing: number;
  generatedAt?: string;
}

export interface AudioEqSketchState {
  lastStrokeId?: string;
  fittedBandIds?: string[];
  simplification: number;
  maxGeneratedBands: number;
}

export interface AudioEqParamsV2 {
  schemaVersion: typeof AUDIO_EQ_SCHEMA_VERSION;
  audible: AudioEqAudibleStateV2;
  display: AudioEqDisplayStateV2;
  provenance?: {
    match?: AudioEqMatchState;
    sketch?: AudioEqSketchState;
  };
}

export interface AudioEqAnalyzerView {
  preDb?: Float32Array;
  postDb?: Float32Array;
  peakDb?: Float32Array;
}

export interface AudioEqBandResponseView {
  bandId: string;
  color: string;
  enabled: boolean;
  responseDb: Float32Array;
  handle: {
    x: number;
    y: number;
    frequencyHz: number;
    gainDb: number;
  };
}

export interface AudioEqGraphViewModel {
  width: number;
  height: number;
  devicePixelRatio: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  rangeDb: 3 | 6 | 12 | 30;
  xFrequenciesHz: Float32Array;
  bandResponses: AudioEqBandResponseView[];
  summedResponseDb: Float32Array;
  analyzer?: AudioEqAnalyzerView;
  selectedBandIds: string[];
  hoveredBandId?: string;
}

export type AudioEqCompilerDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface AudioEqCompilerDiagnostic {
  severity: AudioEqCompilerDiagnosticSeverity;
  code: string;
  message: string;
  bandId?: string;
}

export interface AudioEqBiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

export interface CompiledAudioEqBandPlan {
  band: AudioEqBand;
  coefficients: AudioEqBiquadCoefficients[];
}

export interface CompiledAudioEqPlan {
  sampleRate: number;
  phaseMode: AudioEqPhaseMode;
  characterMode: AudioEqCharacterMode;
  latencySamples: number;
  bands: CompiledAudioEqBandPlan[];
  diagnostics: AudioEqCompilerDiagnostic[];
}
