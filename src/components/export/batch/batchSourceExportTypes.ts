import type { ExportSettings } from '../../../stores/exportStore';

export type BatchSourceMediaType = 'video' | 'audio' | 'image';

export interface BatchSourceExportInput {
  file: File;
  mediaType: BatchSourceMediaType;
  settings: ExportSettings;
  /**
   * Download name or basename. The source file name is used when this is
   * omitted, and any existing extension is replaced with the output extension.
   */
  outputName?: string;
}

export type BatchSourceExportPhase =
  | 'preparing'
  | 'decoding'
  | 'rendering'
  | 'encoding'
  | 'finalizing'
  | 'complete';

export interface BatchSourceExportProgress {
  /** Integer percentage in the inclusive range 0..100. */
  progress: number;
  phase: BatchSourceExportPhase;
}

export type BatchSourceExportProgressCallback = (update: BatchSourceExportProgress) => void;

export interface BatchSourceExportResult {
  blob: Blob;
  filename: string;
}
