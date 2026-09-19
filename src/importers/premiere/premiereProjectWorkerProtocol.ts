import type {
  PremiereExistingMediaDescriptor,
  PremiereProjectImportProgress,
  PremiereProjectImportResult,
  PremiereProjectSummary,
} from './premiereProjectTypes';

export interface PremiereProjectWorkerStartRequest {
  type: 'start';
  file: File;
  existingMedia: PremiereExistingMediaDescriptor[];
  parentId: string | null;
}

export interface PremiereProjectWorkerSelectRequest {
  type: 'select';
  selectedSequenceUids?: string[];
}

export type PremiereProjectWorkerRequest =
  | PremiereProjectWorkerStartRequest
  | PremiereProjectWorkerSelectRequest;

export type PremiereProjectWorkerResponse =
  | { type: 'progress'; progress: PremiereProjectImportProgress }
  | { type: 'summary'; summary: PremiereProjectSummary }
  | { type: 'result'; result: PremiereProjectImportResult }
  | { type: 'error'; message: string };
