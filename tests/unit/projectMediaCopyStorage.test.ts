// @vitest-environment node
// The storage side of a media copy into the project (phone import measured 8.2 s for 30 MB before):
// the file is read in 4 MB slices without one whole-file buffer, hashed once, written once and confirmed
// by its stored length instead of being read back; a media copy written in this session is not re-hashed
// by every later check (other artifacts are), but a missing or truncated one still fails.
import { describe, expect, it, vi } from 'vitest';
import { RepositoryError, type BlobReference, type RepositoryBackend, type RepositoryOwner } from '../../src/services/project/repository/contracts';
import { BLOB_FILE_CHUNK_BYTES, MAX_CONCURRENT_FILE_JOBS, createFileJobLimiter, hashBlobContent, readBlobChunks, throttleBlobReadProgress } from '../../src/services/project/repository/persistence/blobFileSource';
import { blobPath, storeBlob, verifyBlob } from '../../src/services/project/repository/persistence/blobStorage';
import { createSessionBlobVerification } from '../../src/services/project/repository/persistence/sessionBlobVerification';
import { hashBytes } from '../../src/services/project/repository/segments/canonical';
import { ArtifactStore } from '../../src/artifacts/ArtifactStore';
import { MemoryArtifactStorageAdapter } from '../../src/artifacts/memoryStorageAdapter';
import { WorkerRepositoryArtifactAdapter } from '../../src/services/project/repository/artifacts/WorkerRepositoryArtifactStore';
import type { ArtifactManifest } from '../../src/artifacts/types';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

const owner: RepositoryOwner = { writerEpoch: 'test-owner', assertOwned() {}, async release() {} };

function memory() {
  const files = new Map<string, Uint8Array>();
  const reads: string[] = [];
  const writeCalls: number[] = [];
  const backend: RepositoryBackend = {
    locationId: 'memory',
    capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async list() { return { paths: [], nextCursor: null }; },
    async read(path, offset = 0, length) {
      reads.push(path);
      const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing test file');
      return bytes.slice(offset, length === undefined ? undefined : offset + length);
    },
    async stat(path) { return files.has(path) ? { length: files.get(path)!.length } : null; },
    async writeNew(path, chunks) {
      const parts: Uint8Array[] = []; let size = 0;
      for await (const part of chunks) { parts.push(part.slice()); size += part.length; writeCalls.push(part.length); }
      const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
      files.set(path, result);
    },
    async replaceViewSlot() {},
    async removeUnpublished(path) { files.delete(path); },
  };
  return { backend, files, reads, writeCalls };
}

/** A file whose whole-buffer read is forbidden: only bounded slices may be read. */
class SliceOnlyBlob extends Blob {
  async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file read forbidden'); }
}

function bytesOf(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 997) bytes[index] = index % 251;
  return bytes;
}

describe('media copy into project storage', () => {
  it('reads a file in 4 MB slices without ever asking for the whole buffer', async () => {
    const size = BLOB_FILE_CHUNK_BYTES * 2 + 123;
    const blob = new SliceOnlyBlob([bytesOf(size)]);
    const sizes: number[] = [];
    for await (const chunk of readBlobChunks(blob)) sizes.push(chunk.byteLength);
    expect(sizes).toEqual([BLOB_FILE_CHUNK_BYTES, BLOB_FILE_CHUNK_BYTES, 123]);
  });

  it('reports the bytes read after each slice of the hash and the write, so a long copy can show progress', async () => {
    const size = BLOB_FILE_CHUNK_BYTES * 2 + 123;
    const written: number[] = [];
    for await (const chunk of readBlobChunks(new SliceOnlyBlob([bytesOf(size)]), undefined, BLOB_FILE_CHUNK_BYTES, bytes => written.push(bytes))) void chunk;
    expect(written).toEqual([BLOB_FILE_CHUNK_BYTES, BLOB_FILE_CHUNK_BYTES * 2, size]);
    const streamed: number[] = [];
    await hashBlobContent(new SliceOnlyBlob([bytesOf(size)]), undefined, 1024, bytes => streamed.push(bytes));
    expect(streamed.at(-1)).toBe(size);
    const native: number[] = [];
    await hashBlobContent(new Blob([bytesOf(1000)]), undefined, undefined, bytes => native.push(bytes));
    expect(native).toEqual([1000]);
  });

  it('sends read progress at most once per interval', () => {
    let time = 0;
    const sent: number[] = [];
    const report = throttleBlobReadProgress(bytes => sent.push(bytes), 250, () => time);
    report(1); time = 100; report(2); time = 260; report(3); time = 400; report(4); time = 520; report(5);
    expect(sent).toEqual([1, 3, 5]);
  });

  it('hashes large files by streaming slices and agrees with the native hash', async () => {
    const bytes = bytesOf(BLOB_FILE_CHUNK_BYTES + 4097);
    const native = await hashBlobContent(new Blob([bytes]));
    // Forcing the streaming path (limit below the size) on a blob that forbids whole reads.
    const streamed = await hashBlobContent(new SliceOnlyBlob([bytes]), undefined, 1024);
    expect(streamed).toBe(native);
    expect(native).toBe(await hashBytes(bytes));
  });

  it('stores a file once in 4 MB writes and confirms it by length, without reading it back', async () => {
    const { backend, files, reads, writeCalls } = memory();
    const bytes = bytesOf(BLOB_FILE_CHUNK_BYTES + 10);
    const reference: BlobReference = { hash: await hashBytes(bytes), length: bytes.length };

    await storeBlob(backend, owner, reference, readBlobChunks(new Blob([bytes])), undefined, { verifyWritten: 'length' });

    expect(files.get(blobPath(reference.hash))).toEqual(bytes);
    expect(writeCalls).toEqual([BLOB_FILE_CHUNK_BYTES, 10]);
    expect(reads, 'no read-back of the bytes just written').toEqual([]);
  });

  it('keeps the full read-back for callers that do not opt out', async () => {
    const { backend, reads } = memory();
    const bytes = bytesOf(5000);
    const reference: BlobReference = { hash: await hashBytes(bytes), length: bytes.length };
    await storeBlob(backend, owner, reference, readBlobChunks(new Blob([bytes])));
    expect(reads.length).toBeGreaterThan(0);
  });

  it('rejects a file whose bytes do not match the declared identity before anything is stored', async () => {
    const { backend, files } = memory();
    const bytes = bytesOf(5000);
    const reference: BlobReference = { hash: await hashBytes(bytes), length: bytes.length };
    const changed = bytes.slice(); changed[0] ^= 0xff;
    await expect(storeBlob(backend, owner, reference, readBlobChunks(new Blob([changed])), undefined, { verifyWritten: 'length' }))
      .rejects.toMatchObject({ code: 'corrupt' });
    expect(files.size).toBe(0);
  });

  it('verifies every blob it did not write as a media copy fully on every check (no trust for other artifacts)', async () => {
    const { backend, files, reads } = memory();
    const bytes = bytesOf(3000);
    const reference: BlobReference = { hash: await hashBytes(bytes), length: bytes.length };
    files.set(blobPath(reference.hash), bytes);
    const session = createSessionBlobVerification(verifyBlob);

    await session.verify(backend, reference);
    const fullReads = reads.length;
    expect(fullReads).toBeGreaterThan(0);
    await session.verify(backend, reference);
    expect(reads.length, 'a second check reads and hashes the bytes again').toBe(2 * fullReads);
    expect(session.isProven(reference, backend)).toBe(false);

    files.set(blobPath(reference.hash), bytes.map(value => value ^ 1));
    await expect(session.verify(backend, reference)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('a remembered media copy is only checked for presence and length, and a missing or truncated one still fails', async () => {
    const { backend, files, reads } = memory();
    const bytes = bytesOf(3000);
    const reference: BlobReference = { hash: await hashBytes(bytes), length: bytes.length };
    files.set(blobPath(reference.hash), bytes);
    const session = createSessionBlobVerification(verifyBlob);
    session.remember(backend, reference);

    await session.verify(backend, reference);
    await session.verify(backend, reference);
    expect(reads, 'later checks do not re-read the bytes').toEqual([]);

    files.set(blobPath(reference.hash), bytes.slice(0, 100));
    await expect(session.verify(backend, reference)).rejects.toMatchObject({ code: 'corrupt' });
    files.delete(blobPath(reference.hash));
    await expect(session.verify(backend, reference)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('trusts a blob this session wrote without hashing it again, but not on another backend', async () => {
    const first = memory(); const second = memory();
    const bytes = bytesOf(2000);
    const reference: BlobReference = { hash: await hashBytes(bytes), length: bytes.length };
    first.files.set(blobPath(reference.hash), bytes); second.files.set(blobPath(reference.hash), bytes.map(value => value ^ 1));
    const session = createSessionBlobVerification(verifyBlob);
    session.remember(first.backend, reference);

    await session.verify(first.backend, reference);
    expect(first.reads).toEqual([]);
    await expect(session.verify(second.backend, reference)).rejects.toMatchObject({ code: 'corrupt' });
    expect(session.isProven(reference, second.backend)).toBe(false);
  });

  it('confirms only project media copies by length; every other artifact write is read back', async () => {
    const storeBlobFile = vi.fn(async () => {});
    const adapter = new WorkerRepositoryArtifactAdapter({ client: { storeBlobFile } } as unknown as RepositorySession);
    vi.spyOn(adapter, 'saveArtifactManifest').mockResolvedValue();
    const manifest = { hash: 'a'.repeat(64), size: 3, manifestHash: 'b'.repeat(64) } as ArtifactManifest;
    const blob = new Blob(['abc']);

    await adapter.writeArtifact(manifest, blob);
    await adapter.writeArtifact(manifest, blob, undefined, { writeConfirmation: 'length' });
    expect(storeBlobFile.mock.calls.map(call => (call as unknown[])[3])).toEqual(['read-back', 'length']);

    // ArtifactStore hands the caller's choice to the adapter (the Raw media copy asks for 'length').
    const memoryAdapter = new MemoryArtifactStorageAdapter();
    const write = vi.spyOn(memoryAdapter, 'writeArtifact');
    const store = new ArtifactStore(memoryAdapter);
    await store.putArtifact(new Blob(['one']));
    await store.putArtifact(new Blob(['two']), { writeConfirmation: 'length' });
    expect(write.mock.calls.map(call => (call as unknown[])[3])).toEqual([{ writeConfirmation: undefined }, { writeConfirmation: 'length' }]);
  });

  it('runs at most two whole-file jobs at once; the rest wait in order and an aborted waiter leaves the queue', async () => {
    expect(MAX_CONCURRENT_FILE_JOBS).toBe(2);
    const limiter = createFileJobLimiter();
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const job = (name: string) => () => new Promise<string>(resolve => { started.push(name); gates.set(name, () => resolve(name)); });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const a = limiter.run(job('a')), b = limiter.run(job('b'));
    const controller = new AbortController();
    const c = limiter.run(job('c'), controller.signal), d = limiter.run(job('d'));
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(limiter.load).toEqual({ active: 2, waiting: 2 });
    controller.abort();
    await expect(c).rejects.toMatchObject({ code: 'cancelled' });
    gates.get('a')!();
    await expect(a).resolves.toBe('a');
    await tick();
    expect(started).toEqual(['a', 'b', 'd']);
    gates.get('b')!(); gates.get('d')!();
    await Promise.all([b, d]);
    expect(limiter.load).toEqual({ active: 0, waiting: 0 });
  });
});
