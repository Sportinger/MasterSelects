import { describe, expect, it, vi, afterEach } from 'vitest';
import { File } from 'node:buffer';
import { directoryBackend } from '../../src/services/project/repository/backends/directoryBackend';
import { hashBytes } from '../../src/services/project/repository/segments/canonical';

afterEach(() => vi.unstubAllGlobals());

function fixture(count = 1100, names?: string[], writable = false) {
  vi.stubGlobal('navigator', writable ? { locks: { request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } } : {});
  const files = names ?? Array.from({ length: count }, (_, index) => `commit-${String(index).padStart(5, '0')}.json`);
  let enumerations = 0;
  const commits = {
    async getFileHandle(name: string) {
      const operation = files.indexOf(name);
      if (operation < 0) throw new DOMException('Missing file', 'NotFoundError');
      return { async getFile() { return new File([JSON.stringify({ format: 'masterselects-commit', commitId: name.slice(0, -5), lastOperation: operation })], name); } };
    },
    async *entries() {
      enumerations++;
      for (const name of files.toReversed()) yield [name, { kind: 'file' }];
    },
  } as unknown as FileSystemDirectoryHandle;
  const metadata = { getDirectoryHandle: vi.fn(async () => commits) } as unknown as FileSystemDirectoryHandle;
  const rootEntries = vi.fn();
  const root = { getDirectoryHandle: vi.fn(async () => metadata), entries: rootEntries } as unknown as FileSystemDirectoryHandle;
  return { backend: directoryBackend(root, 'listing'), files, enumerations: () => enumerations, rootEntries };
}

async function remaining(backend: ReturnType<typeof directoryBackend>, cursor: string | null) {
  const paths: string[] = [];
  while (cursor) {
    const page = await backend.list('.masterselects/commits/', cursor, 128);
    paths.push(...page.paths); cursor = page.nextCursor;
  }
  return paths;
}

describe('physical repository directory pagination', () => {
  it('enumerates a thousand-commit folder once for all its pages', async () => {
    const source = fixture();
    const first = await source.backend.list('.masterselects/commits/', undefined, 128);
    const paths = [...first.paths, ...await remaining(source.backend, first.nextCursor)];
    expect(paths).toEqual(source.files.toSorted().map(name => `.masterselects/commits/${name}`));
    expect(source.enumerations()).toBe(1);
    expect(source.rootEntries).not.toHaveBeenCalled();
  });

  it('starts a fresh discovery for every head check, including external new commits', async () => {
    const source = fixture(300);
    const first = await source.backend.list('.masterselects/commits/', undefined, 128);
    source.files.push('commit-00001-external.json');
    const next = await source.backend.list('.masterselects/commits/', undefined, 128);
    expect(next.paths).toContain('.masterselects/commits/commit-00001-external.json');
    expect((await remaining(source.backend, first.nextCursor))).toHaveLength(172);
    expect((await remaining(source.backend, next.nextCursor))).toHaveLength(173);
    expect(source.enumerations()).toBe(2);
  });

  it('continues an evicted cursor without losing existing files', async () => {
    const source = fixture(300);
    const first = await source.backend.list('.masterselects/commits/', undefined, 128);
    for (let index = 0; index < 4; index++) await source.backend.list('.masterselects/commits/', undefined, 128);
    expect([...first.paths, ...await remaining(source.backend, first.nextCursor)]).toHaveLength(300);
    expect(source.enumerations()).toBe(6);
  });

  it('falls back to bounded pages when the filename snapshot exceeds its budget', async () => {
    const source = fixture(0, Array.from({ length: 2100 }, (_, index) => `${String(index).padStart(5, '0')}-${'x'.repeat(1000)}.json`));
    const first = await source.backend.list('.masterselects/commits/', undefined, 1024);
    const next = await source.backend.list('.masterselects/commits/', first.nextCursor!, 1024);
    expect(first.paths).toHaveLength(1024); expect(next.paths).toHaveLength(1024);
    expect(new Set([...first.paths, ...next.paths]).size).toBe(2048);
    expect(source.enumerations()).toBe(2);
  });

  it('honors cancellation even when the next page is already cached', async () => {
    const source = fixture(300);
    const first = await source.backend.list('.masterselects/commits/', undefined, 128);
    const controller = new AbortController(); controller.abort();
    await expect(source.backend.list('.masterselects/commits/', first.nextCursor!, 128, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(source.enumerations()).toBe(1);
  });

  it('rejects an external newer head before publication despite an unfinished earlier listing', async () => {
    const source = fixture(300, undefined, true);
    const owner = await source.backend.acquireOwner('test-repository');
    expect(owner).not.toBeNull();
    try {
      await source.backend.list('.masterselects/commits/', undefined, 128);
      const commitId = 'commit-00299';
      const hash = await hashBytes(await source.backend.read(`.masterselects/commits/${commitId}.json`));
      source.files.push('external-newer.json');
      await expect(source.backend.publishCommit!('.masterselects/commits/next.json', new Uint8Array(), { commitId, hash }, owner!)).rejects.toMatchObject({ code: 'conflict', message: 'Repository head changed before publication' });
      expect(source.enumerations()).toBe(2);
    } finally { await owner!.release(); }
  });

  it('treats a missing prefix directory as an empty listing', async () => {
    vi.stubGlobal('navigator', {});
    const root = { async getDirectoryHandle() { throw new DOMException('Missing directory', 'NotFoundError'); } } as unknown as FileSystemDirectoryHandle;
    const backend = directoryBackend(root, 'missing');
    expect(await backend.list('.masterselects/commits/')).toEqual({ paths: [], nextCursor: null });
  });
});
