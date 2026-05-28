import type {
  SignalArtifactEncoding,
  SignalArtifactStorage,
  SignalMetadata,
} from '../signals';

// Shared audio workstation contracts.
// These types are intentionally JSON-safe so project state can reference
// analysis artifacts without embedding large audio buffers in project JSON.

export type AudioEffectParamValue =
  | string
  | number
  | boolean
  | null
  | AudioEffectParamValue[]
  | { [key: string]: AudioEffectParamValue };

export type AudioEffectParams = Record<string, AudioEffectParamValue>;

export type AudioAnalysisArtifactKind =
  | 'waveform-pyramid'
  | 'processed-waveform-pyramid'
  | 'spectrogram-tiles'
  | 'loudness-envelope'
  | 'beat-grid'
  | 'onset-map'
  | 'phase-correlation'
  | 'transcript-timing'
  | 'frequency-summary'
  | 'stem-separation';

export type AudioStemKind =
  | 'mix'
  | 'vocals'
  | 'drums'
  | 'bass'
  | 'other'
  | 'instrumental'
  | 'dialogue'
  | 'music'
  | 'sfx';

export type AudioChannelLayoutKind =
  | 'mono'
  | 'stereo'
  | 'surround'
  | 'ambisonic'
  | 'discrete'
  | 'multi-channel'
  | 'unknown';

export interface AudioChannelLayout {
  kind: AudioChannelLayoutKind;
  channelCount: number;
  labels?: string[];
}

export interface AudioArtifactByteRange {
  offset: number;
  length: number;
}

export interface AudioSignalArtifactRef {
  artifactId: string;
  hash?: string;
  size?: number;
  mimeType?: string;
  encoding?: SignalArtifactEncoding;
  storage?: SignalArtifactStorage;
  createdAt?: string;
  byteRange?: AudioArtifactByteRange;
  metadata?: SignalMetadata;
}

export interface AudioAnalysisWarning {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  details?: SignalMetadata;
}

export interface AudioAnalysisArtifact {
  schemaVersion?: 1;
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
  metadata?: SignalMetadata;
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

export type ClipAudioAnalysisJobKind =
  | AudioAnalysisArtifactKind
  | 'beat-onset-analysis'
  | 'frequency-phase-analysis';

export type ClipAudioAnalysisJobPhase =
  | 'queued'
  | 'preparing'
  | 'rendering-processed-audio'
  | 'analyzing'
  | 'storing'
  | 'complete'
  | 'cancelled'
  | 'failed';

export interface ClipAudioAnalysisJobState {
  jobId: string;
  kind: ClipAudioAnalysisJobKind;
  label: string;
  artifactKinds: AudioAnalysisArtifactKind[];
  processed: boolean;
  phase: ClipAudioAnalysisJobPhase;
  progress: number;
  startedAt: string;
  updatedAt: string;
  message?: string;
}

export interface AudioDerivedAssetRef {
  id: string;
  mediaFileId: string;
  sourceMediaFileId?: string;
  sourceClipId?: string;
  operationIds: string[];
  createdAt: number;
  provenance?: Record<string, string | number | boolean | null>;
  restore?: AudioBakeRestoreState;
}

export interface AudioBakeRestoreState {
  name: string;
  mediaFileId?: string;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceNaturalDuration?: number;
  waveform?: number[];
  waveformChannels?: number[][];
  audioState?: ClipAudioState;
}

export type AudioRecordingPhase =
  | 'idle'
  | 'waiting-for-punch'
  | 'warming-input'
  | 'requesting-input'
  | 'recording'
  | 'stopping'
  | 'complete'
  | 'error';

export interface AudioRecordingTarget {
  trackId: string;
  trackName?: string;
  inputDeviceId?: string;
}

export type AudioRecordingStorageWarningCode =
  | 'storage-estimate-unavailable'
  | 'storage-persistence-denied'
  | 'storage-persistence-granted'
  | 'storage-quota-low'
  | 'storage-quota-near-full';

export interface AudioRecordingStorageWarning {
  code: AudioRecordingStorageWarningCode;
  severity: 'info' | 'warning';
  message: string;
  usageBytes?: number;
  quotaBytes?: number;
  availableBytes?: number;
  estimatedSessionBytes?: number;
  persistent?: boolean;
  persistRequested?: boolean;
  persistGranted?: boolean;
}

export interface AudioRecordingRecoveryEntry {
  sessionId: string;
  targetTrackIds: string[];
  inputDeviceIds: string[];
  startedAt: number;
  startTime: number;
  punchInTime?: number;
  punchOutTime?: number;
  assets?: AudioRecordingRecoveryAssetRef[];
  chunks?: AudioRecordingRecoveryChunkRef[];
  status: 'active' | 'stopped' | 'cancelled' | 'error';
  message?: string;
}

export interface AudioRecordingRecoveryAssetRef {
  id: string;
  artifactId: string;
  inputDeviceId?: string;
  trackIds: string[];
  fileName: string;
  mimeType: string;
  sourceMimeType: string;
  duration: number;
  startTime: number;
  startedAt: number;
  stoppedAt: number;
  sampleRate?: number;
  channelCount?: number;
  chunkCount: number;
}

export interface AudioRecordingRecoveryChunkRef {
  artifactId: string;
  inputDeviceId?: string;
  trackIds: string[];
  chunkIndex: number;
  kind: 'media-recorder' | 'audio-worklet-pcm-f32';
  mimeType: string;
  startedAt: number;
  startTime: number;
  timeStart: number;
  duration?: number;
  sampleRate?: number;
  channelCount?: number;
  frameCount?: number;
}

export interface AudioRecordingState {
  phase: AudioRecordingPhase;
  sessionId?: string;
  targetTrackIds?: string[];
  startedAt?: number;
  startTime?: number;
  punchInTime?: number;
  punchOutTime?: number;
  elapsedSeconds?: number;
  inputDeviceIds?: string[];
  lastError?: string;
  lastCompletedAt?: number;
  recoveryEntries?: AudioRecordingRecoveryEntry[];
  storageWarnings?: AudioRecordingStorageWarning[];
}

export interface AudioEffectInstance {
  id: string;
  descriptorId: string;
  enabled: boolean;
  params: AudioEffectParams;
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
  enabled?: boolean;
  blendMode: 'attenuate' | 'boost' | 'gate' | 'sidechain-mask' | 'replace';
  gainDb: number;
  featherTime: number;
  featherFrequency: number;
  keyframes?: SpectralImageLayerKeyframe[];
}

export interface ClipAudioStemLayer {
  id: string;
  kind: AudioStemKind;
  label: string;
  analysisArtifactId: string;
  manifestArtifactId: string;
  payloadRef: AudioSignalArtifactRef;
  mediaFileId?: string;
  waveform?: number[];
  enabled: boolean;
  gainDb: number;
  phaseAligned: boolean;
  modelId: string;
  sourceFingerprint: string;
}

export interface ClipAudioStemState {
  activeSetId: string;
  modelId: string;
  modelVersion: string;
  createdAt: number;
  sourceFingerprint: string;
  range: { start: number; end: number };
  sampleRate: number;
  channelCount: number;
  stems: ClipAudioStemLayer[];
  soloStemId?: string;
  sourceGainDb?: number;
  mixMode: 'original' | 'stems' | 'hybrid';
}

export interface ClipAudioEditOperation {
  id: string;
  type:
    | 'trim'
    | 'cut'
    | 'gain'
    | 'silence'
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
    | 'effect'
    | 'room-tone-fill'
    | 'spectral-mask'
    | 'spectral-resynthesis';
  enabled: boolean;
  params: Record<string, string | number | boolean | null>;
  timeRange?: { start: number; end: number };
  channelMask?: number[];
  createdAt: number;
}

export interface ClipAudioRegionGainPreview {
  clipId: string;
  trackId?: string;
  startTime?: number;
  endTime?: number;
  sourceInPoint: number;
  sourceOutPoint: number;
  gainDb: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}

export interface ClipAudioState {
  sourceAudioRevisionId?: string;
  editStack?: ClipAudioEditOperation[];
  effectStack?: AudioEffectInstance[];
  spectralLayers?: SpectralImageLayer[];
  stemSeparation?: ClipAudioStemState;
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

export interface AudioMeterSnapshot {
  peakLinear: number;
  rmsLinear: number;
  peakDb: number;
  rmsDb: number;
  clipping: boolean;
  channels?: {
    left: AudioMeterChannelSnapshot;
    right: AudioMeterChannelSnapshot;
  };
  phaseCorrelation?: number;
  stereoWidth?: number;
  spectrumDb?: Float32Array;
  updatedAt: number;
  dynamics?: Record<string, AudioDynamicsReductionSnapshot>;
}

export interface AudioMeterChannelSnapshot {
  peakLinear: number;
  rmsLinear: number;
  peakDb: number;
  rmsDb: number;
}

export interface AudioDynamicsReductionSnapshot {
  effectId: string;
  processorType: 'compressor' | 'de-esser' | 'limiter' | 'noise-gate' | 'expander' | 'dynamic-eq-band';
  gainReductionDb: number;
  updatedAt: number;
}

export interface RuntimeAudioMeterState {
  trackMeters: Record<string, AudioMeterSnapshot>;
  master?: AudioMeterSnapshot;
}

export interface AudioExportPreflightState {
  lastCheckedAt?: number;
  warnings?: AudioAnalysisWarning[];
  measurement?: AudioExportPreflightMeasurement;
  measurementHistory?: AudioExportPreflightMeasurementHistoryEntry[];
}

export interface AudioExportPreflightMeasurement {
  mode: 'rendered-export';
  duration: number;
  sampleRate: number;
  channelCount: number;
  integratedLufs?: number;
  truePeakDbtp?: number;
  samplePeakDbfs?: number;
  rmsDbfs?: number;
  targetLufs?: number;
  loudnessDelta?: number;
  truePeakCeilingDb?: number;
}

export interface AudioExportPreflightMeasurementHistoryEntry {
  checkedAt: number;
  startTime: number;
  endTime: number;
  measurement: AudioExportPreflightMeasurement;
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
  analysisArtifactIds?: string[];
  analysisArtifacts?: AudioAnalysisArtifact[];
  derivedAssets?: AudioDerivedAssetRef[];
  masterAudioState?: MasterAudioState;
  updatedAt?: string;
}
