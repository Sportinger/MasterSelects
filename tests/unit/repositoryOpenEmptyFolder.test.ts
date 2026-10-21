import { describe, expect, it, vi } from 'vitest';
import type { RepositoryBackend } from '../../src/services/project/repository/contracts';

// A missing or empty project folder was handed to the old-project importer, which wrote import
// bookkeeping into it and failed with the misleading "Legacy source has no project state".

const folder = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), writes: [] as string[] }));
vi.mock('../../src/services/project/repository/backends/fsaBackend', () => ({
  createFsaRepositoryBackend: async (): Promise<RepositoryBackend> => ({
    locationId: 'fsa:empty', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return { writerEpoch: 'test', assertOwned() {}, async release() {} }; },
    async list(prefix) { return { paths: [...folder.files.keys()].filter(path => path.startsWith(prefix)), nextCursor: null }; },
    async read() { throw new Error('nothing to read'); },
    async stat(path) { return folder.files.has(path) ? { length: folder.files.get(path)!.length } : null; },
    async writeNew(path) { folder.writes.push(path); },
    async replaceViewSlot(path) { folder.writes.push(path); },
    async removeUnpublished() {},
  }),
}));

describe('opening a folder without a project', () => {
  it('reports that the folder holds no project and writes nothing into it', async () => {
    const { prepareRepositoryOpen } = await import('../../src/services/project/repository/lifecycle/repositoryLocations');
    const handle = { kind: 'directory', name: 'Empty' } as unknown as FileSystemDirectoryHandle;
    await expect(prepareRepositoryOpen({ kind: 'fsa', handle }, 'workspace')).rejects.toMatchObject({
      code: 'unsupported', message: expect.stringContaining('does not contain a MasterSelects project'),
    });
    expect(folder.writes).toEqual([]);
  });
});
