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
  it('reuses directory handles during recovery while reading file contents freshly', async () => {
    vi.stubGlobal('navigator', {});
    const files = { 'a.msseg': new Uint8Array([1, 2]) };
    const segments = directory(files);
    const segmentsLookup = vi.fn(async () => segments);
    const metadata = { getDirectoryHandle: segmentsLookup } as unknown as FileSystemDirectoryHandle;
    const rootLookup = vi.fn(async () => metadata);
    const root = { getDirectoryHandle: rootLookup } as unknown as FileSystemDirectoryHandle;
    const backend = directoryBackend(root, 'fixture');
    expect(await backend.stat('.masterselects/segments/a.msseg')).toEqual({ length: 2 });
    expect([...await backend.read('.masterselects/segments/a.msseg')]).toEqual([1, 2]);
    files['a.msseg'] = new Uint8Array([3, 4]);
    expect([...await backend.read('.masterselects/segments/a.msseg')]).toEqual([3, 4]);
    expect(rootLookup).toHaveBeenCalledTimes(1); expect(segmentsLookup).toHaveBeenCalledTimes(1);
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
  it('rejects unbounded reads and path escapes', async () => {
    vi.stubGlobal('navigator', {});
    const backend = directoryBackend(directory({ 'large.bin': new Uint8Array(5 * 1024 * 1024) }), 'test');
    await expect(backend.read('large.bin')).rejects.toMatchObject({ code: 'budget' });
    expect(await backend.read('large.bin', 1024, 256)).toHaveLength(256);
    await expect(backend.read('../large.bin', 0, 1)).rejects.toMatchObject({ code: 'permission' });
  });
});
