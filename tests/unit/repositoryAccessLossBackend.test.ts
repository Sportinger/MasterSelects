import { File } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { directoryBackend } from '../../src/services/project/repository/backends/directoryBackend';

afterEach(() => vi.unstubAllGlobals());

/** In-memory project folder whose access the "browser" can withdraw at any step. */
function folder() {
  const files = new Map<string, Uint8Array>();
  const state = { allowed: true, failCreateWritable: false };
  const guard = () => { if (!state.allowed) throw new DOMException('The request is not allowed', 'NotAllowedError'); };
  const directory = (prefix: string): FileSystemDirectoryHandle => ({
    kind: 'directory', name: prefix || 'project',
    async getDirectoryHandle(name: string) { guard(); return directory(`${prefix}${name}/`); },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      guard();
      const path = prefix + name;
      if (!files.has(path)) { if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); files.set(path, new Uint8Array()); }
      return {
        kind: 'file', name,
        async getFile() { guard(); return new File([files.get(path)!], name); },
        async createWritable() {
          guard();
          // Access lapses after the file was created: the cleanup below fails too.
          if (state.failCreateWritable) { state.allowed = false; guard(); }
          const chunks: Uint8Array[] = [];
          return {
            async write(chunk: Uint8Array) { guard(); chunks.push(chunk); },
            async close() { guard(); files.set(path, new Uint8Array(chunks.flatMap(chunk => [...chunk]))); },
            async abort() {},
          };
        },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry(name: string) { guard(); files.delete(prefix + name); },
  } as unknown as FileSystemDirectoryHandle);
  return { root: directory(''), files, state };
}
function writableEnvironment() {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: (lock: object) => unknown) => run({}) } });
  class Handle {}
  (Handle.prototype as unknown as { createWritable: () => void }).createWritable = () => {};
  vi.stubGlobal('FileSystemFileHandle', Handle);
}
const bytes = (...values: number[]) => (async function* () { yield new Uint8Array(values); })();

describe('repository writes when the browser pauses folder access', () => {
  it('reports withdrawn access as `access`, not as a policy or I/O failure', async () => {
    writableEnvironment();
    const { root, state } = folder();
    const backend = directoryBackend(root, 'fsa:fixture');
    await backend.acquireOwner('repo');
    state.allowed = false;
    await expect(backend.writeNew('.masterselects/segments/a.msseg', bytes(1))).rejects.toMatchObject({ name: 'RepositoryError', code: 'access' });
    await expect(backend.read('.masterselects/segments/a.msseg')).rejects.toMatchObject({ code: 'access' });
  });

  it('finishes an immutable write that was interrupted after its file was created', async () => {
    writableEnvironment();
    const { root, files, state } = folder();
    const backend = directoryBackend(root, 'fsa:fixture');
    await backend.acquireOwner('repo');
    state.failCreateWritable = true;
    await expect(backend.writeNew('.masterselects/segments/a.msseg', bytes(1, 2, 3))).rejects.toMatchObject({ code: 'access' });
    // The empty file stayed behind because its removal was refused as well.
    expect(files.get('.masterselects/segments/a.msseg')?.length).toBe(0);

    state.failCreateWritable = false; state.allowed = true;
    await backend.writeNew('.masterselects/segments/a.msseg', bytes(1, 2, 3));
    expect([...files.get('.masterselects/segments/a.msseg')!]).toEqual([1, 2, 3]);
    // Published immutable content is still protected.
    await expect(backend.writeNew('.masterselects/segments/a.msseg', bytes(9))).rejects.toMatchObject({ code: 'conflict' });
  });
});
