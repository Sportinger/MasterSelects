export type BatchExportRuntimeStatus =
  | 'queued'
  | 'resolving'
  | 'encoding'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BatchExportRuntimeState {
  status: BatchExportRuntimeStatus;
  progress: number;
  phase?: string;
  error?: string;
}

export type BatchExportRuntimeMap = Record<string, BatchExportRuntimeState>;
