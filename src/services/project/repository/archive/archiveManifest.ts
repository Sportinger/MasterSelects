import type { BlobReference, CommitReference, RecordReference, RepositoryDescriptor, RepositoryRecord } from '../contracts';

export type HistorySelection = { kind: 'current' | 'named'; revision: RecordReference; name?: string }
  | { kind: 'branches'; roots: Record<string, RecordReference> }
  | { kind: 'all' };
export interface WorkspaceSelection { workspaceId: string; viewKey: string; }
export interface ArchiveSource { sourceId: string; identity: BlobReference; chunks: AsyncIterable<Uint8Array>; }
export interface ArchiveOptions {
  targetRepositoryId?: string;
  history: HistorySelection;
  journals: 'none' | 'all' | RecordReference[];
  workspace: WorkspaceSelection[];
  media: 'linked' | 'self-contained';
  /** Must enumerate every required external original for each selected object. */
  resolveSources?: (record: RepositoryRecord) => AsyncIterable<ArchiveSource>;
  metadata?: Record<string, RecordReference>;
  signal?: AbortSignal;
}
export interface RepositoryArchiveManifest {
  format: 'masterselects-repository-archive';
  formatVersion: 1;
  repository: RepositoryDescriptor;
  sourceRepositoryId: string;
  sourceCommit: CommitReference;
  targetCommit: CommitReference;
  history: { kind: HistorySelection['kind']; name?: string; roots: string[] };
  journals: 'none' | 'all' | 'selected';
  workspace: WorkspaceSelection[];
  media: 'linked' | 'self-contained';
  selfContained: boolean;
  sourceBindingsHead: RecordReference | null;
}
