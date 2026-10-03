import { describe, expect, it, vi } from 'vitest';
import { RepositoryError, type EntityDTO, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner, type RevisionMetadata } from '../../src/services/project/repository/contracts';
import { RepositoryPersistence } from '../../src/services/project/repository/persistence/RepositoryPersistence';
import { draftPublication } from '../../src/services/project/repository/persistence/draftPublication';
import { materializeEntityReferences, materializeProjection } from '../../src/services/project/repository/persistence/projection';
import type { StorageWorkerClient } from '../../src/services/project/repository/persistence/StorageWorkerClient';
import { readRecord } from '../../src/services/project/repository/segments/recordSegment';
import type { StorageOpenResult, StorageRequest } from '../../src/services/project/repository/storageWorkerProtocol';
import { ProjectTransactionCoordinator, type CoordinatorStorage, type LogicalRevision, type RevisionPublication } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import { WorkerCoordinatorStorage } from '../../src/services/project/repository/transaction/WorkerCoordinatorStorage';

const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'group', lineageId: 'group-lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
const owner: RepositoryOwner = { writerEpoch: 'writer', assertOwned() {}, async release() {} };
const dto = (value: unknown): EntityDTO => ({ type: 'fixture', schemaVersion: 1, value: value as never, references: [], blobs: [] });
const root = dto({ child: { $repositoryEntity: 'agg/block/a' } });

function memoryBackend(): RepositoryBackend {
  const files = new Map<string, Uint8Array>();
  return { locationId: 'group', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; }, async stat(path) { const file = files.get(path); return file ? { length: file.length } : null; },
    async read(path, offset = 0, length) { const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); return { paths: names.slice(0, limit), nextCursor: names.length > limit ? names[limit - 1] : null }; },
    async writeNew(path, chunks) { if (files.has(path)) throw new RepositoryError('conflict', 'Immutable destination'); const parts: Uint8Array[] = []; let length = 0;
      for await (const chunk of chunks) { parts.push(chunk); length += chunk.length; } const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of parts) { bytes.set(chunk, offset); offset += chunk.length; } files.set(path, bytes); },
    async replaceViewSlot() {}, async removeUnpublished() {},
  };
}

function revision(id: string, parent: string | null, changes: LogicalRevision['changes']): LogicalRevision {
  return { revisionId: id, transactionId: `tx-${id}`, parentRevisionId: parent, label: id, source: 'test', createdAt: 0, changes };
}

describe('repository group commit', () => {
  it('publishes a backlog of revisions as one commit while every revision stays its own history step', async () => {
    const backend = memoryBackend();
    const persistence = new RepositoryPersistence(backend, descriptor, owner, { sessionEpoch: 'group-writer' });
    let recovered = await persistence.recover();
    const commits: Array<{ first: number; last: number; revisions: Map<string, RecordReference> }> = [];
    const client = { errorCode: null, async request<T>(request: StorageRequest): Promise<T> {
      if (request.type === 'record') return await readRecord(backend, request.reference) as T;
      if (request.type === 'projection-references') return await materializeEntityReferences(backend, request.reference, recovered.checkpoints) as T;
      if (request.type === 'publish') {
        const result = await persistence.publish(draftPublication(request.batch));
        recovered = { ...recovered, head: result.reference, commit: result.commit, operationSequence: result.commit.lastOperation,
          heads: { ...recovered.heads, ...result.commit.heads }, checkpoints: result.commit.checkpoints.length ? result.commit.checkpoints : recovered.checkpoints };
        commits.push({ first: result.commit.firstOperation, last: result.commit.lastOperation,
          revisions: new Map([...result.records].filter(([id]) => id.endsWith('revision'))) });
        return result as T;
      }
      throw new Error(`Unexpected request ${request.type}`);
    } } as unknown as StorageWorkerClient;
    const opening = (): StorageOpenResult => ({ writable: true, locationId: backend.locationId, writerEpoch: owner.writerEpoch, recovery: recovered });
    const storage = new WorkerCoordinatorStorage(client, opening());

    await storage.publishRevision(revision('r0', null, [
      { entityKey: 'value', before: null, after: dto(0) },
      { entityKey: 'agg', before: null, after: root },
      { entityKey: 'agg/block/a', before: null, after: dto(0) },
    ]), 'workspace', {}, 1);
    // Revision 2 re-reads the aggregate root that revision 1 drafted inside the same batch.
    const items: RevisionPublication[] = [
      { revision: revision('r1', 'r0', [{ entityKey: 'value', before: dto(0), after: dto(1) }, { entityKey: 'agg/block/a', before: dto(0), after: dto(1) }]), redo: {}, sequence: 2 },
      { revision: revision('r2', 'r1', [{ entityKey: 'value', before: dto(1), after: dto(2) }, { entityKey: 'agg/block/a', before: dto(1), after: dto(2) }]), redo: {}, sequence: 3 },
      { revision: revision('r3', 'r2', [{ entityKey: 'value', before: dto(2), after: dto(3) }]), redo: {}, sequence: 4 },
    ];
    expect(await storage.publishRevisions(items, 'workspace')).toBe(3);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toMatchObject({ first: 2, last: 4 });
    expect([...commits[1]!.revisions.keys()].toSorted()).toEqual(['r1-revision', 'r2-revision', 'revision']);

    // A later single revision builds on the group-committed state.
    await storage.publishRevision(revision('r4', 'r3', [{ entityKey: 'agg/block/a', before: dto(2), after: dto(4) }]), 'workspace', {}, 5);

    const reopened = await new RepositoryPersistence(backend, descriptor, owner, { sessionEpoch: 'fresh' }).recover();
    expect(reopened.operationSequence).toBe(5);
    const at = async (reference: RecordReference) => {
      const projection = await materializeProjection(backend, reference, reopened.checkpoints);
      return [projection.entities.get('value')?.value, projection.entities.get('agg/block/a')?.value, projection.entities.get('agg')?.value];
    };
    const group = commits[1]!.revisions;
    expect(await at(group.get('revision')!)).toEqual([1, 1, root.value]);
    expect(await at(group.get('r1-revision')!)).toEqual([2, 2, root.value]);
    expect(await at(group.get('r2-revision')!)).toEqual([3, 2, root.value]);
    expect(await at(commits[2]!.revisions.get('revision')!)).toEqual([3, 4, root.value]);
  }, 60000);
});

describe('coordinator group commit', () => {
  function fixture() {
    const published: string[][] = [];
    const storage: CoordinatorStorage = {
      publishRevision: vi.fn(async (item: LogicalRevision) => { published.push([item.revisionId]); }),
      publishRevisions: vi.fn(async (items: readonly RevisionPublication[]) => { published.push(items.map(item => item.revision.revisionId)); return items.length; }),
      publishNavigation: vi.fn(async () => {}), publishMetadata: vi.fn(async () => {}), publishJournal: vi.fn(async () => {}),
      loadProjection: vi.fn(async () => new Map()), getRevision: vi.fn(async (): Promise<RevisionMetadata | null> => null),
      getRedoChild: vi.fn(async () => null), flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
    };
    const coordinator = new ProjectTransactionCoordinator('repo', 'workspace', storage, { canActivate: () => true, activate: async () => {} });
    const edit = (value: number) => { const token = coordinator.begin('Edit'); coordinator.write(token, 'value', dto(value)); return coordinator.commit(token); };
    return { coordinator, storage, edit, published };
  }

  it('bundles revisions that queued behind a slow publication', async () => {
    const { coordinator, storage, edit, published } = fixture();
    let release!: () => void; const blocked = new Promise<void>(done => { release = done; });
    const base = storage.publishRevision;
    storage.publishRevision = vi.fn(async (...args: Parameters<CoordinatorStorage['publishRevision']>) => { await blocked; await base(...args); });
    const first = edit(1); await new Promise(done => setTimeout(done, 0));
    edit(2); edit(3); const last = edit(4);
    release(); await coordinator.flush(last.receipt);
    expect(published).toEqual([[first.revisionId], expect.any(Array)]);
    expect(published[1]).toHaveLength(3);
    expect(coordinator.getStatus()).toMatchObject({ confirmedSequence: 4, queuedBytes: 0, oldestPendingAt: null });
  });

  it('retries a failed group as the identical group', async () => {
    const { coordinator, storage, edit, published } = fixture();
    let release!: () => void; const blocked = new Promise<void>(done => { release = done; });
    const base = storage.publishRevision, baseGroup = storage.publishRevisions!;
    storage.publishRevision = vi.fn(async (...args: Parameters<CoordinatorStorage['publishRevision']>) => { await blocked; await base(...args); });
    let failures = 1;
    storage.publishRevisions = vi.fn(async (items: readonly RevisionPublication[], workspaceId: string) => {
      if (failures-- > 0) throw new Error('Lost acknowledgement');
      return baseGroup(items, workspaceId);
    });
    edit(1); await new Promise(done => setTimeout(done, 0));
    edit(2); const last = edit(3);
    release(); await expect(coordinator.flush(last.receipt)).rejects.toThrow();
    await coordinator.retry(); await coordinator.flush(last.receipt);
    const calls = vi.mocked(storage.publishRevisions!).mock.calls.map(([items]) => items.map(item => item.sequence));
    expect(calls).toEqual([[2, 3], [2, 3]]);
    expect(published.at(-1)).toHaveLength(2);
    expect(coordinator.getStatus().confirmedSequence).toBe(3);
  });

  it('confirms only what the storage took and groups the rest later', async () => {
    const { coordinator, storage, edit, published } = fixture();
    let release!: () => void; const blocked = new Promise<void>(done => { release = done; });
    const base = storage.publishRevision;
    storage.publishRevision = vi.fn(async (...args: Parameters<CoordinatorStorage['publishRevision']>) => { await blocked; await base(...args); });
    storage.publishRevisions = vi.fn(async (items: readonly RevisionPublication[]) => { published.push(items.slice(0, 2).map(item => item.revision.revisionId)); return Math.min(2, items.length); });
    edit(1); await new Promise(done => setTimeout(done, 0));
    edit(2); edit(3); edit(4); edit(5); const last = edit(6);
    release(); await coordinator.flush(last.receipt);
    expect(published.map(group => group.length)).toEqual([1, 2, 2, 1]);
    expect(coordinator.getStatus().confirmedSequence).toBe(6);
  });
});
