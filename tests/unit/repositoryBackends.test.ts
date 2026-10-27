import { File } from 'node:buffer';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { directoryBackend } from '../../src/services/project/repository/backends/directoryBackend';
import { createFsaRepositoryBackend } from '../../src/services/project/repository/backends/fsaBackend';
afterEach(() => vi.unstubAllGlobals());
function directory(files: Record<string, Uint8Array>): FileSystemDirectoryHandle {
  return {
    kind: 'directory', name: 'project',
    async getFileHandle(name: string) {
      if (!files[name]) throw new DOMException('Missing file', 'NotFoundError');
      return { kind: 'file', async getFile() { return new File([files[name]], name); } };
    },
    async *entries() { for (const name of Object.keys(files).reverse()) yield [name, { kind: 'file' }]; },
    async queryPermission() { return 'denied'; },
  } as unknown as FileSystemDirectoryHandle;
}
describe('repository browser backends', () => {
  it('keeps readable OPFS handles read-only when writable streams are missing', async () => {
    vi.stubGlobal('navigator', { locks: { request: vi.fn() } });
    vi.stubGlobal('FileSystemFileHandle', class {});
    const backend = directoryBackend(directory({ 'data.bin': new Uint8Array([7]) }), 'opfs:fixture');
    expect(backend.capabilities.immutableWrites).toBe(false);
    expect(await backend.acquireOwner('repo')).toBeNull();
    expect([...await backend.read('data.bin')]).toEqual([7]);
  });
  it('reuses directory handles during recovery while reading replaceable file contents freshly', async () => {
    vi.stubGlobal('navigator', {});
    const files = { 'a.blob': new Uint8Array([1, 2]) };
    const artifacts = directory(files);
    const artifactsLookup = vi.fn(async () => artifacts);
    const metadata = { getDirectoryHandle: artifactsLookup } as unknown as FileSystemDirectoryHandle;
    const rootLookup = vi.fn(async () => metadata);
    const root = { getDirectoryHandle: rootLookup } as unknown as FileSystemDirectoryHandle;
    const backend = directoryBackend(root, 'fixture');
    expect(await backend.stat('.masterselects/artifacts/a.blob')).toMatchObject({ length: 2, modifiedTime: expect.any(Number) });
    expect([...await backend.read('.masterselects/artifacts/a.blob')]).toEqual([1, 2]);
    files['a.blob'] = new Uint8Array([3, 4]);
    expect([...await backend.read('.masterselects/artifacts/a.blob')]).toEqual([3, 4]);
    expect(rootLookup).toHaveBeenCalledTimes(1); expect(artifactsLookup).toHaveBeenCalledTimes(1);
  });
  it('reads a write-once segment from the folder once per session (folder round trips on phones)', async () => {
    vi.stubGlobal('navigator', {});
    const files = { 'a.msseg': new Uint8Array([1, 2, 3, 4]) };
    const segments = directory(files);
    const fileLookup = vi.spyOn(segments, 'getFileHandle');
    const root = { getDirectoryHandle: vi.fn(async () => ({ getDirectoryHandle: vi.fn(async () => segments) })) } as unknown as FileSystemDirectoryHandle;
    const backend = directoryBackend(root, 'fixture');
    expect([...await backend.read('.masterselects/segments/a.msseg', 0, 2)]).toEqual([1, 2]);
    expect([...await backend.read('.masterselects/segments/a.msseg', 2, 2)]).toEqual([3, 4]);
    expect(await backend.stat('.masterselects/segments/a.msseg')).toMatchObject({ length: 4 });
    expect(fileLookup).toHaveBeenCalledTimes(1);
    // A non-empty segment is final (writes refuse to replace it), so its bytes are served from the session.
    files['a.msseg'] = new Uint8Array([9, 9, 9, 9]);
    expect([...await backend.read('.masterselects/segments/a.msseg')]).toEqual([1, 2, 3, 4]);
    // A fresh backend (next session) reads the folder again.
    expect([...await directoryBackend(root, 'fixture').read('.masterselects/segments/a.msseg')]).toEqual([9, 9, 9, 9]);
  });
  it('never caches an empty write-once file, which an interrupted write may still finish', async () => {
    vi.stubGlobal('navigator', {});
    const files: Record<string, Uint8Array> = { 'c.json': new Uint8Array() };
    const commits = directory(files);
    const root = { getDirectoryHandle: vi.fn(async () => ({ getDirectoryHandle: vi.fn(async () => commits) })) } as unknown as FileSystemDirectoryHandle;
    const backend = directoryBackend(root, 'fixture');
    expect(await backend.stat('.masterselects/commits/c.json')).toMatchObject({ length: 0 });
    expect([...await backend.read('.masterselects/commits/c.json')]).toEqual([]);
    files['c.json'] = new Uint8Array([7, 8]);
    expect([...await backend.read('.masterselects/commits/c.json')]).toEqual([7, 8]);
  });
  it('stays read-only when Web Locks or permission is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const backend = await createFsaRepositoryBackend(directory({ 'data.bin': new Uint8Array([1,2,3]) }));
    expect(backend.capabilities.ownership).toBe(false);
    expect(await backend.acquireOwner('repo')).toBeNull();
    expect([...await backend.read('data.bin', 1, 2)]).toEqual([2,3]);
    await expect(backend.writeNew('.masterselects/artifacts/new.blob', (async function* () { yield new Uint8Array([4]); })())).rejects.toMatchObject({ code: 'ownership' });
  });
  it('paginates unordered physical entries without losing records', async () => {
    vi.stubGlobal('navigator', {});
    const backend = directoryBackend(directory(Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`file-${String(index).padStart(3,'0')}`, new Uint8Array()]))), 'test');
    const first = await backend.list('', undefined, 128);
    const second = await backend.list('', first.nextCursor!, 128);
    const last = await backend.list('', second.nextCursor!, 128);
    expect(first.paths).toHaveLength(128); expect(second.paths).toHaveLength(128); expect(last.paths).toHaveLength(44);
    expect(new Set([...first.paths,...second.paths,...last.paths]).size).toBe(300);
    expect(last.nextCursor).toBeNull();
  });
  it('allows only the two startup-cache slots through the repository write boundary', async () => {
    vi.stubGlobal('navigator', {});
    const backend = directoryBackend(directory({}), 'fixture');
    const bytes = () => (async function* () { yield new Uint8Array([1]); })();
    // These pass path validation and reach the independent owner check.
    for (const slot of ['a', 'b']) await expect(backend.replaceViewSlot(`.masterselects/cache/startup/${slot}.json`, bytes())).rejects.toMatchObject({ code: 'ownership' });
    await expect(backend.replaceViewSlot('.masterselects/cache/other.json', bytes())).rejects.toMatchObject({ code: 'permission' });
  });
  it('rejects unbounded reads and path escapes', async () => {
    vi.stubGlobal('navigator', {});
    const backend = directoryBackend(directory({ 'large.bin': new Uint8Array(5 * 1024 * 1024) }), 'test');
    await expect(backend.read('large.bin')).rejects.toMatchObject({ code: 'budget' });
    expect(await backend.read('large.bin', 1024, 256)).toHaveLength(256);
    await expect(backend.read('../large.bin', 0, 1)).rejects.toMatchObject({ code: 'permission' });
  });
});
