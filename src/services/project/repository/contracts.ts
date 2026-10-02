/** Repository v1: authoritative records are immutable; the index is disposable. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EntityKey = string;
export type ContentHash = string;
export interface RepositoryDescriptor {
  format: 'masterselects-repository';
  formatVersion: 1;
  repositoryId: string;
  lineageId: string;
  requiredReaderCapabilities: string[];
  requiredWriterCapabilities: string[];
}
export interface RecordReference {
  hash: ContentHash;
  segmentId: string;
  offset: number;
  length: number;
}
export interface BlobReference { hash: ContentHash; length: number; }
export interface RepositoryRecord {
  kind: 'object' | 'revision' | 'checkpoint' | 'metadata' | 'navigation' | 'journal';
  schemaVersion: 1;
  payload: JsonValue;
  references: RecordReference[];
  blobs: BlobReference[];
}
export interface EntityChange {
  entityKey: EntityKey;
  before: RecordReference | null;
  after: RecordReference | null;
}
export interface RevisionPayload {
  revisionId: string;
  transactionId: string;
  parent: RecordReference | null;
  parentRevisionId: string | null;
  label: string;
  source: string;
  createdAt: number;
  changes: EntityChange[];
  /** Bounded immutable changeset records; legacy small revisions retain inline changes. */
  changeBlocks?: RecordReference[];
  /** Exact immutable baseline for this revision, independent of other branches. */
  checkpoint?: RecordReference;
  /** Persisted distance prevents reopen from restarting checkpoint intervals. */
  checkpointDistance?: number;
  checkpointBytes?: number;
}
export interface NavigationPayload {
  workspaceId: string;
  sequence: number;
  revisionId: string;
  revision: RecordReference;
  redoPreferences: Record<string, string>;
}
export interface SegmentDescriptor { segmentId: string; hash: ContentHash; length: number; }
export interface CommitReference { commitId: string; hash: ContentHash; }
export interface CommitManifest {
  format: 'masterselects-commit';
  schemaVersion: 1;
  repositoryId: string;
  commitId: string;
  batchId: string;
  previous: CommitReference | null;
  writerEpoch: string;
  firstOperation: number;
  lastOperation: number;
  segments: SegmentDescriptor[];
  heads: Record<string, RecordReference>;
  checkpoints: RecordReference[];
}
export interface OperationReceipt {
  repositoryId: string;
  sessionEpoch: string;
  operationSequence: number;
  views: Record<string, number>;
}
export type RepositoryErrorCode = 'permission' | 'quota' | 'ownership' | 'conflict' | 'corrupt' | 'unsupported' | 'budget' | 'cancelled' | 'io';
export class RepositoryError extends Error {
  public readonly code: RepositoryErrorCode;
  constructor(code: RepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options); this.code = code; this.name = 'RepositoryError';
  }
}
export interface RepositoryCapabilities {
  rangeReads: boolean;
  immutableWrites: boolean;
  replaceViewSlots: boolean;
  ownership: boolean;
  durability: 'stream-close' | 'fsync';
}
export interface RepositoryOwner {
  readonly writerEpoch: string;
  assertOwned(): void | Promise<void>;
  release(): Promise<void>;
}
export interface RepositoryBackend {
  readonly locationId: string;
  readonly capabilities: RepositoryCapabilities;
  acquireOwner(repositoryId: string, signal?: AbortSignal): Promise<RepositoryOwner | null>;
  list(prefix: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<{ paths: string[]; nextCursor: string | null }>;
  read(path: string, offset?: number, length?: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Browser-managed File/Blob without assembling a whole-file JS buffer. */
  readBlob?(path: string, signal?: AbortSignal): Promise<Blob | null>;
  stat(path: string): Promise<{ length: number } | null>;
  writeNew(path: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void>;
  replaceViewSlot(path: string, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<void>;
  removeUnpublished(path: string): Promise<void>;
  /** Native adds an OS-lease/expected-head barrier to the browser owner. */
  publishCommit?(path: string, bytes: Uint8Array, expectedPrevious: CommitReference | null, owner: RepositoryOwner, signal?: AbortSignal): Promise<void>;
}
export interface RevisionMetadata {
  revisionId: string;
  parentRevisionId: string | null;
  reference: RecordReference;
  label: string;
  source: string;
  createdAt: number;
  operationSequence: number;
  changedEntities: EntityKey[];
}
export interface MetadataPage<T> { items: T[]; nextCursor: string | null; offset?: number; totalCount?: number; }
export interface RepositoryMetadataIndex {
  putRevision(revision: RevisionMetadata): Promise<void>;
  getRevision(revisionId: string): Promise<RevisionMetadata | null>;
  queryRevisions(options: { parentRevisionId?: string | null; search?: string; cursor?: string; offset?: number; limit: number; direction?: 'asc' | 'desc' }): Promise<MetadataPage<RevisionMetadata>>;
  queryMetadata(options: { prefix: string; cursor?: string; offset?: number; limit: number; direction?: 'asc' | 'desc' }): Promise<MetadataPage<{ key: string; value: JsonValue }>>;
  putMetadata(key: string, value: JsonValue): Promise<void>;
  removeMetadata(key: string): Promise<void>;
  getMetadata(key: string): Promise<JsonValue | null>;
  clear(): Promise<void>;
  close(): void;
}
export interface EntityDTO { type: string; schemaVersion: number; value: JsonValue; references: RecordReference[]; blobs: BlobReference[]; }
export interface DomainCodec<T> {
  readonly domain: string;
  readonly schemaVersion: number;
  encode(value: T): EntityDTO;
  decode(entity: EntityDTO): T;
}
export interface RepositoryProjection {
  revisionId: string | null;
  generation: number;
  entities: ReadonlyMap<EntityKey, EntityDTO>;
}
export type CheckoutResult = { status: 'applied' | 'pending' | 'cancelled' | 'failed'; revisionId: string; error?: string };
export const REPOSITORY_LIMITS = {
  segmentBytes: 4 * 1024 * 1024,
  queueBytes: 32 * 1024 * 1024,
  recordBytes: 1024 * 1024,
  batchDelayMs: 250,
  checkpointRevisions: 128,
  checkpointChangesetBytes: 4 * 1024 * 1024,
  readPageSize: 128,
  objectCacheBytes: 16 * 1024 * 1024,
} as const;
