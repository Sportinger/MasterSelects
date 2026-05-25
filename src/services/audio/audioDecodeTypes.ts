import type { SignalMetadata } from '../../signals/types';

export const AUDIO_DECODE_SCHEMA_VERSION = 1 as const;

export type AudioDecodeSourceKind = 'file' | 'blob' | 'array-buffer' | 'bytes';

export type AudioDecodeRuntimeKind =
  | 'worker'
  | 'native'
  | 'wasm'
  | 'browser-fallback'
  | 'mock';

export type AudioDecodeJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type AudioDecodeProgressPhase =
  | 'queued'
  | 'reading'
  | 'decoding'
  | 'finalizing'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type AudioDecodeErrorCode =
  | 'cancelled'
  | 'no-decoder-available'
  | 'decode-failed'
  | 'runtime-probe-failed'
  | 'source-read-failed'
  | 'browser-fallback-unavailable'
  | 'browser-fallback-source-too-large'
  | 'browser-fallback-output-too-large'
  | 'decode-output-too-large'
  | 'invalid-decode-result';

export type AudioDecodeChannelLayoutKind =
  | 'mono'
  | 'stereo'
  | 'surround'
  | 'ambisonic'
  | 'discrete'
  | 'unknown';

export interface AudioDecodeChannelLayout {
  kind: AudioDecodeChannelLayoutKind;
  channelCount: number;
  labels?: string[];
}

export type AudioDecodeWarningCode =
  | 'partial'
  | 'decode-fallback'
  | 'channel-layout-unknown'
  | 'duration-mismatch'
  | 'source-read-failed'
  | 'fallback-bounds-exceeded';

export interface AudioDecodeWarning {
  code: AudioDecodeWarningCode;
  message: string;
  details?: SignalMetadata;
}

export type AudioDecodeSource =
  | {
      kind: 'file';
      file: File;
    }
  | {
      kind: 'blob';
      blob: Blob;
      name?: string;
      mimeType?: string;
    }
  | {
      kind: 'array-buffer';
      arrayBuffer: ArrayBuffer;
      name?: string;
      mimeType?: string;
    }
  | {
      kind: 'bytes';
      bytes: Uint8Array;
      name?: string;
      mimeType?: string;
    };

export interface AudioDecodeSourceInfo {
  kind: AudioDecodeSourceKind;
  size: number;
  name?: string;
  mimeType?: string;
}

export interface AudioDecodeRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  source: AudioDecodeSource;
  clipAudioStateHash?: string;
  targetSampleRate?: number;
  metadata?: SignalMetadata;
}

export interface AudioDecodeProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: AudioDecodeProgressPhase;
  percent: number;
  timestamp: string;
  runtimeId?: string;
  message?: string;
}

export interface AudioDecodeResultMetadata {
  schemaVersion: typeof AUDIO_DECODE_SCHEMA_VERSION;
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  decoderId: string;
  decoderVersion: string;
  runtimeKind: AudioDecodeRuntimeKind;
  fallbackUsed: boolean;
  source: AudioDecodeSourceInfo;
  sampleRate: number;
  channelLayout: AudioDecodeChannelLayout;
  duration: number;
  length: number;
  decodedPcmBytes: number;
  startedAt: string;
  completedAt: string;
  warnings?: AudioDecodeWarning[];
  requestMetadata?: SignalMetadata;
  runtimeMetadata?: SignalMetadata;
}

export interface AudioDecodeResult {
  jobId: string;
  mediaFileId: string;
  buffer: AudioBuffer;
  metadata: AudioDecodeResultMetadata;
  warnings: AudioDecodeWarning[];
}

export interface AudioDecodeRuntimeResult {
  buffer: AudioBuffer;
  warnings?: AudioDecodeWarning[];
  metadata?: SignalMetadata;
}

export interface AudioDecodeRuntimeProgressUpdate {
  phase?: AudioDecodeProgressPhase;
  percent?: number;
  message?: string;
}

export interface AudioDecodeRuntimeCanDecodeContext {
  jobId: string;
  sourceInfo: AudioDecodeSourceInfo;
  signal: AbortSignal;
}

export interface AudioDecodeRuntimeContext extends AudioDecodeRuntimeCanDecodeContext {
  startedAt: string;
  now: () => string;
  reportProgress: (progress: AudioDecodeRuntimeProgressUpdate) => void;
  readSourceBytes: () => Promise<ArrayBuffer>;
  throwIfCancelled: () => void;
}

export interface AudioDecodeRuntime {
  id: string;
  version: string;
  kind: AudioDecodeRuntimeKind;
  canDecode?: (
    request: AudioDecodeRequest,
    context: AudioDecodeRuntimeCanDecodeContext,
  ) => boolean | Promise<boolean>;
  decode: (
    request: AudioDecodeRequest,
    context: AudioDecodeRuntimeContext,
  ) => Promise<AudioDecodeRuntimeResult>;
  dispose?: () => void;
}

export interface AudioDecodeJobSnapshot {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  status: AudioDecodeJobStatus;
  progress: AudioDecodeProgress;
  createdAt: string;
  updatedAt: string;
  runtimeId?: string;
  errorCode?: AudioDecodeErrorCode;
  errorMessage?: string;
}

export interface AudioDecodeJobHandle {
  jobId: string;
  signal: AbortSignal;
  promise: Promise<AudioDecodeResult>;
  cancel: (reason?: unknown) => void;
}
