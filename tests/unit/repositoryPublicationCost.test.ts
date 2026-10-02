import { describe, it, expect } from 'vitest';
import type { RecordReference, RepositoryBackend, RepositoryDescriptor, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { RepositoryPersistence } from '../../src/services/project/repository/persistence/RepositoryPersistence';
import { recoverRepository } from '../../src/services/project/repository/persistence/recovery';

const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'cost', lineageId: 'cost-lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
const owner: RepositoryOwner = { writerEpoch: 'writer', assertOwned() {}, async release() {} };
function fixture() {
  const files = new Map<string, Uint8Array>(); let reads = 0;
  const backend: RepositoryBackend = { locationId: 'cost', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; }, async stat(path) { const file = files.get(path); return file ? { length: file.length } : null; },
    async read(path, offset = 0, length) { reads++; const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); return { paths: names.slice(0, limit), nextCursor: names.length > limit ? names[limit - 1] : null }; },
    async writeNew(path, chunks) {
      if (files.has(path)) throw new RepositoryError('conflict', 'Immutable destination'); const parts: Uint8Array[] = []; let length = 0;
      for await (const chunk of chunks) { parts.push(chunk); length += chunk.length; } const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of parts) { bytes.set(chunk, offset); offset += chunk.length; } files.set(path, bytes);
    },
    async replaceViewSlot() {}, async removeUnpublished(path) { files.delete(path); },
  };
  return { backend, files, reads: () => reads };
}

describe('publication cost after importing a wide project', () => {
  it('keeps per-save reads independent of imported width and of history length', async () => {
    const source = fixture(); const persistence = new RepositoryPersistence(source.backend, descriptor, owner, { sessionEpoch: 'session' });
    const width = 300;
    const baseline = await persistence.publish({ batchId: 'import', firstOperation: 1, lastOperation: 1, heads: { content: 'root' }, checkpoints: ['checkpoint'], records: [
      ...Array.from({ length: width }, (_, index) => ({ id: `entity-${index}`, build: () => ({ kind: 'object' as const, schemaVersion: 1 as const,
        payload: { type: 'fixture', schemaVersion: 1, value: { index, text: 'x'.repeat(256) }, references: [], blobs: [] }, references: [], blobs: [] }) })),
      { id: 'root', build: () => ({ kind: 'revision', schemaVersion: 1, payload: { revisionId: 'import', transactionId: 'import', parent: null, parentRevisionId: null, label: 'Imported', source: 'import', createdAt: 0, changes: [] }, references: [], blobs: [] }) },
      { id: 'block', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1, payload: { entries: Array.from({ length: width }, (_, index) => ({ entityKey: `e${index}`, reference: resolve(`entity-${index}`) })) } as never,
        references: Array.from({ length: width }, (_, index) => resolve(`entity-${index}`)), blobs: [] }) },
      { id: 'checkpoint', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1, payload: { revisionId: 'import', blocks: [resolve('block')] } as never, references: [resolve('block')], blobs: [] }) },
    ] });
    const entities: RecordReference[] = Array.from({ length: width }, (_, index) => baseline.records.get(`entity-${index}`)!);
    let parent = { id: 'import', reference: baseline.records.get('root')! };
    const costs: number[] = [];
    for (let operation = 2; operation <= 41; operation++) {
      const before = source.reads(); const id = `edit-${operation}`; const previous = parent;
      // Every edit writes a fresh checkpoint over all imported entities, like periodic editor checkpoints.
      const result = await persistence.publish({ batchId: id, firstOperation: operation, lastOperation: operation, heads: { content: 'revision' }, checkpoints: ['checkpoint'], records: [
        { id: 'value', build: () => ({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value: operation, references: [], blobs: [] }, references: [], blobs: [] }) },
        { id: 'revision', build: resolve => ({ kind: 'revision', schemaVersion: 1, payload: { revisionId: id, transactionId: id, parent: previous.reference, parentRevisionId: previous.id, label: id, source: 'test', createdAt: operation,
          changes: [{ entityKey: 'value', before: null, after: resolve('value') }] } as never, references: [previous.reference, resolve('value')], blobs: [] }) },
        { id: 'block', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1, payload: { entries: [...entities.map((reference, index) => ({ entityKey: `e${index}`, reference })), { entityKey: 'value', reference: resolve('value') }] } as never,
          references: [...entities, resolve('value')], blobs: [] }) },
        { id: 'checkpoint', build: resolve => ({ kind: 'checkpoint', schemaVersion: 1, payload: { revisionId: id, blocks: [resolve('block')] } as never, references: [resolve('block')], blobs: [] }) },
      ] });
      costs.push(source.reads() - before);
      parent = { id, reference: result.records.get('revision')! };
    }
    // Before: each save re-read every referenced imported record and every commit manifest.
    expect(Math.max(...costs)).toBeLessThan(40);
    expect(costs.at(-1)!).toBeLessThanOrEqual(costs[4] + 2);
    // A fresh session still validates everything from disk.
    expect((await recoverRepository(source.backend, descriptor)).operationSequence).toBe(41);
  });
});
