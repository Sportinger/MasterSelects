import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RepositoryBackend } from '../../src/services/project/repository/contracts';

// isLegacyProjectLocation and prepareRepositoryOpen share one read-only probe backend for a few seconds.
// That backend caches project.msrepo.json as a write-once file, so a probe from before the folder's project
// was created or replaced must never answer a later open.

const folder = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), created: 0 }));
vi.mock('../../src/services/project/repository/backends/fsaBackend', () => ({
  // Each backend snapshots the folder when created, like the session caches of a real folder backend.
  createFsaRepositoryBackend: async (): Promise<RepositoryBackend> => {
    folder.created += 1;
    const files = new Map(folder.files);
    return {
      locationId: `fsa:probe-${folder.created}`, capabilities: { rangeReads: true, immutableWrites: false, replaceViewSlots: false, ownership: false, durability: 'stream-close' },
      async acquireOwner() { return null; },
      async list(prefix) { return { paths: [...files.keys()].filter(path => path.startsWith(prefix)).toSorted(), nextCursor: null }; },
      async read(path, offset = 0, length) {
        const bytes = files.get(path); if (!bytes) throw new DOMException('Missing', 'NotFoundError');
        return bytes.slice(offset, length === undefined ? undefined : offset + length);
      },
      async stat(path) { return files.has(path) ? { length: files.get(path)!.length, modifiedTime: 0 } : null; },
      async writeNew() { throw new Error('probe backends never write'); },
      async replaceViewSlot() { throw new Error('probe backends never write'); },
      async removeUnpublished() {},
    };
  },
}));

const descriptor = (repositoryId: string) => new TextEncoder().encode(JSON.stringify({ format: 'masterselects-repository', formatVersion: 1, repositoryId, lineageId: repositoryId }));

let locations: typeof import('../../src/services/project/repository/lifecycle/repositoryLocations');
// The module graph behind repositoryLocations is large; importing it can take far longer than one test's budget.
beforeAll(async () => { locations = await import('../../src/services/project/repository/lifecycle/repositoryLocations'); }, 180_000);

describe('shared probe backend of a project folder', () => {
  it('opens the replaced project of a folder instead of a stale descriptor of the previous one', async () => {
    const { isLegacyProjectLocation, prepareRepositoryOpen } = locations;
    const location = { kind: 'fsa' as const, handle: { kind: 'directory', name: 'Replaced' } as unknown as FileSystemDirectoryHandle };
    folder.files = new Map([['project.msrepo.json', descriptor('first')]]);
    expect(await isLegacyProjectLocation(location)).toBe(false);
    expect((await prepareRepositoryOpen(location, 'workspace')).options.descriptor.repositoryId).toBe('first');
    // Outside the app, the project is deleted and a new one is created in the same folder.
    folder.files = new Map([['project.msrepo.json', descriptor('second')]]);
    expect(await isLegacyProjectLocation(location)).toBe(false);
    expect((await prepareRepositoryOpen(location, 'workspace')).options.descriptor.repositoryId).toBe('second');
  });

  it('does not answer an open with a probe taken before the project was created there', async () => {
    const { isLegacyProjectLocation, prepareNewRepository, prepareRepositoryOpen } = locations;
    const location = { kind: 'fsa' as const, handle: { kind: 'directory', name: 'Created' } as unknown as FileSystemDirectoryHandle };
    folder.files = new Map();
    expect(await isLegacyProjectLocation(location)).toBe(false);
    const prepared = await prepareNewRepository(location, 'workspace');
    // The storage worker writes the new descriptor.
    folder.files = new Map([['project.msrepo.json', descriptor(prepared.options.descriptor.repositoryId)]]);
    expect((await prepareRepositoryOpen(location, 'workspace')).options.descriptor.repositoryId).toBe(prepared.options.descriptor.repositoryId);
  });
});
