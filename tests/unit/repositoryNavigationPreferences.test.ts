import { describe, expect, it, vi } from 'vitest';
import { REPOSITORY_LIMITS, RepositoryError, type NavigationPayload, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner, type RepositoryRecord } from '../../src/services/project/repository/contracts';
import { RepositoryPersistence } from '../../src/services/project/repository/persistence/RepositoryPersistence';
import { draftPublication } from '../../src/services/project/repository/persistence/draftPublication';
import { draftNavigationRecords, readNavigationPreferences } from '../../src/services/project/repository/persistence/navigationPreferences';
import { canonicalBytes } from '../../src/services/project/repository/segments/canonical';
import { readRecord, segmentRecords } from '../../src/services/project/repository/segments/recordSegment';
import { materializeEntityReferences, materializeProjection } from '../../src/services/project/repository/persistence/projection';
import { WorkerCoordinatorStorage } from '../../src/services/project/repository/transaction/WorkerCoordinatorStorage';
import { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import { ProjectTransactionCoordinator } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { StorageOpenResult, StorageRequest } from '../../src/services/project/repository/storageWorkerProtocol';
import type { StorageWorkerClient } from '../../src/services/project/repository/persistence/StorageWorkerClient';

const worker = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/services/project/repository/persistence/StorageWorkerClient', () => ({
  StorageWorkerClient: class { constructor() { return worker.client; } },
}));
const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'nav', lineageId: 'nav', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
const owner: RepositoryOwner = { writerEpoch: 'writer', assertOwned() {}, async release() {} };

async function fixture() {
  const files = new Map<string, Uint8Array>();
  const backend: RepositoryBackend = {
    locationId: 'nav', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async stat(path) { const file = files.get(path); return file ? { length: file.length } : null; },
    async read(path, offset = 0, length) { const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); return { paths: names.slice(0, limit), nextCursor: names.length > limit ? names[limit - 1] : null }; },
    async writeNew(path, chunks) {
      if (files.has(path)) throw new RepositoryError('conflict', 'Immutable destination');
      const parts: Uint8Array[] = []; let size = 0;
      for await (const part of chunks) { parts.push(part); size += part.length; }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      files.set(path, bytes);
    },
    async replaceViewSlot() {}, async removeUnpublished() {},
  };
  let persistence = new RepositoryPersistence(backend, descriptor, owner, { sessionEpoch: 'first' });
  let recovery = await persistence.recover();
  const opening = (): StorageOpenResult => ({ writable: true, locationId: 'nav', writerEpoch: owner.writerEpoch, recovery });
  const client = { errorCode: null, close: vi.fn(async () => {}), async request(request: StorageRequest) {
    if (request.type === 'open') return opening();
    if (request.type === 'view-flush') return;
    if (request.type === 'record') return readRecord(backend, request.reference);
    if (request.type === 'projection') return materializeProjection(backend, request.reference, recovery.checkpoints);
    if (request.type === 'projection-references') return materializeEntityReferences(backend, request.reference, recovery.checkpoints);
    if (request.type === 'publish') {
      const result = await persistence.publish(draftPublication(request.batch));
      recovery = await persistence.recover(); return result;
    }
    throw new Error(`Unexpected request ${request.type}`);
  } } as unknown as StorageWorkerClient;
  worker.client = client;
  return { backend, client, opening, async reopen() {
    persistence = new RepositoryPersistence(backend, descriptor, owner, { sessionEpoch: crypto.randomUUID() });
    recovery = await persistence.recover(); return recovery;
  } };
}

describe('bounded navigation preferences', () => {
  it('saves more than 1 MiB of branch choices, reopens them intact, and saves again after history navigation', async () => {
    const f = await fixture(), storage = new WorkerCoordinatorStorage(f.client, f.opening());
    const redo = Object.fromEntries(Array.from({ length: 14000 }, (_, i) => [`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, crypto.randomUUID()]));
    expect(canonicalBytes(redo).length).toBeGreaterThan(REPOSITORY_LIMITS.recordBytes);
    await storage.publishRevision({ revisionId: 'r0', transactionId: 'tx0', parentRevisionId: null, label: 'Initial', source: 'test', createdAt: 0,
      changes: [{ entityKey: 'value', before: null, after: { type: 'fixture', schemaVersion: 1, value: 'kept', references: [], blobs: [] } }] }, 'workspace', redo, 1);
    const recovered = await f.reopen();
    expect(recovered.warnings).toEqual([]);
    const nav = await readRecord(f.backend, recovered.heads['navigation:workspace']);
    const data = nav.payload as unknown as NavigationPayload;
    expect(data.redoPreferenceBlocks!.length).toBeGreaterThan(1);
    expect(await readNavigationPreferences(data, ref => readRecord(f.backend, ref))).toEqual(redo);
    for (const segment of recovered.commit!.segments) for await (const entry of segmentRecords(f.backend, segment))
      expect(entry.reference.length).toBeLessThanOrEqual(REPOSITORY_LIMITS.recordBytes);

    // Check the actual session restore path, not only the format decoder.
    const restored = vi.spyOn(ProjectTransactionCoordinator.prototype, 'restore');
    const session = await RepositorySession.open({ descriptor, workspaceId: 'workspace', location: { kind: 'opfs', directoryName: 'nav' } as never,
      activation: { canActivate: () => true, activate: async () => {} } });
    expect(session.coordinator.getProjection().entities.get('value')?.value).toBe('kept');
    expect(restored.mock.calls.at(-1)?.[2]).toEqual(redo);
    restored.mockRestore();
    await session.storage.publishNavigation('r0', 'workspace', { ...redo, extra: 'new-child' }, 2);
    const next = await f.reopen();
    expect(next.operationSequence).toBe(2);
    const nextNav = await readRecord(f.backend, next.heads['navigation:workspace']);
    expect(await readNavigationPreferences(nextNav.payload as unknown as NavigationPayload, ref => readRecord(f.backend, ref)))
      .toEqual({ ...redo, extra: 'new-child' });
    await session.close();
  }, 60000);

  it('keeps small legacy cursors inline and preserves escaped, Unicode and special property names', async () => {
    const redo = Object.fromEntries([['a', 'b'], ['雪\\"', 'é'], ['__proto__', 'constructor']]);
    const records = draftNavigationRecords('r', 'revision', 'workspace', redo, 1);
    expect(records).toHaveLength(1);
    const read = vi.fn();
    expect(await readNavigationPreferences(records[0].payload as unknown as NavigationPayload, read)).toEqual(redo);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects malformed or conflicting block data instead of losing branch choices silently', async () => {
    const reference: RecordReference = { hash: `sha256:${'a'.repeat(64)}`, segmentId: 'block', offset: 14, length: 200 };
    const nav = { redoPreferences: { a: 'b' }, redoPreferenceBlocks: [reference] } as NavigationPayload;
    const block = (payload: unknown): RepositoryRecord => ({ kind: 'object', schemaVersion: 1, payload: payload as never, references: [], blobs: [] });
    await expect(readNavigationPreferences(nav, async () => block({ type: 'wrong', redoPreferences: {} }))).rejects.toThrow('Invalid navigation preference block');
    await expect(readNavigationPreferences(nav, async () => block({ type: 'navigation-redo-preferences', redoPreferences: { a: 'c' } }))).rejects.toThrow('conflicting');
    await expect(readNavigationPreferences(nav, async () => block({ type: 'navigation-redo-preferences', redoPreferences: { x: 12 } }))).rejects.toThrow('Invalid');
  });
});
