import type {
  SignalArtifact,
  SignalArtifactEncoding,
  SignalArtifactStorage,
  SignalMetadata,
} from '../../signals';

export const AUDIO_ARTIFACT_SCHEMA_VERSION = 1 as const;

export const AUDIO_ANALYSIS_ARTIFACT_KINDS = [
  'waveform-pyramid',
  'processed-waveform-pyramid',
  'spectrogram-tiles',
  'loudness-envelope',
  'beat-grid',
  'onset-map',
  'phase-correlation',
  'transcript-timing',
  'frequency-summary',
] as const;

export type AudioAnalysisArtifactKind = typeof AUDIO_ANALYSIS_ARTIFACT_KINDS[number];

export type AudioChannelLayoutKind =
  | 'mono'
  | 'stereo'
  | 'surround'
  | 'ambisonic'
  | 'discrete'
  | 'unknown';

export interface AudioChannelLayout {
  kind: AudioChannelLayoutKind;
  channelCount: number;
  labels?: string[];
}

export type AudioAnalysisWarningCode =
  | 'partial'
  | 'decode-fallback'
  | 'channel-layout-unknown'
  | 'duration-mismatch'
  | 'payload-missing'
  | 'stale-source'
  | 'unsupported-metadata';

export interface AudioAnalysisWarning {
  code: AudioAnalysisWarningCode;
  message: string;
  details?: SignalMetadata;
}

export interface AudioArtifactRef {
  artifactId: string;
  hash: string;
  size: number;
  mimeType: string;
  encoding: SignalArtifactEncoding;
  storage: SignalArtifactStorage;
  createdAt: string;
  metadata?: SignalMetadata;
}

export interface AudioAnalysisArtifact {
  schemaVersion: typeof AUDIO_ARTIFACT_SCHEMA_VERSION;
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
  payloadRefs: AudioArtifactRef[];
  manifestRef: AudioArtifactRef;
  createdAt: number;
  stale: boolean;
  warnings?: AudioAnalysisWarning[];
  metadata?: SignalMetadata;
}

export type PersistedAudioAnalysisArtifact = Omit<AudioAnalysisArtifact, 'manifestRef'>;

export interface AudioArtifactPayloadOptions {
  mediaFileId: string;
  kind: AudioAnalysisArtifactKind;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  mimeType?: string;
  encoding?: SignalArtifactEncoding;
  analyzerVersion?: string;
  sourceRefs?: string[];
  metadata?: SignalMetadata;
  createdAt?: string;
}

export type PutAudioAnalysisArtifactInput = Omit<
  AudioAnalysisArtifact,
  'schemaVersion' | 'manifestRef'
> & {
  schemaVersion?: typeof AUDIO_ARTIFACT_SCHEMA_VERSION;
};

export interface PutAudioAnalysisArtifactResult {
  artifact: AudioAnalysisArtifact;
  deduplicated: boolean;
}

export function audioMediaSourceRef(mediaFileId: string): string {
  return `media:${mediaFileId}`;
}

export function audioAnalysisSourceRef(kind: AudioAnalysisArtifactKind, mediaFileId: string): string {
  return `audio-analysis:${kind}:${mediaFileId}`;
}

export function audioArtifactRefFromSignalArtifact(artifact: SignalArtifact): AudioArtifactRef {
  return {
    artifactId: artifact.artifactId,
    hash: artifact.hash,
    size: artifact.size,
    mimeType: artifact.mimeType,
    encoding: artifact.encoding,
    storage: artifact.storage,
    createdAt: artifact.createdAt,
    metadata: artifact.metadata,
  };
}

export function isAudioAnalysisArtifactKind(value: unknown): value is AudioAnalysisArtifactKind {
  return typeof value === 'string'
    && AUDIO_ANALYSIS_ARTIFACT_KINDS.includes(value as AudioAnalysisArtifactKind);
}

export function createAudioArtifactId(
  kind: AudioAnalysisArtifactKind,
  mediaFileId: string,
  sourceFingerprint: string,
  clipAudioStateHash?: string,
): string {
  return [
    'audio',
    kind,
    mediaFileId,
    sourceFingerprint,
    clipAudioStateHash,
  ]
    .filter((part): part is string => Boolean(part))
    .join(':');
}
