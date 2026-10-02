import { discoverLegacyCheckpoints } from '../../src/services/project/repository/persistence/checkpointDiscovery';
import { preparePublication } from '../../src/services/project/repository/persistence/publication';
import { blobPath } from '../../src/services/project/repository/persistence/blobStorage';
import { canonicalBytes, hashBytes } from '../../src/services/project/repository/segments/canonical';
import { WorkerCoordinatorStorage } from '../../src/services/project/repository/transaction/WorkerCoordinatorStorage';
import { draftPublication } from '../../src/services/project/repository/persistence/draftPublication';
import type { StorageWorkerClient } from '../../src/services/project/repository/persistence/StorageWorkerClient';
import type { StorageRequest, StorageOpenResult } from '../../src/services/project/repository/storageWorkerProtocol';
import { materializeEntityReferences } from '../../src/services/project/repository/persistence/projection';
import { readRecord } from '../../src/services/project/repository/segments/recordSegment';
import { REPOSITORY_LIMITS } from '../../src/services/project/repository/contracts';
import { materializeProjection } from '../../src/services/project/repository/persistence/projection';
import { segmentRecords } from '../../src/services/project/repository/segments/recordSegment';
import type { RecordReference } from '../../src/services/project/repository/contracts';
import { WorkspaceViewStore } from '../../src/services/project/repository/workspace/WorkspaceViewStore';
import { describe, it, expect, vi } from 'vitest';
import type { RepositoryBackend, RepositoryDescriptor, RepositoryMetadataIndex, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { RepositoryPersistence, type PublicationBatch } from '../../src/services/project/repository/persistence/RepositoryPersistence';
import { recoverRepository, validateCommit } from '../../src/services/project/repository/persistence/recovery';
import { CommittedMetadataReader } from '../../src/services/project/repository/index/CommittedMetadataReader';
import { commitPath } from '../../src/services/project/repository/persistence/publication';
import { segmentPath } from '../../src/services/project/repository/segments/recordSegment';
const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'fixture', lineageId: 'fixture-lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
const owner: RepositoryOwner = { writerEpoch: 'writer', assertOwned() {}, async release() {} };
function fixture() {
  const files = new Map<string, Uint8Array>(); let failCommit = false; let reads = 0;
  const backend: RepositoryBackend = { locationId: 'fixture', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; }, async stat(path) { const file = files.get(path); return file ? { length: file.length } : null; },
    async read(path, offset = 0, length) { reads++; const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); return { paths: names.slice(0, limit), nextCursor: names.length > limit ? names[limit - 1] : null }; },
    async writeNew(path, chunks) { if (failCommit && path.startsWith('.masterselects/commits/')) { failCommit = false; throw new Error('Disk unavailable'); }
      if (files.has(path)) throw new RepositoryError('conflict', 'Immutable destination'); const parts = []; let length = 0;
      for await (const chunk of chunks) { parts.push(chunk); length += chunk.length; } const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of parts) { bytes.set(chunk, offset); offset += chunk.length; } files.set(path, bytes); },
    async replaceViewSlot() {}, async removeUnpublished(path) { files.delete(path); },
  };
  return { backend, files, failNextCommit() { failCommit = true; }, readCount: () => reads };
}
const initial = (): PublicationBatch => ({ batchId: 'initial', firstOperation: 1, lastOperation: 1, heads: { content: 'root' }, records: [
  { id: 'entity', build: () => ({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value: { persisted: true }, references: [], blobs: [] }, references: [], blobs: [] }) },
  { id: 'root', build: resolve => ({ kind: 'revision', schemaVersion: 1, payload: { revisionId: 'initial', transactionId: 'initial', parent: null, parentRevisionId: null, label: 'Initial', source: 'test', createdAt: 1, changes: [{ entityKey: 'value', before: null, after: resolve('entity') }] } as never, references: [resolve('entity')], blobs: [] }) },
] });
describe('repository authoritative publication and recovery', () => {
  it('reuses completed indexing but still rejects damaged authoritative bytes', async () => {
    const source = fixture();
    const metadata = new Map();
    const index = { getMetadata: vi.fn(async (key: string) => metadata.get(key) ?? null),
      putMetadata: vi.fn(async (key: string, value: unknown) => { metadata.set(key, value); }),
      putRevision: vi.fn(async () => {}), removeMetadata: vi.fn(async (key: string) => { metadata.delete(key); }),
    } as unknown as RepositoryMetadataIndex;
    const first = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'first', index });
    const published = await first.publish(initial());
    vi.mocked(index.putRevision).mockClear(); vi.mocked(index.putMetadata).mockClear();
    const reopened = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'second', index });
    expect((await reopened.recover()).head).toEqual(published.reference);
    expect(index.putRevision).not.toHaveBeenCalled(); expect(index.putMetadata).not.toHaveBeenCalled();
    const path = segmentPath(published.commit.segments[0].segmentId);
    const damaged = source.files.get(path)!.slice(); damaged[damaged.length - 1] ^= 1; source.files.set(path, damaged);
    const corrupted = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'third', index });
    expect((await corrupted.recover()).head).toBeNull();
  });
  it('discovers commit paths once per reopen rather than once per revision', async () => {
    const source = fixture();
    const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'first' });
    await persistence.publish(initial());
    for (let sequence = 2; sequence <= 8; sequence++) await persistence.publish({ batchId: `batch-${sequence}`,
      firstOperation: sequence, lastOperation: sequence, heads: {}, records: [] });
    const list = vi.spyOn(source.backend, 'list');
    expect((await new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'second' }).recover()).operationSequence).toBe(8);
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('retries incomplete indexing on reopen before marking a commit complete', async () => {
    const source = fixture(); const metadata = new Map();
    const index = { getMetadata: vi.fn(async (key: string) => metadata.get(key) ?? null),
      putMetadata: vi.fn(async (key: string, value: unknown) => { metadata.set(key, value); }),
      putRevision: vi.fn().mockRejectedValueOnce(new Error('Index unavailable')).mockResolvedValue(undefined),
      removeMetadata: vi.fn(async (key: string) => { metadata.delete(key); }),
    } as unknown as RepositoryMetadataIndex;
    const published = await new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'first', index }).publish(initial());
    expect(metadata.has(`indexed-commit-v1:${published.commit.commitId}`)).toBe(false);
    const reopened = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'second', index });
    expect((await reopened.recover()).head).toEqual(published.reference);
    expect(index.putRevision).toHaveBeenCalledTimes(2);
    expect(metadata.has(`indexed-commit-v1:${published.commit.commitId}`)).toBe(true);
  });
  it('never exposes failed commits, then retries the exact prepared immutable publication', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'session' });
    const batch = initial(); source.failNextCommit(); await expect(persistence.publish(batch)).rejects.toThrow('Disk unavailable');
    expect((await recoverRepository(source.backend, descriptor)).head).toBeNull();
    const published = await persistence.publish(batch); expect((await recoverRepository(source.backend, descriptor)).head).toEqual(published.reference);
    expect((await persistence.materializeProjection(published.records.get('root')!)).entities.get('value')?.value).toEqual({ persisted: true });
    expect(await persistence.publish(batch)).toEqual(published);
  });
  it('queries committed revisions despite a broken disposable index', async () => {
    const source = fixture(); const failure = vi.fn();
    const index = { putRevision: vi.fn(async () => { throw new Error('Index quota failure'); }) } as unknown as RepositoryMetadataIndex;
    const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'session', index, onIndexError: failure });
    const result = await persistence.publish(initial()); expect(failure).toHaveBeenCalled();
    const reader = new CommittedMetadataReader(source.backend, () => result.reference);
    expect((await reader.queryRevisions({ limit: 64 })).items.map(row => row.revisionId)).toEqual(['initial']);
    expect((await persistence.materializeProjection(result.records.get('root')!)).entities.size).toBe(1);
  });
  it('rejects a commit whose authoritative segment bytes were corrupted', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'session' });
    const result = await persistence.publish(initial()); const path = segmentPath(result.commit.segments[0].segmentId);
    const damaged = source.files.get(path)!.slice(); damaged[damaged.length - 1] ^= 1; source.files.set(path, damaged);
    const recovered = await recoverRepository(source.backend, descriptor);
    expect(recovered.head).toBeNull(); expect(recovered.warnings.some(warning => warning.includes('Incomplete publication'))).toBe(true);
    expect(source.files.has(commitPath(result.commit.commitId))).toBe(true);
  });
  it('validates a long single-batch journal iteratively without repeatedly walking its ancestry', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'session' });
    const count = 4200; const records: PublicationBatch['records'] = Array.from({ length: count }, (_, i) => ({ id: `event-${i}`, build: resolve => {
      const previous = i ? resolve(`event-${i - 1}`) : null;
      return { kind: 'journal', schemaVersion: 1, payload: { id: `event-${i}`, value: i, previous } as never, references: previous ? [previous] : [], blobs: [] };
    } }));
    const result = await persistence.publish({ batchId: 'long-journal', firstOperation: 1, lastOperation: 1, heads: { journal: `event-${count - 1}` }, records });
    const before = source.readCount(); const recovered = await recoverRepository(source.backend, descriptor);
    expect(recovered.head).toEqual(result.reference); expect(source.readCount() - before).toBeLessThan(count * 8);
  }, 30000);
});

describe('workspace confirmation during concurrent updates', () => {
  it('confirms the latest state object and alternates slots after a delayed write', async () => {
    const source = fixture(); let release!: () => void, started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { started = resolve; }); const paths: string[] = [];
    source.backend.replaceViewSlot = async (path, chunks) => {
      paths.push(path); if (paths.length === 1) { started(); await blocked; }
      const parts: Uint8Array[] = []; for await (const bytes of chunks) parts.push(bytes);
      source.files.set(path, parts[0]);
    };
    const views = new WorkspaceViewStore(source.backend, owner, descriptor.repositoryId, 'workspace');
    views.update('zoom', 1); const first = views.flush({ zoom: 1 }); await writing;
    views.update('zoom', 2); const second = views.flush({ zoom: 2 }); release();
    await first; await second; expect(paths.map(path => path.split('/').at(-1))).toEqual(['a.json', 'b.json']);
    const reopened = new WorkspaceViewStore(source.backend, owner, descriptor.repositoryId, 'workspace');
    expect(await reopened.read('zoom')).toBe(2);
    const oldSlot = JSON.parse(new TextDecoder().decode(source.files.get(paths[0])!)); expect(oldSlot.value).toBe(1);
  });
});

describe('physical history reopen beyond the former retention limit', () => {
  it('recovers checkpoint baseline, old and divergent branches with bounded small-edit writes', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'first-open' });
    const stableValue = { untouched: 'x'.repeat(64 * 1024) };
    const baseline = await persistence.publish({ batchId: 'checkpoint-baseline', firstOperation: 1, lastOperation: 1,
      heads: { content: 'root' }, checkpoints: ['checkpoint'], records: [
        { id: 'stable', build: () => ({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value: stableValue, references: [], blobs: [] }, references: [], blobs: [] }) },
        { id: 'value', build: () => ({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value: 0, references: [], blobs: [] }, references: [], blobs: [] }) },
        { id: 'root', build: () => ({ kind: 'revision', schemaVersion: 1, payload: { revisionId: 'baseline', transactionId: 'baseline', parent: null, parentRevisionId: null, label: 'Imported baseline', source: 'import', createdAt: 0, changes: [] }, references: [], blobs: [] }) },
        { id: 'block', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1, payload: { entries: [{ entityKey: 'stable', reference: resolve('stable') }, { entityKey: 'value', reference: resolve('value') }] } as never, references: [resolve('stable'), resolve('value')], blobs: [] }) },
        { id: 'checkpoint', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1, payload: { revisionId: 'baseline', blocks: [resolve('block')] } as never, references: [resolve('block')], blobs: [] }) },
      ] });
    const baselineBytes = new Map([...source.files].map(([path, bytes]) => [path, bytes.slice()]));
    const revisions = [{ id: 'baseline', reference: baseline.records.get('root')!, value: baseline.records.get('value')! }];
    let sequence = 1;
    const publishEdit = async (id: string, parent: typeof revisions[number], value: number) => {
      const operation = ++sequence;
      const result = await persistence.publish({ batchId: id, firstOperation: operation, lastOperation: operation, heads: { content: 'revision' }, records: [
        { id: 'value', build: () => ({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value, references: [], blobs: [] }, references: [], blobs: [] }) },
        { id: 'revision', build: resolve => ({ kind: 'revision', schemaVersion: 1, payload: { revisionId: id, transactionId: id, parent: parent.reference, parentRevisionId: parent.id, label: id, source: 'test', createdAt: operation,
          changes: [{ entityKey: 'value', before: parent.value, after: resolve('value') }] } as never, references: [parent.reference, parent.value, resolve('value')], blobs: [] }) },
      ] });
      const writtenRecords = [];
      for (const segment of result.commit.segments) for await (const entry of segmentRecords(source.backend, segment)) writtenRecords.push(entry.record);
      expect(writtenRecords).toHaveLength(2);
      expect(result.commit.segments.reduce((bytes, segment) => bytes + segment.length, 0)).toBeLessThan(4096);
      return { id, reference: result.records.get('revision')!, value: result.records.get('value')! };
    };
    for (let i = 1; i <= 151; i++) revisions.push(await publishEdit(`main-${i}`, revisions.at(-1)!, i));
    const fork = await publishEdit('fork-from-10', revisions[10], 900);
    const namedOperation = ++sequence;
    await persistence.publish({ batchId: 'named-version', firstOperation: namedOperation, lastOperation: namedOperation, heads: { metadata: 'version' }, records: [
      { id: 'version', build: () => ({ kind: 'metadata', schemaVersion: 1, payload: { key: 'named-version:fork', value: { name: 'Alternate cut', revisionId: fork.id }, revision: fork.reference, previous: null } as never, references: [fork.reference], blobs: [] }) },
    ] });
    const navigationOperation = ++sequence; const main = revisions.at(-1)!;
    await persistence.publish({ batchId: 'navigation', firstOperation: navigationOperation, lastOperation: navigationOperation, heads: { 'navigation:workspace': 'navigation' }, records: [
      { id: 'navigation', build: () => ({ kind: 'navigation', schemaVersion: 1, payload: { workspaceId: 'workspace', sequence: navigationOperation, revisionId: main.id, revision: main.reference, redoPreferences: {} } as never, references: [main.reference], blobs: [] }) },
    ] });
    expect(persistence.confirmedReceipt().operationSequence).toBe(navigationOperation);
    // New persistence instance and authoritative scan: no retained writer maps or source index.
    const reopened = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'reopened' });
    const recovered = await reopened.recover(); expect(recovered.operationSequence).toBe(navigationOperation);
    const reader = new CommittedMetadataReader(source.backend, () => recovered.head);
    expect(await reader.getMetadata('named-version:fork')).toEqual({ name: 'Alternate cut', revisionId: fork.id });
    const history = await reader.queryRevisions({ limit: 64 }); expect(history.totalCount).toBe(153);
    const branches = await reader.queryMetadata({ prefix: 'branch-head:', limit: 64 });
    expect(branches.items.map(row => (row.value as { revisionId: string }).revisionId).toSorted()).toEqual([fork.id, main.id].toSorted());
    for (const [target, expected] of [[revisions[0].reference, 0], [revisions[10].reference, 10], [main.reference, 151], [fork.reference, 900]] as Array<[RecordReference, number]>) {
      const projection = await materializeProjection(source.backend, target, recovered.checkpoints);
      expect(projection.entities.get('value')?.value).toBe(expected); expect(projection.entities.get('stable')?.value).toEqual(stableValue);
    }
    for (const [path, bytes] of baselineBytes) expect(source.files.get(path)).toEqual(bytes);
  }, 120000);
});

describe('checkpoint intervals survive small reopened sessions', () => {
  it('publishes an exact baseline after the persisted distance and retains old branch baselines', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'physical-writer' });
    let recovered = await persistence.recover(); let latest: RecordReference | undefined;
    const emitted: Array<{ sequence: number; checkpoints: RecordReference[] }> = [];
    const client = { errorCode: null, async request<T>(request: StorageRequest): Promise<T> {
      if (request.type === 'record') return await readRecord(source.backend, request.reference) as T;
      if (request.type === 'projection-references') return await materializeEntityReferences(source.backend, request.reference, recovered.checkpoints) as T;
      if (request.type === 'publish') {
        const result = await persistence.publish(draftPublication(request.batch));
        recovered = { ...recovered, head: result.reference, commit: result.commit, operationSequence: result.commit.lastOperation,
          heads: { ...recovered.heads, ...result.commit.heads }, checkpoints: result.commit.checkpoints.length ? result.commit.checkpoints : recovered.checkpoints };
        latest = result.records.get('revision'); emitted.push({ sequence: result.commit.lastOperation, checkpoints: result.commit.checkpoints });
        return result as T;
      }
      throw new Error(`Unexpected checkpoint test request ${request.type}`);
    } } as unknown as StorageWorkerClient;
    const opening = (): StorageOpenResult => ({ writable: true, locationId: source.backend.locationId, writerEpoch: owner.writerEpoch, recovery: recovered });
    const dto = (value: number) => ({ type: 'fixture', schemaVersion: 1, value, references: [], blobs: [] });
    let parent: string | null = null, previous = 0; let oldBranch: RecordReference | undefined;
    for (let i = 0; i <= REPOSITORY_LIMITS.checkpointRevisions; i++) {
      // A fresh physical adapter models repeated short editor sessions; no interval counter is retained in memory.
      const storage = new WorkerCoordinatorStorage(client, opening());
      if (parent) await storage.bindProjection(parent, undefined, latest);
      const id = `session-${i}`;
      await storage.publishRevision({ revisionId: id, transactionId: id, parentRevisionId: parent, label: id, source: 'test', createdAt: i,
        changes: [{ entityKey: 'value', before: parent ? dto(previous) : null, after: dto(i) }] }, 'workspace', {}, i + 1);
      parent = id; previous = i; if (i === 5) oldBranch = latest;
    }
    expect(emitted.filter(item => item.checkpoints.length).map(item => item.sequence)).toEqual([1, REPOSITORY_LIMITS.checkpointRevisions + 1]);
    const fresh = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'fresh-recovery' }); const reopened = await fresh.recover();
    const old = await materializeProjection(source.backend, oldBranch!, reopened.checkpoints);
    expect(old.entities.get('value')?.value).toBe(5);
    const current = await materializeProjection(source.backend, latest!, reopened.checkpoints);
    expect(current.entities.get('value')?.value).toBe(REPOSITORY_LIMITS.checkpointRevisions);
    const checkpointed = await materializeEntityReferences(source.backend, latest!, reopened.checkpoints);
    expect(checkpointed.checkpointDistance).toBe(0); expect(checkpointed.checkpointBytes).toBe(0);
  }, 120000);
});


describe('recovery-scoped immutable caches and proofs', () => {
  it('reads each small immutable file once and hashes a shared large blob once, then detects fresh corruption', async () => {
    const source = fixture();
    const blobBytes = new Uint8Array(1024 * 1024 + 17).fill(37);
    const blob = { hash: await hashBytes(blobBytes), length: blobBytes.length };
    const path = blobPath(blob.hash); source.files.set(path, blobBytes);
    let previousCommit = null as Awaited<ReturnType<typeof preparePublication>>['reference'] | null;
    let previousRecord: RecordReference | null = null;
    const publications: Awaited<ReturnType<typeof preparePublication>>[] = [];
    for (let i = 1; i <= 12; i++) {
      const dependency = previousRecord;
      const publication = await preparePublication({ batchId: `cache-${i}`, firstOperation: i, lastOperation: i, heads: { metadata: 'entry' }, records: [
        { id: 'entry', build: () => ({ kind: 'metadata', schemaVersion: 1, payload: { iteration: i, previous: dependency } as never,
          references: dependency ? [dependency] : [], blobs: [blob] }) },
      ] }, descriptor, owner, previousCommit);
      for (const segment of publication.segments) source.files.set(segmentPath(segment.descriptor.segmentId), segment.bytes);
      source.files.set(commitPath(publication.commit.commitId), publication.bytes);
      publications.push(publication); previousCommit = publication.reference; previousRecord = publication.records.get('entry')!;
    }
    const reads = new Map<string, number>(); const underlyingRead = source.backend.read;
    source.backend.read = async (file, offset, length, signal) => {
      reads.set(file, (reads.get(file) ?? 0) + 1);
      return underlyingRead(file, offset, length, signal);
    };
    const recovered = await recoverRepository(source.backend, descriptor);
    expect(recovered.head).toEqual(previousCommit); expect(recovered.operationSequence).toBe(12);
    // Every new record declares the same source, so this proves cross-commit verification reuse.
    expect(reads.get(path)).toBe(Math.ceil(blobBytes.length / (256 * 1024)));
    for (const publication of publications) {
      expect(reads.get(commitPath(publication.commit.commitId))).toBe(1);
      for (const segment of publication.segments) expect(reads.get(segmentPath(segment.descriptor.segmentId))).toBe(1);
    }
    const damagedBlob = blobBytes.slice(); damagedBlob[0] ^= 1; source.files.set(path, damagedBlob);
    const brokenBlob = await recoverRepository(source.backend, descriptor);
    expect(brokenBlob.head).toBeNull(); expect(brokenBlob.warnings.some(item => item.includes('Incomplete publication'))).toBe(true);
    source.files.set(path, blobBytes);
    const segment = publications[0].segments[0]; const damagedSegment = segment.bytes.slice(); damagedSegment[damagedSegment.length - 1] ^= 1;
    source.files.set(segmentPath(segment.descriptor.segmentId), damagedSegment);
    const brokenSegment = await recoverRepository(source.backend, descriptor);
    expect(brokenSegment.head).toBeNull(); expect(brokenSegment.warnings.some(item => item.includes('Incomplete publication'))).toBe(true);
  });

  it('excludes an orphan checkpoint even when its manifest lists the genuine revision segment', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'checkpoint-owner' });
    const baseline = await persistence.publish(initial()); const target = baseline.records.get('root')!;
    const orphan = await preparePublication({ batchId: 'orphan-checkpoint', firstOperation: 99, lastOperation: 99, heads: { content: target }, checkpoints: ['checkpoint'], records: [
      { id: 'wrong-value', build: () => ({ kind: 'object', schemaVersion: 1,
        payload: { type: 'fixture', schemaVersion: 1, value: { persisted: false }, references: [], blobs: [] }, references: [], blobs: [] }) },
      { id: 'block', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1,
        payload: { entries: [{ entityKey: 'value', reference: resolve('wrong-value') }] } as never, references: [resolve('wrong-value')], blobs: [] }) },
      { id: 'checkpoint', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1,
        payload: { revisionId: 'initial', blocks: [resolve('block')] } as never, references: [resolve('block')], blobs: [] }) },
    ] }, descriptor, owner, baseline.reference);
    // The previous implementation trusted this segment membership without confirmed ancestry.
    orphan.commit.segments.push(baseline.commit.segments[0]);
    for (const segment of orphan.segments) source.files.set(segmentPath(segment.descriptor.segmentId), segment.bytes);
    source.files.set(commitPath(orphan.commit.commitId), canonicalBytes(orphan.commit));
    const recovered = await recoverRepository(source.backend, descriptor);
    expect(recovered.head).toEqual(baseline.reference);
    expect(recovered.warnings.some(item => item.includes('Incomplete publication'))).toBe(true);
    expect((await discoverLegacyCheckpoints(source.backend, new Map([['initial', target]]))).size).toBe(0);
    const projection = await materializeProjection(source.backend, target);
    expect(projection.entities.get('value')?.value).toEqual({ persisted: true });
  });
});


describe('wide imported checkpoint validation', () => {
  it('proves a wide mapping record once rather than rereading and rehashing it for every dependency', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'wide-checkpoint' });
    const count = 1000;
    const records: PublicationBatch['records'] = Array.from({ length: count }, (_, index) => ({ id: `object-${index}`,
      build: () => ({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value: index, references: [], blobs: [] }, references: [], blobs: [] }) }));
    records.push({ id: 'wide-map', build: resolve => {
      const entries = Array.from({ length: count }, (_, index) => ({ entityKey: `entity-${index}-${'x'.repeat(256)}`, reference: resolve(`object-${index}`) }));
      return { kind: 'checkpoint', schemaVersion: 1, payload: { revisionId: 'imported', entries } as never,
        references: entries.map(entry => entry.reference), blobs: [] };
    } });
    const published = await persistence.publish({ batchId: 'wide-map', firstOperation: 1, lastOperation: 1,
      heads: { mapping: 'wide-map' }, checkpoints: ['wide-map'], records });
    const before = source.readCount();
    // The raw backend has no readthrough cache here. Old traversal reread the large parent once per edge.
    await validateCommit(source.backend, published.commit, descriptor);
    expect(source.readCount() - before).toBeLessThanOrEqual(published.commit.segments.length + 4);
    const path = segmentPath(published.commit.segments[0].segmentId);
    const damaged = source.files.get(path)!.slice(); damaged[damaged.length - 1] ^= 1; source.files.set(path, damaged);
    await expect(validateCommit(source.backend, published.commit, descriptor)).rejects.toMatchObject({ code: 'corrupt' });
  }, 30000);
});
