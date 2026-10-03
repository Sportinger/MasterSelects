import { prepareStructuralPublication, type StructuralPointer } from './structuralPublication';
import { ReadonlyWorkspace } from '../persistence/ReadonlyWorkspace';
import { REPOSITORY_LIMITS, RepositoryError } from '../contracts';
import type { EntityDTO, EntityKey, JsonValue, MetadataPage, RecordReference, RepositoryProjection, RepositoryRecord, RevisionMetadata } from '../contracts';
import { canonicalBytes } from '../segments/canonical';
import { StorageWorkerClient } from '../persistence/StorageWorkerClient';
import type { PublicationResult } from '../persistence/RepositoryPersistence';
import type { DraftPublication, DraftRecord, StorageOpenResult } from '../storageWorkerProtocol';
import type { CoordinatorStorage, LogicalRevision, RevisionPublication } from './ProjectTransactionCoordinator';

const json = (value: unknown): JsonValue => value as JsonValue;
const local = (id: string): JsonValue => ({ $record: id });
/** Changeset bytes after which a group commit stops adding revisions. */
const GROUP_DRAFT_BYTES = 2 * 1024 * 1024;
interface RevisionDraftState {
  references: Map<EntityKey, StructuralPointer>;
  groups: Map<string, Set<string>>;
  checkpointCount: number;
  checkpointBytes: number;
}
function noteStructuralKey(groups: Map<string, Set<string>>, key: string): void {
  const root = key.split('/block/')[0];
  let group = groups.get(root); if (!group) { group = new Set(); groups.set(root, group); }
  group.add(key);
}

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
    for (const key of this.currentReferences.keys()) noteStructuralKey(this.structuralGroups, key);
  }
  async publishRevision(revision: LogicalRevision, workspaceId: string, redo: Readonly<Record<string, string>>, sequence: number): Promise<void> {
    await this.publishRevisions([{ revision, redo, sequence }], workspaceId);
  }
  /**
   * Group commit. Publishes a leading run of linearly chained revisions as one
   * publication; every revision keeps its own record, parent link and history
   * step. The batch ends after a revision that writes a checkpoint or when the
   * draft budget is reached. Physical state is updated only after success.
   */
  async publishRevisions(items: readonly RevisionPublication[], workspaceId: string): Promise<number> {
    this.assertOwned();
    const first = items[0];
    if (!first) throw new RepositoryError('corrupt', 'Empty revision publication');
    if (first.revision.parentRevisionId && this.currentRevision !== first.revision.parentRevisionId) await this.bindProjection(first.revision.parentRevisionId);
    const state: RevisionDraftState = {
      references: new Map<EntityKey, StructuralPointer>(this.currentReferences),
      groups: new Map([...this.structuralGroups].map(([root, keys]) => [root, new Set(keys)])),
      checkpointCount: this.checkpointCount, checkpointBytes: this.checkpointBytes,
    };
    const drafted = new Map<string, DraftRecord>();
    const records: DraftRecord[] = [], checkpoints: string[] = [], revisionIds: string[] = [];
    let parent: StructuralPointer | null = first.revision.parentRevisionId ? await this.reference(first.revision.parentRevisionId) : null;
    let bytes = 0;
    for (const [index, item] of items.entries()) {
      if (index && item.revision.parentRevisionId !== items[index - 1]!.revision.revisionId) break;
      if (index && bytes >= GROUP_DRAFT_BYTES) break;
      // The first revision keeps the historical single-revision record ids.
      const prefix = index ? `r${index}-` : '';
      const draft = await this.draftRevision(item.revision, parent, state, prefix, drafted);
      for (const record of draft.records) { records.push(record); drafted.set(record.id, record); }
      bytes += draft.bytes; revisionIds.push(`${prefix}revision`); parent = `${prefix}revision`;
      if (draft.checkpoint) { checkpoints.push(`${prefix}checkpoint`); break; }
    }
    const count = revisionIds.length, last = items[count - 1]!;
    records.push(this.navigationRecord(last.revision.revisionId, revisionIds[count - 1]!, workspaceId, last.redo, last.sequence));
    const result = await this.publish({
      batchId: count === 1 ? first.revision.transactionId : `${first.revision.transactionId}..${last.revision.transactionId}`,
      firstOperation: first.sequence, lastOperation: last.sequence,
      records, heads: { [`navigation:${workspaceId}`]: 'navigation' }, checkpoints });
    const resolve = (pointer: StructuralPointer): RecordReference => typeof pointer === 'string' ? result.records.get(pointer)! : pointer;
    this.currentReferences = new Map([...state.references].map(([key, pointer]) => [key, resolve(pointer)]));
    this.structuralGroups = state.groups;
    for (let index = 0; index < count; index++) this.rememberRevision(items[index]!.revision.revisionId, result.records.get(revisionIds[index]!)!);
    this.currentRevision = last.revision.revisionId;
    this.checkpointCount = state.checkpointCount; this.checkpointBytes = state.checkpointBytes;
    return count;
  }
  /** Drafts one revision on top of `state` and advances it. Ids carry `prefix` so several revisions can share one batch. */
  private async draftRevision(revision: LogicalRevision, parent: StructuralPointer | null, state: RevisionDraftState, prefix: string,
    drafted: ReadonlyMap<string, DraftRecord>): Promise<{ records: DraftRecord[]; checkpoint: boolean; bytes: number }> {
    const read = async (reference: StructuralPointer): Promise<RepositoryRecord> => {
      if (typeof reference !== 'string') return this.client.request({ type: 'record', reference });
      const record = drafted.get(reference);
      if (!record) throw new RepositoryError('corrupt', `Unknown batch-local record ${reference}`);
      // Drafted entity payloads hold {$record} placeholders; expose them as batch-local ids like the pointer map does.
      const payload = record.payload as { references?: unknown[] } | null;
      const references = Array.isArray(payload?.references) ? payload.references.map(item =>
        item && typeof item === 'object' && typeof (item as { $record?: unknown }).$record === 'string' ? (item as { $record: string }).$record : item) : undefined;
      return { kind: record.kind, schemaVersion: record.schemaVersion, payload: references ? { ...payload, references } : record.payload,
        references: [], blobs: record.blobs } as unknown as RepositoryRecord;
    };
    const { records, updates, changes, beforeReferences } = await prepareStructuralPublication(revision.changes, state.references, state.groups, read, prefix);
    const afterPointers = function* (current: ReadonlyMap<EntityKey, StructuralPointer>) {
      for (const [key, reference] of current) if (!updates.has(key)) yield [key, reference] as const;
      for (const [key, reference] of updates) if (reference) yield [key, reference] as const;
    };
    let revisionChanges: JsonValue[] = changes;
    const changeBlocks: string[] = [];
    const entityIds = records.map(record => record.id);
    const changeBytes = canonicalBytes(changes).byteLength;
    if (changeBytes > 256 * 1024) {
      let block: JsonValue[] = []; let blockReferences: Array<RecordReference | string> = []; let blockBytes = 0;
      const flush = () => {
        const id = `${prefix}changeset-${changeBlocks.length}`;
        records.push({ id, kind: 'object', schemaVersion: 1, payload: { type: 'revision-changeset', changes: block }, references: blockReferences, blobs: [] });
        changeBlocks.push(id); block = []; blockReferences = []; blockBytes = 0;
      };
      for (const change of changes) {
        const size = canonicalBytes(change).byteLength;
        if (block.length && blockBytes + size > 256 * 1024) flush();
        block.push(change); blockBytes += size;
        const row = change as { before: RecordReference | { $record: string } | null; after: { $record: string } | null };
        if (row.before) blockReferences.push('$record' in row.before ? row.before.$record : row.before);
        if (row.after) blockReferences.push(row.after.$record);
      }
      if (block.length) flush(); revisionChanges = [];
    }
    const nextCheckpointCount = state.checkpointCount + 1;
    const nextCheckpointBytes = state.checkpointBytes + changeBytes;
    const checkpoint = nextCheckpointCount >= REPOSITORY_LIMITS.checkpointRevisions || nextCheckpointBytes >= REPOSITORY_LIMITS.checkpointChangesetBytes || !parent;
    if (checkpoint) {
      const blockIds: string[] = [];
      let entries: JsonValue[] = []; let references: (RecordReference | string)[] = []; let size = 0;
      const addBlock = () => {
        const id = `${prefix}checkpoint-block-${blockIds.length}`;
        records.push({ id, kind: 'checkpoint', schemaVersion: 1, payload: { entries }, references, blobs: [] });
        blockIds.push(id); entries = []; references = []; size = 0;
      };
      for (const [entityKey, reference] of afterPointers(state.references)) {
        const entry = { entityKey, reference: typeof reference === 'string' ? local(reference) : json(reference) };
        const entrySize = canonicalBytes(entry).byteLength;
        if (entries.length && size + entrySize > 512 * 1024) addBlock();
        entries.push(entry); references.push(reference); size += entrySize;
      }
      if (entries.length) addBlock();
      records.push({ id: `${prefix}checkpoint`, kind: 'checkpoint', schemaVersion: 1,
        payload: { revisionId: revision.revisionId, blocks: blockIds.map(local) }, references: blockIds, blobs: [] });
    }
    records.push({ id: `${prefix}revision`, kind: 'revision', schemaVersion: 1, payload: json({ revisionId: revision.revisionId,
      transactionId: revision.transactionId, parentRevisionId: revision.parentRevisionId,
      parent: typeof parent === 'string' ? local(parent) : parent, label: revision.label,
      source: revision.source, createdAt: revision.createdAt, changes: revisionChanges,
      checkpointDistance: checkpoint ? 0 : nextCheckpointCount,
      checkpointBytes: checkpoint ? 0 : nextCheckpointBytes,
      ...(changeBlocks.length ? { changeBlocks: changeBlocks.map(local) } : {}),
      ...(checkpoint ? { checkpoint: local(`${prefix}checkpoint`) } : {}) }),
      references: [...(checkpoint ? [`${prefix}checkpoint`] : []), ...(parent ? [parent] : []), ...(changeBlocks.length ? changeBlocks : [...beforeReferences, ...entityIds])], blobs: [] });
    for (const [key, pointer] of updates) {
      if (pointer) { state.references.set(key, pointer); noteStructuralKey(state.groups, key); }
      else { state.references.delete(key); const root = key.split('/block/')[0]; state.groups.get(root)?.delete(key); if (!state.groups.get(root)?.size) state.groups.delete(root); }
    }
    state.checkpointCount = checkpoint ? 0 : nextCheckpointCount;
    state.checkpointBytes = checkpoint ? 0 : nextCheckpointBytes;
    return { records, checkpoint, bytes: changeBytes };
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
