import { describe, expect, it, vi } from 'vitest';
import type { RepositoryBackend, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { writeZip } from '../../src/services/project/repository/archive/streamZip';
import type { RepositoryLocation } from '../../src/services/project/repository/storageWorkerProtocol';
import { prepareLegacyImport } from '../../src/services/project/repository/lifecycle/legacyImportPreparation';

// Live AWS run: Cancel in the browser Open Project dialog did not stop a running .msproj
// import, and every restored archive left a full copy in repository-archive-staging/.

const owner: RepositoryOwner = { writerEpoch: 'test-owner', assertOwned() {}, async release() {} };
function memory(locationId: string, onWrite?: (path: string) => void) {
  const files = new Map<string, Uint8Array>(); const reads: string[] = [];
  const collect = async (chunks: AsyncIterable<Uint8Array>) => {
    const parts: Uint8Array[] = []; let size = 0; for await (const part of chunks) { parts.push(part); size += part.length; }
    const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
  };
  const backend: RepositoryBackend = { locationId, capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null }; },
    async read(path, offset = 0, length) { reads.push(path); const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing test file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async stat(path) { return files.has(path) ? { length: files.get(path)!.length } : null; },
    async writeNew(path, chunks, signal) { onWrite?.(path); signal?.throwIfAborted(); files.set(path, await collect(chunks)); },
    async replaceViewSlot(path, chunks) { files.set(path, await collect(chunks)); },
    async removeUnpublished(path) { files.delete(path); },
  };
  return { backend, files, reads };
}
async function zip(entries: Array<[string, Uint8Array]>): Promise<Uint8Array> {
  const output: Uint8Array[] = [];
  async function* items() { for (const [path, bytes] of entries) yield { path, length: bytes.length, chunks: (async function* () { yield bytes; })() }; }
  await writeZip(items(), async chunk => { output.push(chunk.slice()); });
  const result = new Uint8Array(output.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of output) { result.set(part, offset); offset += part.length; }
  return result;
}

/** A browser-storage project folder holding a repository archive whose manifest is unreadable. */
async function archiveFolder(onStagingWrite?: (path: string) => void) {
  const folder = memory('folder:Show');
  const segment = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, index) => (index * 31) % 251);
  folder.files.set('Show.msproj', await zip([['.masterselects/segments/a.bin', segment], ['archive-manifest.json', new TextEncoder().encode('not json')]]));
  const staging = memory('staging', onStagingWrite);
  const removeStaging = vi.fn(async (path: string) => { expect(path).toMatch(/^repository-archive-staging\//); staging.files.clear(); });
  const backendFor = async (location: RepositoryLocation) => location.kind === 'opfs' && location.path.startsWith('repository-archive-staging/') ? staging.backend : folder.backend;
  const request = { source: { ...folder.backend, sourceId: 'folder:Show' }, sourceHandle: null, target: { kind: 'opfs', path: 'Show' } as RepositoryLocation,
    inPlace: true, workspaceId: 'workspace', backendFor, removeStaging };
  return { folder, staging, removeStaging, request };
}

describe('.msproj archive import cleanup and cancellation', () => {
  it('stops reading a repository archive as an old package at its first repository entry', async () => {
    const { folder, request } = await archiveFolder();
    await expect(prepareLegacyImport(request)).rejects.toMatchObject({ code: 'corrupt' });
    const chunks = Math.ceil(folder.files.get('Show.msproj')!.length / (256 * 1024));
    // Identity digest + restore read the whole archive; the old-package probe stops within its first chunks
    // instead of buffering the whole archive in memory (3 full reads before).
    expect(folder.reads.filter(path => path === 'Show.msproj').length).toBeLessThanOrEqual(2 * chunks + 2);
  });

  it('removes the restore staging after a failed in-place import, keeps it for a resumable one', async () => {
    const inPlace = await archiveFolder();
    await expect(prepareLegacyImport(inPlace.request)).rejects.toMatchObject({ code: 'corrupt' });
    expect(inPlace.removeStaging).toHaveBeenCalledOnce();
    expect(inPlace.staging.files.size).toBe(0);

    const separate = await archiveFolder();
    const target = memory('target');
    const backendFor = async (location: RepositoryLocation) => location.kind === 'opfs' && location.path === 'Converted' ? target.backend : separate.request.backendFor(location);
    await expect(prepareLegacyImport({ ...separate.request, inPlace: false, target: { kind: 'opfs', path: 'Converted' }, backendFor })).rejects.toMatchObject({ code: 'corrupt' });
    expect(separate.removeStaging).not.toHaveBeenCalled();
    expect(separate.staging.files.size).toBeGreaterThan(0);
  });

  it('cancels a running restore through its signal and removes the staging', async () => {
    const controller = new AbortController();
    const { removeStaging, staging, request } = await archiveFolder(() => controller.abort());
    await expect(prepareLegacyImport({ ...request, inPlace: false, signal: controller.signal,
      backendFor: async location => location.kind === 'opfs' && location.path.startsWith('repository-archive-staging/') ? staging.backend : memory('target').backend,
      target: { kind: 'opfs', path: 'Converted' } })).rejects.toMatchObject({ code: 'cancelled' });
    // Even a resumable (separate-folder) import drops its staging when the person cancelled it.
    expect(removeStaging).toHaveBeenCalledOnce();
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController(); controller.abort();
    const { folder, request } = await archiveFolder();
    await expect(prepareLegacyImport({ ...request, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(folder.reads).toEqual([]);
  });
});
