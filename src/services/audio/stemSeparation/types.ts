import type { AudioStemKind } from '../../../types/audio';

export type StemSeparationBackend = 'webgpu' | 'wasm';

export interface StemModelFile {
  name: string;
  url: string;
  sizeBytes: number;
  checksumSha256?: string;
}

export interface StemModelCatalogEntry {
  id: string;
  label: string;
  modelVersion: string;
  description: string;
  stems: AudioStemKind[];
  inputSampleRate: number;
  outputStemOrder: AudioStemKind[];
  files: StemModelFile[];
  segmentSeconds?: number;
  supportedBackends: StemSeparationBackend[];
  testedBrowserRuntime: boolean;
  productionDropdown: boolean;
  license?: string;
  attribution?: string;
}

export interface StemModelCacheFileStatus {
  name: string;
  url: string;
  expectedBytes: number;
  actualBytes?: number;
  cached: boolean;
  valid: boolean;
  reason?: 'missing' | 'size-mismatch' | 'metadata-missing' | 'version-mismatch';
}

export interface StemModelCacheStatus {
  modelId: string;
  modelVersion: string;
  cached: boolean;
  persistent?: boolean;
  expectedBytes: number;
  actualBytes: number;
  files: StemModelCacheFileStatus[];
}

export interface StemModelDownloadProgress {
  modelId: string;
  fileName: string;
  downloadedBytes: number;
  totalFileBytes: number;
  overallDownloadedBytes: number;
  overallTotalBytes: number;
  progress: number;
}

export interface StemModelFileBuffer {
  name: string;
  buffer: ArrayBuffer;
}

export interface StemSeparationInput {
  modelId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  channels: Float32Array[];
}

export interface StemSeparationWorkerStemResult {
  kind: AudioStemKind;
  sampleRate: number;
  channels: Float32Array[];
}

export type StemSeparationWorkerRequest =
  | {
    type: 'load-model';
    modelId: string;
    modelBuffers: StemModelFileBuffer[];
  }
  | {
    type: 'load-model-url';
    modelId: string;
    modelUrl: string;
  }
  | { type: 'separate'; jobId: string; input: StemSeparationInput }
  | { type: 'cancel'; jobId: string }
  | { type: 'dispose-model' };

export type StemSeparationWorkerResponse =
  | { type: 'model-ready'; modelId: string; backend: StemSeparationBackend }
  | {
    type: 'model-load-progress';
    modelId: string;
    phase: string;
    progress: number;
    message?: string;
  }
  | {
    type: 'progress';
    jobId: string;
    phase: string;
    progress: number;
    message?: string;
  }
  | { type: 'result'; jobId: string; stems: StemSeparationWorkerStemResult[] }
  | { type: 'cancelled'; jobId: string }
  | { type: 'error'; jobId?: string; error: string };
