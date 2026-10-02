import { describe, it, expect } from 'vitest';
import type { RepositoryBackend, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { WorkspaceViewStore } from '../../src/services/project/repository/workspace/WorkspaceViewStore';
import { readProjectWorkspace, splitProjectWorkspace } from '../../src/services/project/repository/lifecycle/workspaceProjection';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

const owner: RepositoryOwner = { writerEpoch: 'writer', assertOwned() {}, async release() {} };
function memory() {
  const files = new Map<string, Uint8Array>(); let stats = 0;
  const collect = async (chunks: AsyncIterable<Uint8Array>) => { const parts: Uint8Array[] = []; for await (const part of chunks) parts.push(part); return Uint8Array.from(parts.flatMap(part => [...part])); };
  const backend = { locationId: 'views', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async list(prefix: string, cursor?: string, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null }; },
    async read(path: string, offset = 0, length?: number) { const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async stat(path: string) { stats++; return files.has(path) ? { length: files.get(path)!.length } : null; },
    async writeNew(path: string, chunks: AsyncIterable<Uint8Array>) { files.set(path, await collect(chunks)); },
    async replaceViewSlot(path: string, chunks: AsyncIterable<Uint8Array>) { files.set(path, await collect(chunks)); },
    async removeUnpublished(path: string) { files.delete(path); },
  } as unknown as RepositoryBackend;
  return { backend, stats: () => stats };
}

describe('workspace view key listing', () => {
  it('lists stored and pending keys, including encoded names, without probing each candidate', async () => {
    const { backend, stats } = memory();
    const writer = new WorkspaceViewStore(backend, owner, 'repo', 'workspace');
    writer.update('codec/resolvers/media/project/a b', { path: 'Video/a.mp4' });
    writer.update('timeline/comp/playheadPosition', 12);
    await writer.flush();
    const reader = new WorkspaceViewStore(backend, owner, 'repo', 'workspace');
    const before = stats();
    expect((await reader.keys()).toSorted()).toEqual(['codec/resolvers/media/project/a b', 'timeline/comp/playheadPosition']);
    expect(stats()).toBe(before);
    reader.update('media/selectedIds', ['x']);
    expect(await reader.keys()).toContain('media/selectedIds');
    expect(await reader.read('codec/resolvers/media/project/a b')).toEqual({ path: 'Video/a.mp4' });
  });

  it('keeps the previous complete project shape when a new part write is interrupted', async () => {
    const { backend } = memory();
    const writer = new WorkspaceViewStore(backend, owner, 'repo', 'workspace');
    writer.update('old-part', { restored: 'previous workspace' });
    writer.update('project', { $workspaceShape: { $workspacePart: 'old-part' } });
    await writer.flush();
    const replace = backend.replaceViewSlot;
    backend.replaceViewSlot = async (path, chunks, signal) => {
      if (path.includes('/new-part/')) throw new RepositoryError('io', 'Interrupted part write');
      return replace(path, chunks, signal);
    };
    writer.update('new-part', { restored: 'new workspace' });
    writer.update('project', { $workspaceShape: { $workspacePart: 'new-part' } });
    await expect(writer.flush()).rejects.toThrow('Interrupted part write');
    const reader = new WorkspaceViewStore(backend, owner, 'repo', 'workspace');
    const session = { readView: (key: string, previous?: boolean) => reader.read(key, previous) } as RepositorySession;
    expect(await readProjectWorkspace(session)).toEqual({ restored: 'previous workspace' });
  });

  it('recovers an older complete workspace behind an already-published incomplete shape', async () => {
    const { backend } = memory();
    const writer = new WorkspaceViewStore(backend, owner, 'repo', 'workspace');
    writer.update('old-part', { restored: 'previous workspace' });
    writer.update('project', { $workspaceShape: { $workspacePart: 'old-part' } });
    await writer.flush();
    writer.update('project', { $workspaceShape: { $workspacePart: 'missing-part' } });
    await writer.flush();
    const reader = new WorkspaceViewStore(backend, owner, 'repo', 'workspace');
    const session = { readView: (key: string, previous?: boolean) => reader.read(key, previous) } as RepositorySession;
    expect(await readProjectWorkspace(session)).toEqual({ restored: 'previous workspace' });
    expect(reader.update('project', { repaired: true })).toBe(3);
    await reader.flush();
  });

  it('retains null workspace fields inline when splitting a large workspace', () => {
    const parts = splitProjectWorkspace({ first: 'a'.repeat(600000), second: 'b'.repeat(600000), optional: null });
    expect(parts.some(part => part.value === null)).toBe(false);
    expect(parts.at(-1)?.value).toMatchObject({ $workspaceShape: { optional: null } });
  });
});
