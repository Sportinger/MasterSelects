import type { BlobReference, CommitManifest, JsonValue, MetadataPage, RecordReference, RepositoryDescriptor, RepositoryErrorCode, RepositoryProjection, RepositoryRecord, RevisionMetadata } from './contracts';
import type { PublicationResult, RecoveryResult } from './persistence/RepositoryPersistence';
import type { RepositoryCommand, OkResponse } from '../../nativeHelper/protocol';

export type RepositoryLocation =
  | { kind: 'fsa'; handle: FileSystemDirectoryHandle }
  | { kind: 'opfs'; path: string }
  | { kind: 'native'; path: string };
export interface DraftRecord {
  id: string; kind: RepositoryRecord['kind']; schemaVersion: 1;
  /** {$record: localId} placeholders are resolved in topological order. */
  payload: JsonValue; references: (RecordReference | string)[]; blobs: BlobReference[];
}
export interface DraftPublication {
  batchId: string; firstOperation: number; lastOperation: number; records: DraftRecord[];
  heads: Record<string, RecordReference | string>; checkpoints?: (RecordReference | string)[];
}
export type StorageRequest =
  | { type: 'open'; location: RepositoryLocation; descriptor: RepositoryDescriptor; workspaceId: string }
  | { type: 'publish'; batch: DraftPublication }
  | { type: 'projection'; reference: RecordReference; generation: number }
  | { type: 'projection-references'; reference: RecordReference }
  | { type: 'record'; reference: RecordReference }
  | { type: 'revision'; revisionId: string }
  | { type: 'query'; options: { parentRevisionId?: string | null; search?: string; cursor?: string; offset?: number; limit: number; direction?: 'asc' | 'desc' } }
  | { type: 'metadata-query'; options: { prefix: string; cursor?: string; offset?: number; limit: number; direction?: 'asc' | 'desc' } }
  | { type: 'metadata'; key: string }
  | { type: 'view-read'; key: string; previous?: boolean }
  | { type: 'view-keys' }
  | { type: 'view-update'; key: string; value: JsonValue }
  | { type: 'view-flush'; views: Record<string, number> }
  | { type: 'hash-source'; blob: Blob }
  | { type: 'index-status' }
  | { type: 'verify-blob'; reference: BlobReference }
  | { type: 'blob-read'; reference: BlobReference; mimeType?: string }
  | { type: 'blob-range'; reference: BlobReference; offset: number; length: number }
  | { type: 'journal-read'; id: string }
  | { type: 'journal-entry'; id: string }
  | { type: 'journal-page'; cursor?: RecordReference | null; limit?: number }
  | { type: 'blob-start'; reference: BlobReference; transferId: string }
  | { type: 'blob-chunk'; transferId: string; offset: number; bytes: Uint8Array }
  | { type: 'blob-finish'; transferId: string }
  | { type: 'blob-abort'; transferId: string }
  | { type: 'close' };
export interface StorageEnvelope { requestId: string; sessionEpoch: string; request: StorageRequest; }
export interface StorageCancel { type: 'cancel'; requestId: string; sessionEpoch: string; }
export interface StorageSuccess { requestId: string; sessionEpoch: string; ok: true; data: unknown; }
export interface StorageFailure { requestId: string; sessionEpoch: string; ok: false; error: { code: RepositoryErrorCode; message: string }; }
export interface NativeCommandRequest { type: 'native-command'; requestId: string; sessionEpoch: string; command: Omit<RepositoryCommand, 'id'>; }
export interface NativeBlobRequest { type: 'native-blob'; requestId: string; sessionEpoch: string; path: string; }
export interface NativeCommandResponse { type: 'native-response'; requestId: string; sessionEpoch: string; data?: OkResponse; error?: string; }
export interface RepositoryOpenProgress { phase: 'opening' | 'source' | 'importing' | 'recovery' | 'projection' | 'activation' | 'ready' | 'failed'; processedRecords?: number; error?: string; }
export interface StorageOpenProgress { type: 'open-progress'; sessionEpoch: string; progress: RepositoryOpenProgress; }
export interface StorageOpenResult {
  ownershipReason?: 'needs-copy-restore' | 'location-registry-unavailable'; writable: boolean; locationId: string; writerEpoch: string | null; recovery: RecoveryResult; }
export type StorageResult = StorageOpenResult | PublicationResult | RepositoryProjection | RepositoryRecord | RevisionMetadata | MetadataPage<RevisionMetadata> | JsonValue | CommitManifest | null | number | void;
