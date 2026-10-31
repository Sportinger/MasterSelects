import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FallbackEntry, FallbackEntryStore } from '../../src/services/project/core/fallbackDirectoryHandle';

/** Map-backed stand-in for the IndexedDB entry store; same atomic contract. */
function memoryStore(): FallbackEntryStore {
  const entries = new Map<string, FallbackEntry>();
  const chunks = new Map<string, ArrayBuffer[]>();
  const missing = (path: string) => new DOMException(`${path} missing`, 'NotFoundError');
  return {
    async get(path) { return entries.get(path); },
    async children(parent) { return [...entries.values()].filter(entry => entry.parent === parent); },
    async ensure(entry) {
      const existing = entries.get(entry.path); if (existing) return existing;
      if (entry.parent && !entries.has(entry.parent)) throw missing(entry.parent);
      entries.set(entry.path, entry); return entry;
    },
    async remove(path) {
      for (const key of [...entries.keys()]) if (key === path || key.startsWith(`${path}/`)) {
        const contentId = entries.get(key)!.contentId; if (contentId) chunks.delete(contentId); entries.delete(key);
      }
    },
    async putChunk(contentId, index, bytes) { const list = chunks.get(contentId) ?? []; list[index] = bytes; chunks.set(contentId, list); },
    async readChunks(contentId) { return chunks.get(contentId) ?? []; },
    async commit(path, contentId, size, lastModified) {
      const entry = entries.get(path); if (!entry || entry.kind !== 'file') throw missing(path);
      if (entry.contentId) chunks.delete(entry.contentId);
      entries.set(path, { ...entry, contentId, size, lastModified });
    },
    async discard(contentId) { chunks.delete(contentId); },
  };
}

let openStore: () => Promise<FallbackEntryStore>;
vi.mock('../../src/services/project/core/indexedDbEntryStore', () => ({ openIndexedDbEntryStore: () => openStore() }));

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array) => new TextDecoder().decode(value);
async function* once(value: Uint8Array) { yield value; }

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  // WebKit without writable OPFS streams: the fallback must still be writable.
  vi.stubGlobal('FileSystemFileHandle', class {});
});
afterEach(() => vi.unstubAllGlobals());

function refuseOpfs() {
  const getDirectory = vi.fn(async () => { throw new DOMException('The operation failed for an unknown transient reason (e.g. out of memory).', 'UnknownError'); });
  vi.stubGlobal('navigator', {
    storage: { getDirectory },
    locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) },
  });
  return getDirectory;
}

describe('browser storage fallback when OPFS is refused', () => {
  it('creates, saves and reopens a browser project in the fallback store', { timeout: 15_000 }, async () => {
    const store = memoryStore(); openStore = async () => store;
    const getDirectory = refuseOpfs();
    const root = await import('../../src/services/project/core/browserStorageRoot');
    const { createOpfsRepositoryBackend } = await import('../../src/services/project/repository/backends/opfsBackend');

    const backend = await createOpfsRepositoryBackend('My Project');
    // The fallback is a last resort: OPFS is asked again after growing pauses first.
    expect(getDirectory).toHaveBeenCalledTimes(4);
    expect(root.getBrowserStorageFallbackReason()).toBe('refused');
    expect(root.getBrowserStorageKind()).toBe('indexeddb');
    expect(sessionStorage.getItem('ms.browserStorage.kind')).toBe('indexeddb');
    expect(backend.locationId).toMatch(/^indexeddb:/);
    expect(backend.capabilities.immutableWrites).toBe(true);

    const owner = await backend.acquireOwner('repo');
    expect(owner).not.toBeNull();
    const segment = new Uint8Array(5 * 1024 * 1024).map((_, index) => index % 251);
    await backend.writeNew('project.msrepo.json', once(bytes('{"format":"masterselects-repository"}')));
    await backend.writeNew('.masterselects/segments/s1.msseg', once(segment));
    await backend.replaceViewSlot('.masterselects/views/w/k/a.json', once(bytes('first')));
    await backend.replaceViewSlot('.masterselects/views/w/k/a.json', once(bytes('second')));
    await expect(backend.writeNew('project.msrepo.json', once(bytes('{}')))).rejects.toMatchObject({ code: 'conflict' });
    await owner!.release();

    // Reload: a fresh module graph adopts the tab's choice without probing OPFS again.
    vi.resetModules();
    const reopened = await (await import('../../src/services/project/repository/backends/opfsBackend')).createOpfsRepositoryBackend('My Project');
    expect(getDirectory).toHaveBeenCalledTimes(4);
    expect(text(await reopened.read('project.msrepo.json'))).toContain('masterselects-repository');
    expect(await reopened.stat('.masterselects/segments/s1.msseg')).toMatchObject({ length: segment.byteLength });
    expect([...await reopened.read('.masterselects/segments/s1.msseg', 4 * 1024 * 1024 + 7, 3)]).toEqual([...segment.subarray(4 * 1024 * 1024 + 7, 4 * 1024 * 1024 + 10)]);
    expect(text(await reopened.read('.masterselects/views/w/k/a.json'))).toBe('second');
    expect((await reopened.list('.masterselects/')).paths).toEqual(['.masterselects/segments/s1.msseg', '.masterselects/views/w/k/a.json']);

    const { acquireProjectRoot, listProjectFolderNames } = await import('../../src/services/project/core/projectRootAccess');
    expect(await listProjectFolderNames((await acquireProjectRoot('opfs', { throwOnFailure: true }))!)).toEqual(['My Project']);
  });

  it('explains the failure when the IndexedDB fallback is refused as well', { timeout: 15_000 }, async () => {
    openStore = async () => { throw new DOMException('IndexedDB is unavailable in this browser', 'NotSupportedError'); };
    refuseOpfs();
    const { getBrowserStorageRoot, getBrowserStorageKind } = await import('../../src/services/project/core/browserStorageRoot');
    const { BROWSER_STORAGE_UNAVAILABLE_MESSAGE } = await import('../../src/services/project/core/browserStorageFailure');
    await expect(getBrowserStorageRoot()).rejects.toMatchObject({ code: 'unsupported', message: BROWSER_STORAGE_UNAVAILABLE_MESSAGE });
    expect(getBrowserStorageKind()).toBeNull();
  });

  it('keeps OPFS when it answers on a later attempt, without touching the fallback', { timeout: 15_000 }, async () => {
    const store = memoryStore(); openStore = vi.fn(async () => store);
    let calls = 0;
    const opfsRoot = { kind: 'directory', name: '' } as unknown as FileSystemDirectoryHandle;
    vi.stubGlobal('navigator', { storage: { getDirectory: vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new DOMException('The operation failed for an unknown transient reason (e.g. out of memory).', 'UnknownError');
      return opfsRoot;
    }) } });
    const { getBrowserStorageRoot, getBrowserStorageKind } = await import('../../src/services/project/core/browserStorageRoot');
    await expect(getBrowserStorageRoot()).resolves.toBe(opfsRoot);
    expect(calls).toBe(3);
    expect(getBrowserStorageKind()).toBe('opfs');
    expect(openStore).not.toHaveBeenCalled();
  });
});

describe('browser storage on browsers without OPFS', () => {
  it('stores projects in the temporary fallback as a last resort and says why', async () => {
    const store = memoryStore(); openStore = async () => store;
    vi.stubGlobal('navigator', {
      storage: {},
      locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) },
    });
    vi.stubGlobal('indexedDB', {});
    const root = await import('../../src/services/project/core/browserStorageRoot');
    const { resolveProjectRootMode } = await import('../../src/services/project/core/projectRootAccess');
    expect(root.isBrowserProjectStorageAvailable()).toBe(true);
    expect(resolveProjectRootMode()).toBe('opfs');

    const { createOpfsRepositoryBackend } = await import('../../src/services/project/repository/backends/opfsBackend');
    const backend = await createOpfsRepositoryBackend('Old Android');
    expect(backend.locationId).toMatch(/^indexeddb:/);
    expect(root.getBrowserStorageKind()).toBe('indexeddb');
    expect(root.getBrowserStorageFallbackReason()).toBe('missing');
    expect(root.describeBrowserStorageFallback('missing')).toContain('too old');
  });

  it('still reports no storage when IndexedDB is missing too', async () => {
    vi.stubGlobal('navigator', { storage: {} });
    vi.stubGlobal('indexedDB', undefined);
    const root = await import('../../src/services/project/core/browserStorageRoot');
    expect(root.isBrowserProjectStorageAvailable()).toBe(false);
    await expect(root.getBrowserStorageRoot()).rejects.toMatchObject({ code: 'unsupported' });
  });
});
