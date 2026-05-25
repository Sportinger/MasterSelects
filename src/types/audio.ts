// Shared audio workstation contracts.
// These types are intentionally JSON-safe so project state can reference
// analysis artifacts without embedding large audio buffers in project JSON.

export type AudioAnalysisArtifactKind =
  | 'waveform-pyramid'
  | 'processed-waveform-pyramid'
  | 'spectrogram-tiles'
  | 'loudness-envelope'
  | 'beat-grid'
  | 'onset-map'
  | 'phase-correlation'
  | 'transcript-timing'
  | 'frequency-summary';

export type AudioChannelLayout =
  | 'mono'
  | 'stereo'
  | 'surround'
  | 'ambisonic'
  | 'multi-channel'
  | 'unknown';

export interface AudioArtifactByteRange {
  offset: number;
  length: number;
}

export interface AudioSignalArtifactRef {
  artifactId: string;
  hash?: string;
  byteRange?: AudioArtifactByteRange;
}

export interface AudioAnalysisWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface AudioAnalysisArtifact {
  id: string;
  kind: AudioAnalysisArtifactKind;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  decoderId: string;
  decoderVersion: string;
  analyzerVersion: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  payloadRefs: AudioSignalArtifactRef[];
  manifestRef: AudioSignalArtifactRef;
  createdAt: number;
  stale: boolean;
  warnings?: AudioAnalysisWarning[];
}

export interface MediaFileAudioAnalysisRefs {
  waveformPyramidId?: string;
  processedWaveformPyramidId?: string;
  spectrogramTileSetIds?: string[];
  loudnessEnvelopeId?: string;
  beatGridId?: string;
  onsetMapId?: string;
  phaseCorrelationId?: string;
  transcriptTimingId?: string;
  frequencySummaryId?: string;
}

export interface AudioDerivedAssetRef {
  id: string;
  mediaFileId: string;
  sourceMediaFileId?: string;
  sourceClipId?: string;
  operationIds: string[];
  createdAt: number;
  provenance?: Record<string, string | number | boolean | null>;
}

export interface AudioEffectInstance {
  id: string;
  descriptorId: string;
  enabled: boolean;
  params: Record<string, string | number | boolean>;
  automationMode?: 'none' | 'clip' | 'track' | 'sample-accurate';
}

export interface SpectralImageLayerKeyframe {
  id: string;
  time: number;
  opacity?: number;
  gainDb?: number;
  frequencyMin?: number;
  frequencyMax?: number;
}

export interface SpectralImageLayer {
  id: string;
  imageMediaFileId: string;
  timeStart: number;
  duration: number;
  frequencyMin: number;
  frequencyMax: number;
  opacity: number;
  blendMode: 'attenuate' | 'boost' | 'gate' | 'sidechain-mask' | 'replace';
  gainDb: number;
  featherTime: number;
  featherFrequency: number;
  keyframes?: SpectralImageLayerKeyframe[];
}

export interface ClipAudioEditOperation {
  id: string;
  type:
    | 'trim'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'insert-silence'
    | 'delete-silence'
    | 'reverse'
    | 'invert-polarity'
    | 'swap-channels'
    | 'mono-sum'
    | 'split-stereo'
    | 'repair'
    | 'spectral-mask'
    | 'spectral-resynthesis';
  enabled: boolean;
  params: Record<string, string | number | boolean | null>;
  timeRange?: { start: number; end: number };
  channelMask?: number[];
  createdAt: number;
}

export interface ClipAudioState {
  sourceAudioRevisionId?: string;
  editStack?: ClipAudioEditOperation[];
  effectStack?: AudioEffectInstance[];
  spectralLayers?: SpectralImageLayer[];
  sourceAnalysisRefs?: MediaFileAudioAnalysisRefs;
  processedAnalysisRefs?: MediaFileAudioAnalysisRefs;
  bakeHistory?: AudioDerivedAssetRef[];
  muted?: boolean;
  soloSafe?: boolean;
}

export interface AudioSendState {
  id: string;
  targetBusId: string;
  gainDb: number;
  preFader: boolean;
  enabled: boolean;
}

export interface TrackAudioState {
  volumeDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  recordArm: boolean;
  inputMonitor: boolean;
  inputDeviceId?: string;
  effectStack?: AudioEffectInstance[];
  sends?: AudioSendState[];
  meterMode: 'peak' | 'rms' | 'lufs';
}

export interface AudioExportPreflightState {
  lastCheckedAt?: number;
  warnings?: AudioAnalysisWarning[];
}

export interface MasterAudioState {
  volumeDb: number;
  limiterEnabled: boolean;
  targetLufs?: number;
  truePeakCeilingDb: number;
  effectStack?: AudioEffectInstance[];
  exportPreflight?: AudioExportPreflightState;
}

export interface ProjectAudioState {
  schemaVersion: 1;
  analysisArtifacts?: AudioAnalysisArtifact[];
  derivedAssets?: AudioDerivedAssetRef[];
  masterAudioState?: MasterAudioState;
  updatedAt?: string;
}
