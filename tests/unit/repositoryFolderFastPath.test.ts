import { afterEach, describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { directoryBackend } from '../../src/services/project/repository/backends/directoryBackend';
import { WorkspaceViewStore } from '../../src/services/project/repository/workspace/WorkspaceViewStore';
import type { RepositoryOwner } from '../../src/services/project/repository/contracts';

// Folder projects on Android are SAF document providers: every handle call is a 20-100+ ms round trip.
// These cover the folder fast path (directoryFileCache.ts): what it may skip, and what it must still catch.

afterEach(() => vi.unstubAllGlobals());

type Calls = Record<string, number>;
function memoryFolder(calls: Calls, options: { truncateWrites?: boolean } = {}) {
  const count = (kind: string) => { calls[kind] = (calls[kind] ?? 0) + 1; };
  const notFound = () => new DOMException('Missing', 'NotFoundError');
  function folder(): FileSystemDirectoryHandle {
    const folders = new Map<string, FileSystemDirectoryHandle>();
    const files = new Map<string, Uint8Array>();
    const fileHandle = (name: string) => ({
      kind: 'file', name,
      async getFile() { count('getFile'); if (!files.has(name)) throw notFound(); return new File([files.get(name)!], name); },
      async createWritable() {
        count('createWritable'); const parts: number[] = [];
        return {
          async write(chunk: Uint8Array) { count('write'); parts.push(...chunk); },
          async close() { count('close'); files.set(name, Uint8Array.from(options.truncateWrites ? parts.slice(0, -1) : parts)); },
          async abort() {},
        };
      },
    });
    return {
      kind: 'directory',
      async getDirectoryHandle(name: string, create?: { create?: boolean }) {
        count('getDirectoryHandle');
        let child = folders.get(name);
        if (!child) { if (!create?.create) throw notFound(); child = folder(); folders.set(name, child); }
        return child;
      },
      async getFileHandle(name: string, create?: { create?: boolean }) {
        count('getFileHandle');
        if (!files.has(name)) { if (!create?.create) throw notFound(); files.set(name, new Uint8Array()); }
        return fileHandle(name);
      },
      async removeEntry(name: string) { files.delete(name); },
      async *entries() { count('entries'); for (const [name, handle] of folders) yield [name, handle]; for (const name of files.keys()) yield [name, fileHandle(name)]; },
    } as unknown as FileSystemDirectoryHandle;
  }
  return folder();
}
async function writable(options: { truncateWrites?: boolean } = {}, calls: Calls = {}, root = memoryFolder(calls, options)) {
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
  const backend = directoryBackend(root, 'fast-path');
  const owner = (await backend.acquireOwner('repository'))!;
  return { backend, owner, calls, root, reset: () => { for (const key of Object.keys(calls)) delete calls[key]; } };
}
const chunks = (bytes: Uint8Array) => (async function* () { yield bytes; })();
const total = (calls: Calls) => Object.values(calls).reduce((sum, value) => sum + value, 0);

describe('folder backend fast path', () => {
  it('writes an immutable file with one size check and serves the read-back from the verified bytes', async () => {
    const { backend, calls, reset } = await writable();
    await backend.list('.masterselects/segments/');
    reset();
    const path = '.masterselects/segments/s1.msseg';
    await backend.writeNew(path, chunks(new Uint8Array([1, 2, 3])));
    // Lookup + create, size probe, stream, close, completion size check. No read-back, no stats.
    expect(calls).toMatchObject({ getFileHandle: 1, getFile: 2, createWritable: 1, write: 1, close: 1 });
    reset();
    expect([...await backend.read(path, 1, 2)]).toEqual([2, 3]);
    expect(await backend.stat(path)).toMatchObject({ length: 3 });
    expect(total(calls)).toBe(0);
    // Immutability still holds: the file exists, so a second write is refused.
    await expect(backend.writeNew(path, chunks(new Uint8Array([9])))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reports a write the provider stored with a different length instead of confirming it', async () => {
    const { backend } = await writable({ truncateWrites: true });
    await expect(backend.writeNew('.masterselects/segments/s2.msseg', chunks(new Uint8Array([1, 2, 3]))))
      .rejects.toMatchObject({ code: 'corrupt', message: expect.stringContaining('Write did not complete') });
  });

  it('skips the size probe only for a commit the head check listing proved absent', async () => {
    const { backend, owner, calls, reset } = await writable();
    await backend.writeNew('.masterselects/segments/s.msseg', chunks(new Uint8Array([1])));
    reset();
    await backend.publishCommit!('.masterselects/commits/c1.json', new TextEncoder().encode('{"format":"masterselects-commit","commitId":"c1","lastOperation":1}'), null, owner);
    // Head check listing (an absent folder lists empty), create, stream, close and the completion check:
    // the one getFile is the completion check, the create's size probe is not needed.
    expect(calls).toMatchObject({ getFileHandle: 1, getFile: 1, createWritable: 1, close: 1 });
  });

  it('serves an own slot from memory only while it holds the writer locks', async () => {
    const first = await writable();
    const path = '.masterselects/views/workspace/key/a.json';
    await first.backend.replaceViewSlot(path, chunks(new Uint8Array([1])));
    first.reset();
    expect([...await first.backend.read(path)]).toEqual([1]);
    expect(total(first.calls)).toBe(0);
    // Another writer takes over the location and replaces the slot: the former writer reads the folder again.
    await first.owner.release();
    const second = await writable({}, first.calls, first.root);
    await second.backend.replaceViewSlot(path, chunks(new Uint8Array([2])));
    expect([...await first.backend.read(path)]).toEqual([2]);
  });

  it('lets slot writes run beside a content write instead of queueing behind it', async () => {
    const { backend } = await writable();
    let finishContent!: () => void;
    const slow = (async function* () { await new Promise<void>(resolve => { finishContent = resolve; }); yield new Uint8Array([1]); })();
    const content = backend.writeNew('.masterselects/segments/slow.msseg', slow);
    await backend.replaceViewSlot('.masterselects/views/w/key/a.json', chunks(new Uint8Array([2])));
    finishContent(); await content;
  });
});

describe('workspace view store on a folder', () => {
  const owner: RepositoryOwner = { writerEpoch: 'e', assertOwned() {}, async release() {} };
  it('writes parts concurrently and the project shape only after every part succeeded', async () => {
    const order: string[] = []; let failPart = true;
    const slots = new Map<string, Uint8Array>();
    const backend = {
      locationId: 'memory', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' as const },
      async acquireOwner() { return owner; }, async list() { return { paths: [], nextCursor: null }; },
      async read(path: string) { const bytes = slots.get(path); if (!bytes) throw new Error('missing'); return bytes; },
      async stat(path: string) { return slots.has(path) ? { length: slots.get(path)!.length } : null; },
      async writeNew() {}, async removeUnpublished() {},
      async replaceViewSlot(path: string, data: AsyncIterable<Uint8Array>) {
        const key = decodeURIComponent(path.split('/')[3]!);
        if (key === 'project/part/b' && failPart) throw new Error('provider paused');
        order.push(key); for await (const chunk of data) slots.set(path, chunk);
      },
    };
    const store = new WorkspaceViewStore(backend, owner, 'repository', 'workspace');
    store.update('project', { parts: ['a', 'b'] }); store.update('project/part/a', { a: 1 }); store.update('project/part/b', { b: 1 });
    await expect(store.flush()).rejects.toThrow('provider paused');
    expect(order).toEqual(['project/part/a']);
    failPart = false;
    await store.flush();
    expect(order.at(-1)).toBe('project');
    expect(order.filter(key => key === 'project')).toHaveLength(1);
  });

  it('uses the listing prefetched while opening for the first keys() call only', async () => {
    let listings = 0;
    const backend = {
      locationId: 'memory', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' as const },
      async acquireOwner() { return owner; },
      async list() { listings++; return { paths: ['.masterselects/views/workspace/zoom/a.json'], nextCursor: null }; },
      async read() { throw new Error('missing'); }, async stat() { return null; },
      async writeNew() {}, async replaceViewSlot() {}, async removeUnpublished() {},
    };
    const store = new WorkspaceViewStore(backend, owner, 'repository', 'workspace');
    store.prefetch();
    expect(await store.keys()).toEqual(['zoom']);
    expect(listings).toBe(1);
    await store.keys();
    expect(listings).toBe(2);
  });
});
