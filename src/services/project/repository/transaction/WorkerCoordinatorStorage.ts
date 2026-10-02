import { prepareStructuralPublication } from './structuralPublication';
import { ReadonlyWorkspace } from '../persistence/ReadonlyWorkspace';
import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';
import type { EntityDTO, EntityKey, JsonValue, MetadataPage, RecordReference, RepositoryProjection, RevisionMetadata } from '../contracts';
import { canonicalBytes } from '../segments/canonical';
import { StorageWorkerClient } from '../persistence/StorageWorkerClient';
import type { PublicationResult } from '../persistence/RepositoryPersistence';
import type { DraftPublication, DraftRecord, StorageOpenResult } from '../storageWorkerProtocol';
import type { CoordinatorStorage, LogicalRevision } from './ProjectTransactionCoordinator';

const json = (value: unknown): JsonValue => value as JsonValue;
const local = (id: string): JsonValue => ({ $record: id });

/** Physical publication adapter. Domain mutations never call filesystem writers. */
export class WorkerCoordinatorStorage implements CoordinatorStorage {
  private currentReferences = new Map<EntityKey, RecordReference>();
  private structuralGroups = new Map<string, Set<string>>();
  private currentRevision: string | null = null;
  private readonly revisionReferences = new Map<string, RecordReference>();
  private readonly heads: Record<string, RecordReference>;
  private checkpointCount = 0;
  private checkpointBytes = 0;
  private owned: boolean;
  private readonly readerWorkspace: ReadonlyWorkspace | null;
  readonly client: StorageWorkerClient;
  constructor(client: StorageWorkerClient, opening: StorageOpenResult) {
    this.client = client;
    this.readerWorkspace = opening.writable ? null : new ReadonlyWorkspace(`${opening.recovery.commit?.repositoryId}:${opening.locationId}:history-reader`);
    this.owned = opening.writable; this.heads = { ...opening.recovery.heads };
  }
  assertOwned(): void {
    if (!this.owned || this.client.errorCode) throw new RepositoryError('ownership', 'Repository writer is unavailable or read-only');
  }
  private rememberRevision(id: string, reference: RecordReference): void {
    this.revisionReferences.delete(id); this.revisionReferences.set(id, reference);
    if (this.revisionReferences.size > 256) this.revisionReferences.delete(this.revisionReferences.keys().next().value!);
  }
  private async reference(revisionId: string): Promise<RecordReference> {
    const cached = this.revisionReferences.get(revisionId);
    if (cached) return cached;
    const metadata = await this.getRevision(revisionId);
    if (!metadata) throw new RepositoryError('corrupt', `Revision ${revisionId} is unavailable`);
    this.rememberRevision(revisionId, metadata.reference); return metadata.reference;
  }
  async getRevision(revisionId: string): Promise<RevisionMetadata | null> {
    const metadata = await this.client.request<RevisionMetadata | null>({ type: 'revision', revisionId });
    if (!metadata) return null;
    const record = await this.client.request<import('../contracts').RepositoryRecord>({ type: 'record', reference: metadata.reference });
    const revision = record.payload as unknown as { revisionId: string; parentRevisionId: string | null };
    if (record.kind !== 'revision' || revision.revisionId !== revisionId || revision.parentRevisionId !== metadata.parentRevisionId)
      throw new RepositoryError('corrupt', 'History index disagrees with authoritative revision');
    return metadata;
  }
  async getRedoChild(revisionId: string, preferred?: string): Promise<string | null> {
    if (preferred && (await this.getRevision(preferred))?.parentRevisionId === revisionId) return preferred;
    const page = await this.client.request<MetadataPage<RevisionMetadata>>({ type: 'query', options: { parentRevisionId: revisionId, direction: 'desc', limit: 1 } });
    return page.items[0]?.revisionId ?? null;
  }
  async loadProjection(revisionId: string, signal: AbortSignal): Promise<ReadonlyMap<EntityKey, EntityDTO>> {
    const projection = await this.client.request<RepositoryProjection>({ type: 'projection', reference: await this.reference(revisionId), generation: 0 }, signal);
    return projection.entities;
  }
  async bindProjection(revisionId: string, signal?: AbortSignal, suppliedReference?: RecordReference): Promise<void> {
    if (suppliedReference) this.rememberRevision(revisionId, suppliedReference);
    const data = await this.client.request<{ revisionId: string; references: Map<EntityKey, RecordReference>; checkpointDistance?: number; checkpointBytes?: number }>({ type: 'projection-references', reference: suppliedReference ?? await this.reference(revisionId) }, signal);
    this.currentRevision = data.revisionId; this.currentReferences = data.references;
    this.checkpointCount = data.checkpointDistance ?? REPOSITORY_LIMITS.checkpointRevisions;
    this.checkpointBytes = data.checkpointBytes ?? REPOSITORY_LIMITS.checkpointChangesetBytes;
    this.structuralGroups.clear();
    for (const key of this.currentReferences.keys()) this.noteStructuralKey(key);
  }
  private noteStructuralKey(key: string): void {
    const root = key.split('/block/')[0];
    let group = this.structuralGroups.get(root); if (!group) { group = new Set(); this.structuralGroups.set(root, group); }
    group.add(key);
  }
  async publishRevision(revision: LogicalRevision, workspaceId: string, redo: Readonly<Record<string, string>>, sequence: number): Promise<void> {
    this.assertOwned();
    if (revision.parentRevisionId && this.currentRevision !== revision.parentRevisionId) await this.bindProjection(revision.parentRevisionId);
    const { records, updates, changes, beforeReferences } = await prepareStructuralPublication(revision.changes,
      this.currentReferences, this.structuralGroups, reference => this.client.request({ type: 'record', reference }));
    const parent = revision.parentRevisionId ? await this.reference(revision.parentRevisionId) : null;
    const afterPointers = function* (current: ReadonlyMap<EntityKey, RecordReference>) {
      for (const [key, reference] of current) if (!updates.has(key)) yield [key, reference] as const;
      for (const [key, reference] of updates) if (reference) yield [key, reference] as const;
    };
    let revisionChanges: JsonValue[] = changes;
    const changeBlocks: string[] = [];
    const entityIds = records.map(record => record.id);
    if (canonicalBytes(changes).byteLength > 256 * 1024) {
      let block: JsonValue[] = []; let blockReferences: Array<RecordReference | string> = []; let blockBytes = 0;
      const flush = () => {
        const id = `changeset-${changeBlocks.length}`;
        records.push({ id, kind: 'object', schemaVersion: 1, payload: { type: 'revision-changeset', changes: block }, references: blockReferences, blobs: [] });
        changeBlocks.push(id); block = []; blockReferences = []; blockBytes = 0;
      };
      for (const change of changes) {
        const bytes = canonicalBytes(change).byteLength;
        if (block.length && blockBytes + bytes > 256 * 1024) flush();
        block.push(change); blockBytes += bytes;
        const row = change as { before: RecordReference | null; after: { $record: string } | null };
        if (row.before) blockReferences.push(row.before);
        if (row.after) blockReferences.push(row.after.$record);
      }
      if (block.length) flush(); revisionChanges = [];
    }
    const nextCheckpointCount = this.checkpointCount + 1;
    const nextCheckpointBytes = this.checkpointBytes + canonicalBytes(changes).byteLength;
    const checkpoints: string[] = [];
    if (nextCheckpointCount >= REPOSITORY_LIMITS.checkpointRevisions || nextCheckpointBytes >= REPOSITORY_LIMITS.checkpointChangesetBytes || !parent) {
      const blockIds: string[] = [];
      let entries: JsonValue[] = []; let references: (RecordReference | string)[] = []; let bytes = 0;
      const addBlock = () => {
        const id = `checkpoint-block-${blockIds.length}`;
        records.push({ id, kind: 'checkpoint', schemaVersion: 1, payload: { entries }, references, blobs: [] });
        blockIds.push(id); entries = []; references = []; bytes = 0;
      };
      for (const [entityKey, reference] of afterPointers(this.currentReferences)) {
        const entry = { entityKey, reference: typeof reference === 'string' ? local(reference) : json(reference) };
        const size = canonicalBytes(entry).byteLength;
        if (entries.length && bytes + size > 512 * 1024) addBlock();
        entries.push(entry); references.push(reference); bytes += size;
      }
      if (entries.length) addBlock();
      records.push({ id: 'checkpoint', kind: 'checkpoint', schemaVersion: 1,
        payload: { revisionId: revision.revisionId, blocks: blockIds.map(local) }, references: blockIds, blobs: [] });
      checkpoints.push('checkpoint');
    }
    records.push({ id: 'revision', kind: 'revision', schemaVersion: 1, payload: json({ revisionId: revision.revisionId,
      transactionId: revision.transactionId, parentRevisionId: revision.parentRevisionId, parent, label: revision.label,
      source: revision.source, createdAt: revision.createdAt, changes: revisionChanges,
      checkpointDistance: checkpoints.length ? 0 : nextCheckpointCount,
      checkpointBytes: checkpoints.length ? 0 : nextCheckpointBytes,
      ...(changeBlocks.length ? { changeBlocks: changeBlocks.map(local) } : {}),
      ...(checkpoints.length ? { checkpoint: local('checkpoint') } : {}) }),
      references: [...(checkpoints.length ? ['checkpoint'] : []), ...(parent ? [parent] : []), ...(changeBlocks.length ? changeBlocks : [...beforeReferences, ...entityIds])], blobs: [] });
    records.push(this.navigationRecord(revision.revisionId, 'revision', workspaceId, redo, sequence));
    const result = await this.publish({ batchId: revision.transactionId, firstOperation: sequence, lastOperation: sequence,
      records, heads: { [`navigation:${workspaceId}`]: 'navigation' }, checkpoints });
    for (const [key, pointer] of updates) {
      if (pointer) { this.currentReferences.set(key, typeof pointer === 'string' ? result.records.get(pointer)! : pointer); this.noteStructuralKey(key); }
      else { this.currentReferences.delete(key); const root = key.split('/block/')[0]; this.structuralGroups.get(root)?.delete(key); if (!this.structuralGroups.get(root)?.size) this.structuralGroups.delete(root); }
    }
    this.currentRevision = revision.revisionId;
    this.rememberRevision(revision.revisionId, result.records.get('revision')!);
    this.checkpointCount = checkpoints.length ? 0 : nextCheckpointCount;
    this.checkpointBytes = checkpoints.length ? 0 : nextCheckpointBytes;
  }
  private navigationRecord(revisionId: string, reference: string | RecordReference, workspaceId: string,
    redo: Readonly<Record<string, string>>, sequence: number): DraftRecord {
    return { id: 'navigation', kind: 'navigation', schemaVersion: 1,
      payload: json({ workspaceId, sequence, revisionId, revision: typeof reference === 'string' ? local(reference) : reference, redoPreferences: redo }), references: [reference], blobs: [] };
  }
  readReaderNavigation(workspaceId: string): JsonValue | null { return this.readerWorkspace?.read(`navigation:${workspaceId}`) ?? null; }
  async publishNavigation(revisionId: string, workspaceId: string, redo: Readonly<Record<string, string>>, sequence: number): Promise<void> {
    if (this.readerWorkspace) {
      await this.bindProjection(revisionId);
      this.readerWorkspace.write(`navigation:${workspaceId}`, { revisionId, redoPreferences: { ...redo }, sequence });
      return;
    }
    const reference = await this.reference(revisionId);
    await this.publish({ batchId: `navigation-${workspaceId}-${sequence}`, firstOperation: sequence, lastOperation: sequence,
      records: [this.navigationRecord(revisionId, reference, workspaceId, redo, sequence)], heads: { [`navigation:${workspaceId}`]: 'navigation' } });
    await this.bindProjection(revisionId);
  }
  async publishMetadata(key: string, value: JsonValue, sequence: number, dependencies: { references?: RecordReference[]; blobs?: import('../contracts').BlobReference[] } = {}): Promise<void> {
    const revisionId = value && typeof value === 'object' && !Array.isArray(value) && typeof value.revisionId === 'string' ? value.revisionId : null;
    const reference = revisionId ? await this.reference(revisionId) : null;
    const previous = this.heads.metadata;
    const references = [...(reference ? [reference] : []), ...(previous ? [previous] : []), ...(dependencies.references ?? [])];
    await this.publish({ batchId: `metadata-${sequence}`, firstOperation: sequence, lastOperation: sequence,
      records: [{ id: 'metadata', kind: 'metadata', schemaVersion: 1, payload: json({ key, value, revision: reference, previous: previous ?? null }), references, blobs: dependencies.blobs ?? [] }], heads: { metadata: 'metadata' } });
  }
  async publishJournal(id: string, value: JsonValue, sequence: number, dependencies: { references?: RecordReference[]; blobs?: import('../contracts').BlobReference[] } = {}): Promise<void> {
    const previous = this.heads.journal;
    const records: DraftRecord[] = [];
    let storedValue = value;
    const references: Array<RecordReference | string> = [...(previous ? [previous] : []), ...(dependencies.references ?? [])];
    if (value && typeof value === 'object' && !Array.isArray(value) && value.type === 'artifact-manifest' && value.manifest) {
      // This standalone dependency deliberately has no conversation/journal ancestry.
      records.push({ id: 'manifest', kind: 'metadata', schemaVersion: 1,
        payload: { type: 'artifact-manifest', manifest: value.manifest }, references: dependencies.references ?? [], blobs: dependencies.blobs ?? [] });
      storedValue = { ...value, manifestReference: local('manifest') };
      references.push('manifest');
    }
    records.push({ id: 'journal', kind: 'journal', schemaVersion: 1,
      payload: json({ id, value: storedValue, previous: previous ?? null }), references, blobs: dependencies.blobs ?? [] });
    await this.publish({ batchId: `journal-${sequence}-${id}`, firstOperation: sequence, lastOperation: sequence,
      records, heads: { journal: 'journal' } });
  }
  private async publish(batch: DraftPublication): Promise<PublicationResult> {
    this.assertOwned();
    const result = await this.client.request<PublicationResult>({ type: 'publish', batch });
    Object.assign(this.heads, result.commit.heads); return result;
  }
  flushViews(views: Readonly<Record<string, number>>): Promise<void> { if (this.readerWorkspace) return Promise.resolve(); return this.client.request({ type: 'view-flush', views: { ...views } }); }
  async close(): Promise<void> { await this.client.close(); this.owned = false; }
}
