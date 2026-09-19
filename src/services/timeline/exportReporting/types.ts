import type { FullExportSettings } from '../../../engine/export/types';

export interface ExportRunReport {
  runId: string;
  settings: FullExportSettings;
  totalFrames?: number;
  startedAtMs?: number;
  exportMode?: string;
  requestedAudio?: boolean;
  effectiveAudio?: boolean;
}

export interface ExportOutputSurfaceReport {
  runId: string;
  width: number;
  height: number;
  zeroCopy: boolean;
  stackedAlpha?: boolean;
}

export interface ExportPreviewFrameReport {
  runId: string;
  width: number;
  height: number;
  currentTime: number;
}

export type ExportAudioBufferStage =
  | 'source-buffer'
  | 'processed-buffer'
  | 'mix-buffer'
  | 'master-buffer';

export interface ExportAudioBufferReport {
  runId: string;
  stage: ExportAudioBufferStage;
  buffer: AudioBuffer;
  clipId?: string;
  mediaFileId?: string;
  trackId?: string;
}

export interface ExportClipElementAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  mediaFileId?: string;
  previewPath?: string;
  srcKind?: 'blob-url' | 'remote-url' | 'project-path' | 'unknown';
  dedicated?: boolean;
}

export interface ExportRuntimeBindingAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  runtimeSource: {
    type?: string;
    runtimeSourceId: string;
    runtimeSessionKey: string;
    mediaFileId?: string;
    filePath?: string;
  };
}

export interface ExportFrameProviderAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  runtimeSource?: {
    runtimeSourceId?: string;
    runtimeSessionKey?: string;
    mediaFileId?: string;
  };
  width?: number;
  height?: number;
  providerKind?: 'webcodecs' | 'turbores' | 'hap' | 'runtime-frame-provider';
  frameFormat?: 'video-frame' | 'image-bitmap' | 'canvas-image-source' | 'unknown';
  label?: string;
  tags?: readonly string[];
}

export interface ExportParallelDecodeAdmissionReport {
  runId: string;
  clip: {
    id: string;
    trackId?: string;
    mediaFileId?: string;
    duration?: number;
  };
  runtimeSource?: {
    runtimeSourceId?: string;
    runtimeSessionKey?: string;
    mediaFileId?: string;
  };
  codec?: string;
  width?: number;
  height?: number;
  isNested?: boolean;
  estimatedBufferedFrameBytes?: number;
}
