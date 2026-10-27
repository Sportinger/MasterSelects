import { afterEach, describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { directoryBackend } from '../../src/services/project/repository/backends/directoryBackend';
import { recoverRepository } from '../../src/services/project/repository/persistence/recovery';
import type { CommitReference, RepositoryDescriptor } from '../../src/services/project/repository/contracts';

// Folder backends on Android are SAF document providers, and a paused folder fails every call for a while:
// a write AND its cleanup. These cover what such a failure may leave behind and the ownership edges of the
// session caches (directoryFileCache.ts).

afterEach(() => vi.unstubAllGlobals());

interface Faults {
  /** Fails createWritable for names matching this. */
  failCreate?: RegExp;
  /** Fails removeEntry for names matching this. */
  failRemove?: RegExp;
  /** close() stores only the first half of the bytes for names matching this. */
  tearClose?: RegExp;
  /** Delays close() of names matching this until the gate resolves. */
  holdClose?: { name: RegExp; gate: Promise<void> };
}
function memoryFolder(faults: Faults = {}) {
  const notFound = () => new DOMException('Missing', 'NotFoundError');
  const paused = () => new DOMException('Folder access paused', 'NotAllowedError');
  function folder(): FileSystemDirectoryHandle & { files: Map<string, Uint8Array>; folders: Map<string, FileSystemDirectoryHandle> } {
    const folders = new Map<string, FileSystemDirectoryHandle>();
    const files = new Map<string, Uint8Array>();
    const fileHandle = (name: string) => ({
      kind: 'file', name,
      async getFile() { if (!files.has(name)) throw notFound(); return new File([files.get(name)!], name); },
      async createWritable() {
        if (faults.failCreate?.test(name)) throw paused();
        const parts: number[] = [];
        return {
          async write(chunk: Uint8Array) { parts.push(...chunk); },
          async close() {
            if (faults.holdClose?.name.test(name)) await faults.holdClose.gate;
            files.set(name, Uint8Array.from(faults.tearClose?.test(name) ? parts.slice(0, Math.floor(parts.length / 2)) : parts));
          },
          async abort() {},
        };
      },
    });
    return {
      kind: 'directory', files, folders,
      async getDirectoryHandle(name: string, create?: { create?: boolean }) {
        let child = folders.get(name);
        if (!child) { if (!create?.create) throw notFound(); child = folder(); folders.set(name, child); }
        return child;
      },
      async getFileHandle(name: string, create?: { create?: boolean }) {
        if (!files.has(name)) { if (!create?.create) throw notFound(); files.set(name, new Uint8Array()); }
        return fileHandle(name);
      },
      async removeEntry(name: string) { if (faults.failRemove?.test(name)) throw paused(); if (!files.delete(name)) throw notFound(); },
      async *entries() { for (const [name, handle] of folders) yield [name, handle]; for (const name of files.keys()) yield [name, fileHandle(name)]; },
    } as unknown as FileSystemDirectoryHandle & { files: Map<string, Uint8Array>; folders: Map<string, FileSystemDirectoryHandle> };
  }
  return folder();
}
type MemoryFolder = ReturnType<typeof memoryFolder>;
const commitsOf = (root: MemoryFolder) => (root.folders.get('.masterselects') as MemoryFolder | undefined)?.folders.get('commits') as MemoryFolder | undefined;
function stubBrowser() {
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
}
const chunks = (bytes: Uint8Array) => (async function* () { yield bytes; })();
const text = (value: string) => new TextEncoder().encode(value);
async function commit(id: string, lastOperation: number): Promise<{ path: string; bytes: Uint8Array; reference: CommitReference }> {
  const bytes = text(JSON.stringify({ format: 'masterselects-commit', commitId: id, lastOperation }));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { path: `.masterselects/commits/${id}.json`, bytes, reference: { commitId: id, hash: 'sha256:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') } };
}

describe('torn commit files on folder backends', () => {
  it('a failed commit write whose cleanup failed too does not block later saves once the retry finished it', async () => {
    stubBrowser();
    const faults: Faults = {};
    const root = memoryFolder(faults);
    const backend = directoryBackend(root, 'torn-retry');
    const owner = (await backend.acquireOwner('repository'))!;
    const first = await commit('c1', 1), second = await commit('c2', 2), third = await commit('c3', 3);
    await backend.publishCommit!(first.path, first.bytes, null, owner);
    // The folder pauses: the write and its cleanup both fail, a 0-byte commit file stays behind.
    faults.failCreate = /^c2\.json$/; faults.failRemove = /^c2\.json$/;
    await expect(backend.publishCommit!(second.path, second.bytes, first.reference, owner)).rejects.toBeTruthy();
    expect(commitsOf(root)!.files.get('c2.json')?.length).toBe(0);
    // The retry lists the empty file in its head check and then finishes it.
    delete faults.failCreate; delete faults.failRemove;
    await backend.publishCommit!(second.path, second.bytes, first.reference, owner);
    // The next save must see c2 as the head (the empty read must not have been cached as "no commit").
    await expect(backend.publishCommit!(third.path, third.bytes, second.reference, owner)).resolves.toBeUndefined();
    expect([...commitsOf(root)!.files.keys()].toSorted()).toEqual(['c1.json', 'c2.json', 'c3.json']);
  });

  it('ignores an empty foreign commit file for head selection and removes it; a failing removal never blocks the save', async () => {
    stubBrowser();
    const faults: Faults = { failRemove: /^stale\.json$/ };
    const root = memoryFolder(faults);
    const backend = directoryBackend(root, 'torn-foreign');
    const owner = (await backend.acquireOwner('repository'))!;
    const first = await commit('c1', 1), second = await commit('c2', 2), third = await commit('c3', 3);
    await backend.publishCommit!(first.path, first.bytes, null, owner);
    commitsOf(root)!.files.set('stale.json', new Uint8Array());
    // Removal fails (folder paused): the save still succeeds and the torn file stays for a later attempt.
    await backend.publishCommit!(second.path, second.bytes, first.reference, owner);
    expect(commitsOf(root)!.files.has('stale.json')).toBe(true);
    delete faults.failRemove;
    await backend.publishCommit!(third.path, third.bytes, second.reference, owner);
    expect(commitsOf(root)!.files.has('stale.json')).toBe(false);
  });

  it('removes and rewrites its own half-written commit instead of refusing every retry', async () => {
    stubBrowser();
    const faults: Faults = {};
    const root = memoryFolder(faults);
    const backend = directoryBackend(root, 'torn-own');
    const owner = (await backend.acquireOwner('repository'))!;
    const first = await commit('c1', 1), second = await commit('c2', 2);
    await backend.publishCommit!(first.path, first.bytes, null, owner);
    faults.tearClose = /^c2\.json$/;
    await expect(backend.publishCommit!(second.path, second.bytes, first.reference, owner)).rejects.toMatchObject({ message: expect.stringContaining('Write did not complete') });
    expect(commitsOf(root)!.files.get('c2.json')?.length).toBe(Math.floor(second.bytes.length / 2));
    delete faults.tearClose;
    await backend.publishCommit!(second.path, second.bytes, first.reference, owner);
    expect(new TextDecoder().decode(commitsOf(root)!.files.get('c2.json'))).toBe(new TextDecoder().decode(second.bytes));
  });

  it('recovery ignores an empty commit file without reporting a damaged publication', async () => {
    stubBrowser();
    const root = memoryFolder();
    const commits = memoryFolder();
    commits.files.set('torn.json', new Uint8Array());
    (await root.getDirectoryHandle('.masterselects', { create: true }) as MemoryFolder).folders.set('commits', commits);
    const backend = directoryBackend(root, 'torn-recovery');
    const recovered = await recoverRepository(backend, { repositoryId: 'repository' } as RepositoryDescriptor);
    expect(recovered.head).toBeNull();
    // A warning here blocks artifact cleanup ('Incomplete or damaged publications block artifact cleanup').
    expect(recovered.warnings).toEqual([]);
  });
});

describe('owned slot ownership edges', () => {
  const slot = '.masterselects/views/workspace/project/a.json';

  it('does not serve owned-slot bytes cached under an earlier ownership epoch', async () => {
    stubBrowser();
    const root = memoryFolder();
    const first = directoryBackend(root, 'epoch'), second = directoryBackend(root, 'epoch');
    let owner = (await first.acquireOwner('repository'))!;
    await first.replaceViewSlot(slot, chunks(text('AAAA')));
    await owner.release();
    const other = (await second.acquireOwner('repository'))!;
    await second.replaceViewSlot(slot, chunks(text('BBBB')));
    await other.release();
    owner = (await first.acquireOwner('repository'))!;
    expect(new TextDecoder().decode(await first.read(slot))).toBe('BBBB');
    await owner.release();
  });

  it('refuses a slot write that starts while release() is waiting, and waits for the one started before', async () => {
    stubBrowser();
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const root = memoryFolder({ holdClose: { name: /^a\.json$/, gate } });
    const backend = directoryBackend(root, 'release');
    const owner = (await backend.acquireOwner('repository'))!;
    let earlyDone = false;
    const early = backend.replaceViewSlot(slot, chunks(text('early'))).then(() => { earlyDone = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    let released = false;
    const release = owner.release().then(() => { released = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    const late = backend.replaceViewSlot('.masterselects/views/workspace/other/b.json', chunks(text('late')));
    await expect(late).rejects.toMatchObject({ code: 'ownership' });
    expect(released).toBe(false);
    open();
    await release;
    expect(earlyDone).toBe(true);
    await early;
  });
});
