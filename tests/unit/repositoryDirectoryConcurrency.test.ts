import { afterEach, describe, expect, it, vi } from 'vitest';
import { File } from 'node:buffer';
import { directoryBackend } from '../../src/services/project/repository/backends/directoryBackend';

afterEach(() => vi.unstubAllGlobals());

/** In-memory folder whose lookups take a while, like a project folder on a real (slow) disk. */
function slowFolder(delayMs = 5) {
  const wait = () => new Promise(resolve => setTimeout(resolve, delayMs));
  const notFound = () => new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');
  function folder(): FileSystemDirectoryHandle {
    const folders = new Map<string, FileSystemDirectoryHandle>();
    const files = new Map<string, Uint8Array>();
    return {
      kind: 'directory',
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        await wait();
        let child = folders.get(name);
        if (!child) { if (!options?.create) throw notFound(); child = folder(); folders.set(name, child); }
        return child;
      },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!files.has(name)) { if (!options?.create) throw notFound(); files.set(name, new Uint8Array()); }
        return {
          async getFile() { if (!files.has(name)) throw notFound(); return new File([files.get(name)!], name); },
          async createWritable() {
            const parts: Uint8Array[] = [];
            return { async write(chunk: Uint8Array) { parts.push(chunk); }, async close() { files.set(name, Uint8Array.from(parts.flatMap(part => [...part]))); }, async abort() {} };
          },
        };
      },
      async removeEntry(name: string) { files.delete(name); },
      async *entries() { for (const [name, handle] of folders) yield [name, handle]; for (const name of files.keys()) yield [name, { kind: 'file' }]; },
    } as unknown as FileSystemDirectoryHandle;
  }
  return folder();
}

async function writableBackend() {
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } });
  const backend = directoryBackend(slowFolder(), 'slow-disk');
  await backend.acquireOwner('repository');
  return backend;
}
const bytes = (text: string) => (async function* () { yield new TextEncoder().encode(text); })();

describe('directory backend on a slow disk', () => {
  it('writes into a new folder while a reader is still looking that folder up', async () => {
    const backend = await writableBackend();
    const path = '.masterselects/views/workspace/project%2Fpart/a.json';
    // A view read stats both slots of a key that was never stored; the first write of that key starts meanwhile.
    const [missing, , written] = await Promise.all([
      backend.stat(path),
      backend.stat(path.replace('a.json', 'b.json')),
      backend.replaceViewSlot(path, bytes('{"slot":"a"}')).then(() => backend.read(path)),
    ]);
    expect(missing).toBeNull();
    expect(new TextDecoder().decode(written)).toBe('{"slot":"a"}');
  });

  it('creates a missing manifest folder for a writer while a listing of it is in flight', async () => {
    const backend = await writableBackend();
    const [listing] = await Promise.all([
      backend.list('.masterselects/artifact-manifests/'),
      backend.writeNew('.masterselects/artifact-manifests/manifest.json', bytes('{}')),
    ]);
    expect(listing.paths).toEqual([]);
    expect(await backend.stat('.masterselects/artifact-manifests/manifest.json')).toEqual(expect.objectContaining({ length: 2 }));
  });

  it('still reports a missing folder to readers', async () => {
    const backend = await writableBackend();
    await expect(backend.read('.masterselects/commits/missing.json')).rejects.toMatchObject({ code: 'io' });
    expect(await backend.stat('.masterselects/commits/missing.json')).toBeNull();
  });
});
