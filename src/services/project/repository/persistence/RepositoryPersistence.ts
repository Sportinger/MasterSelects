import { iterateRevisionChanges } from './revisionChanges';
import { REPOSITORY_LIMITS, RepositoryError, type BlobReference, type CommitReference, type OperationReceipt, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryMetadataIndex, type RepositoryOwner, type RevisionPayload } from '../contracts';
import { canonicalBytes, frozenJson, hashRecord, hashBytes } from '../segments/canonical';
import { readRecord, segmentRecords } from '../segments/recordSegment';
import { commitPath, preparePublication, readCommit, writePublication, type PreparedPublication, type PublicationBatch, type PublicationResult } from './publication';
import { createRecoveryProofs, recoverRepository, type RecoveryResult } from './recovery';
import { materializeProjection, readRevision } from './projection';
import { storeBlob } from './blobStorage';

export type { PublicationBatch, PublicationResult, PublicationPointer } from './publication';
export type { RecoveryResult } from './recovery';
export { checkpointRecords } from './projection';
export interface PersistenceOptions { sessionEpoch: string; index?: RepositoryMetadataIndex; onIndexError?: (error: unknown) => void; onIndexProgress?: () => void; }
interface QueuedPublication { batch: PublicationBatch; bytes: number; }

export class RepositoryPersistence {
  readonly backend: RepositoryBackend;
  readonly descriptor: RepositoryDescriptor;
  readonly owner: RepositoryOwner;
  private readonly options: PersistenceOptions;
  private head: CommitReference | null = null;
  private confirmedRecovery: RecoveryResult | undefined;
  private operationSequence = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private queuedBytes = 0;
  private pending: PreparedPublication | null = null;
  private recovered = false;
  private checkpoints: RecordReference[] = [];
  private readonly completed = new Map<string, PublicationResult>();
  private fatalError: unknown = null;
  // This writer owns the location: validated immutable history is proven once per session.
  private readonly proofs = createRecoveryProofs();
  constructor(backend: RepositoryBackend, descriptor: RepositoryDescriptor, owner: RepositoryOwner, options: PersistenceOptions) {
    this.backend = backend; this.descriptor = frozenJson(descriptor); this.owner = owner; this.options = options;
    if (!backend.capabilities.immutableWrites || !backend.capabilities.ownership) throw new RepositoryError('unsupported', 'Backend cannot safely publish repository commits');
  }
  async recover(signal?: AbortSignal): Promise<RecoveryResult> {
    const result = await recoverRepository(this.backend, this.descriptor, signal, async commit => {
      await this.indexCommit(commit);
    }, undefined, this.proofs);
    this.confirmedRecovery = result;
    this.head = result.head; this.operationSequence = result.operationSequence; this.checkpoints = result.checkpoints;
    this.recovered = true; return result;
  }
  readRecord(reference: RecordReference, signal?: AbortSignal) { return readRecord(this.backend, reference, signal); }
  readRevision(reference: RecordReference, signal?: AbortSignal) { return readRevision(this.backend, reference, signal); }
  materializeProjection(reference: RecordReference, generation = 0, signal?: AbortSignal) { return materializeProjection(this.backend, reference, this.checkpoints, generation, signal); }
  storeBlob(reference: BlobReference, chunks: AsyncIterable<Uint8Array>, signal?: AbortSignal) { return storeBlob(this.backend, this.owner, reference, chunks, signal); }
  confirmedReceipt(): OperationReceipt { return { repositoryId: this.descriptor.repositoryId, sessionEpoch: this.options.sessionEpoch, operationSequence: this.operationSequence, views: {} }; }
  publish(batch: PublicationBatch, signal?: AbortSignal): Promise<PublicationResult> { return this.enqueue(batch, signal); }
  enqueue(batch: PublicationBatch, signal?: AbortSignal): Promise<PublicationResult> {
    // Execute builders synchronously at enqueue time: later editor mutations cannot change queued data.
    const localRefs = new Map<string, RecordReference>();
    const frozenRecords = batch.records.map(item => {
      if (localRefs.has(item.id)) throw new RepositoryError('corrupt', 'Duplicate batch record ID');
      const record = frozenJson(item.build(id => {
        if (!localRefs.has(id)) throw new RepositoryError('corrupt', 'Batch records must be topologically ordered');
        return localRefs.get(id)!;
      }));
      const marker: RecordReference = { hash: `sha256:${'0'.repeat(64)}`, segmentId: `local_${localRefs.size}`, offset: 14, length: 1 };
      localRefs.set(item.id, marker);
      return { id: item.id, record };
    });
    const bytes = frozenRecords.reduce((size, item) => size + canonicalBytes(item.record).length, 0);
    if (this.queuedBytes + bytes > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Repository write queue is full; flush before further edits');
    // Substitute only direct reference structures, never arbitrary logical strings.
    const replace = (value: unknown, resolve: (id: string) => RecordReference): unknown => {
      if (Array.isArray(value)) return value.map(item => replace(item, resolve));
      if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        if (Object.keys(object).length === 4 && typeof object.segmentId === 'string' && object.segmentId.startsWith('local_') && object.hash === `sha256:${'0'.repeat(64)}`) {
          const id = [...localRefs].find(([, ref]) => ref.segmentId === object.segmentId)?.[0];
          if (!id) throw new RepositoryError('corrupt', 'Invalid local reference');
          return resolve(id);
        }
        return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, replace(item, resolve)]));
      }
      return value;
    };
    const queued: QueuedPublication = { bytes, batch: { ...batch, heads: frozenJson(batch.heads), checkpoints: frozenJson(batch.checkpoints ?? []), records: frozenRecords.map(item => ({ id: item.id, build: resolve => replace(item.record, resolve) as ReturnType<PublicationBatch['records'][number]['build']> })) } };
    this.queuedBytes += bytes;
    const run = this.tail.then(() => this.publishQueued(queued.batch, signal));
    this.tail = run.catch(error => { this.fatalError = error; }).finally(() => { this.queuedBytes -= bytes; });
    return run;
  }
  private async publishQueued(batch: PublicationBatch, signal?: AbortSignal): Promise<PublicationResult> {
    const complete = this.completed.get(batch.batchId); if (complete) return complete;
    if (this.fatalError && !this.pending) throw this.fatalError;
    if (!this.recovered) await this.recover(signal);
    await this.owner.assertOwned();
    if (this.pending && this.pending.commit.batchId !== batch.batchId) throw new RepositoryError('io', 'Previous publication needs retry before later operations');
    if (!this.pending) {
      const actual = await recoverRepository(this.backend, this.descriptor, signal, undefined, this.confirmedRecovery, this.proofs);
      if (actual.head?.hash !== this.head?.hash || actual.head?.commitId !== this.head?.commitId) throw new RepositoryError('conflict', 'Repository head changed outside this writer');
      if (batch.lastOperation <= this.operationSequence) {
        const retry = await this.findPublishedBatch(batch, signal);
        if (retry) return retry;
        throw new RepositoryError('conflict', 'Already confirmed operation range has different batch identity');
      }
      if (batch.firstOperation !== this.operationSequence + 1) throw new RepositoryError('corrupt', 'Publication operation gap');
      this.pending = await preparePublication(batch, this.descriptor, this.owner, this.head);
    }
    const publication = this.pending;
    await writePublication(this.backend, this.owner, publication, signal, this.proofs);
    // Re-discover after publication: a cross-origin writer must never remain hidden by our cache.
    const actual = await recoverRepository(this.backend, this.descriptor, signal, undefined, this.confirmedRecovery, this.proofs);
    if (actual.head?.hash !== publication.reference.hash) throw new RepositoryError('conflict', 'Publication did not become the unique repository head');
    this.confirmedRecovery = actual;
    this.head = publication.reference; this.operationSequence = publication.commit.lastOperation;
    if (publication.commit.checkpoints.length) this.checkpoints = publication.commit.checkpoints;
    this.pending = null; this.fatalError = null;
    const result: PublicationResult = { commit: publication.commit, reference: publication.reference, records: publication.records };
    this.completed.set(batch.batchId, result);
    if (this.completed.size > 128) this.completed.delete(this.completed.keys().next().value!);
    await this.indexCommit(publication.commit);
    return result;
  }
  async flush(receipt: OperationReceipt): Promise<void> {
    if (receipt.repositoryId !== this.descriptor.repositoryId || receipt.sessionEpoch !== this.options.sessionEpoch) throw new RepositoryError('ownership', 'Flush receipt belongs to another repository session');
    await this.tail;
    if (this.operationSequence < receipt.operationSequence) throw this.fatalError ?? new RepositoryError('io', 'Requested operations are not confirmed');
    if (Object.keys(receipt.views).length) throw new RepositoryError('unsupported', 'View receipt must be flushed by the workspace writer');
  }
  private async indexCommit(commit: PublicationResult['commit']): Promise<void> {
    const index = this.options.index; if (!index) return;
    try {
      const commitHash = await hashBytes(canonicalBytes(commit));
      const markerKey = `indexed-commit-v1:${commit.commitId}`;
      const marker = await index.getMetadata?.(markerKey);
      if (marker && typeof marker === 'object' && !Array.isArray(marker)
        && marker.hash === commitHash && marker.operationSequence === commit.lastOperation) return;
      for (const segment of commit.segments) for await (const entry of segmentRecords(this.backend, segment)) {
        this.options.onIndexProgress?.();
        if (entry.record.kind === 'revision') {
          const data = entry.record.payload as unknown as RevisionPayload;
          const changedEntities: string[] = [];
          for await (const change of iterateRevisionChanges(this.backend, data)) changedEntities.push(change.entityKey);
          await index.putRevision({ revisionId: data.revisionId, parentRevisionId: data.parentRevisionId, reference: entry.reference, label: data.label, source: data.source, createdAt: data.createdAt, operationSequence: commit.lastOperation, changedEntities });
          await index.putMetadata(`revision-publication:${data.revisionId}`, { commitId: commit.commitId, hash: commitHash, operationSequence: commit.lastOperation });
          if (data.parentRevisionId) await index.removeMetadata(`branch-head:${data.parentRevisionId}`);
          await index.putMetadata(`branch-head:${data.revisionId}`, { revisionId: data.revisionId, parentRevisionId: data.parentRevisionId, label: data.label, createdAt: data.createdAt });
        } else if (entry.record.kind === 'metadata' || entry.record.kind === 'journal' || entry.record.kind === 'navigation' || entry.record.kind === 'checkpoint') {
          await index.putMetadata(`${entry.record.kind}:${entry.reference.hash}`, entry.record.payload);
          const payload = entry.record.payload;
          if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            if (entry.record.kind === 'metadata' && typeof payload.key === 'string' && payload.value !== undefined) await index.putMetadata(payload.key, payload.value);
            if (entry.record.kind === 'journal' && typeof payload.id === 'string') await index.putMetadata(`journal-id:${payload.id}`, entry.record.payload);
          }
        }
      }
      // Write last: an interrupted/failed index build is replayed, never mistaken for complete.
      await index.putMetadata(markerKey, { hash: commitHash, operationSequence: commit.lastOperation });
    } catch (error) { try { this.options.onIndexError?.(error); } catch { /* Reporting cannot revoke durability. */ } }
  }
  private async findPublishedBatch(batch: PublicationBatch, signal?: AbortSignal): Promise<PublicationResult | null> {
    let cursor = this.head;
    while (cursor) {
      const item = await readCommit(this.backend, commitPath(cursor.commitId), signal);
      if (item.reference.hash !== cursor.hash) throw new RepositoryError('corrupt', 'Confirmed retry ancestry damaged');
      cursor = item.commit.previous;
      if (item.commit.batchId !== batch.batchId) continue;
      if (item.commit.firstOperation !== batch.firstOperation || item.commit.lastOperation !== batch.lastOperation) throw new RepositoryError('conflict', 'Batch ID reused with a different operation range');
      const records = new Map<string, RecordReference>(); let position = 0;
      for (const segment of item.commit.segments) for await (const entry of segmentRecords(this.backend, segment, signal)) {
        const expected = batch.records[position++];
        if (!expected) throw new RepositoryError('conflict', 'Retried batch has fewer records');
        const record = expected.build(id => {
          const reference = records.get(id);
          if (!reference) throw new RepositoryError('corrupt', 'Unresolved retried batch dependency');
          return reference;
        });
        if (await hashRecord(record) !== entry.reference.hash) throw new RepositoryError('conflict', 'Retried batch has different canonical data');
        records.set(expected.id, entry.reference);
      }
      if (position !== batch.records.length) throw new RepositoryError('conflict', 'Retried batch has additional records');
      return { ...item, records };
    }
    return null;
  }
}
