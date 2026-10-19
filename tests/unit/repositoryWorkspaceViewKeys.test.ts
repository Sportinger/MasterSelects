import { describe, it, expect } from 'vitest';
import type { RepositoryBackend, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { WorkspaceViewStore } from '../../src/services/project/repository/workspace/WorkspaceViewStore';
import { readProjectWorkspace, splitProjectWorkspace } from '../../src/services/project/repository/lifecycle/workspaceProjection';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

const owner: RepositoryOwner = { writerEpoch: 'writer', assertOwned() {}, async release() {} };
function memory() {
  const files = new Map<string, Uint8Array>(), times = new Map<string, number>(); let stats = 0, clock = 0;
  const collect = async (chunks: AsyncIterable<Uint8Array>) => { const parts: Uint8Array[] = []; for await (const part of chunks) parts.push(part); return Uint8Array.from(parts.flatMap(part => [...part])); };
  const backend = { locationId: 'views', capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async list(prefix: string, cursor?: string, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null }; },
    async read(path: string, offset = 0, length?: number) { const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async stat(path: string) { stats++; return files.has(path) ? { length: files.get(path)!.length, modifiedTime: times.get(path) } : null; },
    async writeNew(path: string, chunks: AsyncIterable<Uint8Array>) { files.set(path, await collect(chunks)); times.set(path, ++clock); },
    async replaceViewSlot(path: string, chunks: AsyncIterable<Uint8Array>) { files.set(path, await collect(chunks)); times.set(path, ++clock); },
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

describe('workspace view inheritance', () => {
  async function write(backend: RepositoryBackend, workspaceId: string, values: Record<string, unknown>) {
    const writer = new WorkspaceViewStore(backend, owner, 'repo', workspaceId);
    for (const [key, value] of Object.entries(values)) writer.update(key, value as never);
    await writer.flush();
  }

  it('reopens saved media locations that an earlier tab stored in its own workspace', async () => {
    const { backend } = memory();
    await write(backend, 'closed-tab', { 'codec/resolvers/media/project/totale': { sourceRootId: 'root:drive', sourceRelativePath: 'MS UTE/Totale.MXF' } });
    await write(backend, 'other-repo-tab', {});
    const reopened = new WorkspaceViewStore(backend, owner, 'repo', 'new-tab');

    expect(await reopened.keys()).toContain('codec/resolvers/media/project/totale');
    expect(await reopened.read('codec/resolvers/media/project/totale')).toEqual({ sourceRootId: 'root:drive', sourceRelativePath: 'MS UTE/Totale.MXF' });
    // The first own write starts this workspace's sequence; the earlier workspace stays untouched.
    expect(reopened.update('codec/resolvers/media/project/totale', { sourceRootId: 'root:moved', sourceRelativePath: 'Totale.MXF' })).toBe(1);
    await reopened.flush();
    expect(await new WorkspaceViewStore(backend, owner, 'repo', 'closed-tab').read('codec/resolvers/media/project/totale'))
      .toEqual({ sourceRootId: 'root:drive', sourceRelativePath: 'MS UTE/Totale.MXF' });
  });

  it('prefers own values and otherwise the most recently written workspace', async () => {
    const { backend } = memory();
    await write(backend, 'oldest', { layout: 'oldest', playhead: 1 });
    await write(backend, 'newer', { layout: 'newer' });
    await write(backend, 'current', { playhead: 9 });
    const current = new WorkspaceViewStore(backend, owner, 'repo', 'current');

    expect(await current.read('layout')).toBe('newer');
    expect(await current.read('playhead')).toBe(9);
    expect(await current.read('missing')).toBeNull();
  });

  it('takes project workspace parts only from the workspace that supplied the shape', async () => {
    const { backend } = memory();
    await write(backend, 'earlier', { 'project/part/a': { restored: 'earlier' }, project: { $workspaceShape: { $workspacePart: 'project/part/a' } } });
    await write(backend, 'stray', { 'project/part/a': { restored: 'stray' } });
    const inheriting = new WorkspaceViewStore(backend, owner, 'repo', 'fresh');
    const session = (store: WorkspaceViewStore) => ({ readView: (key: string, previous?: boolean) => store.read(key, previous) }) as RepositorySession;
    expect(await readProjectWorkspace(session(inheriting))).toEqual({ restored: 'earlier' });

    // An own shape whose part is missing recovers its own previous shape, never a foreign part.
    const own = new WorkspaceViewStore(backend, owner, 'repo', 'own');
    own.update('project/part/old', { restored: 'own previous' });
    own.update('project', { $workspaceShape: { $workspacePart: 'project/part/old' } });
    await own.flush();
    own.update('project', { $workspaceShape: { $workspacePart: 'project/part/a' } });
    await own.flush();
    expect(await readProjectWorkspace(session(new WorkspaceViewStore(backend, owner, 'repo', 'own')))).toEqual({ restored: 'own previous' });
  });
});
