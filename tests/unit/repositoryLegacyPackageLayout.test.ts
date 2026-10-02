import { describe, it, expect } from 'vitest';
import type { RepositoryBackend, RepositoryDescriptor, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { canonicalBytes, hashBytes } from '../../src/services/project/repository/segments/canonical';
import { writeZip } from '../../src/services/project/repository/archive/streamZip';
import { legacyLogicalPath, legacyPhysicalCandidates, legacySourceRole } from '../../src/services/project/repository/import/legacyPackageLayout';
import { openLegacySource } from '../../src/services/project/repository/import/legacySource';
import { importLegacyRepository } from '../../src/services/project/repository/import/legacyImport';
import { recoverRepository } from '../../src/services/project/repository/persistence/recovery';
import { materializeProjection } from '../../src/services/project/repository/persistence/projection';
import { createRepositoryProject } from '../../src/services/project/repository/lifecycle/defaultProject';
import { decodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { blobPath } from '../../src/services/project/repository/persistence/blobStorage';
import type { JsonValue } from '../../src/services/project/repository/contracts';
import type { RepositoryLocation } from '../../src/services/project/repository/storageWorkerProtocol';
import { assertLegacyImportComplete, prepareLegacyImport } from '../../src/services/project/repository/lifecycle/legacyImportPreparation';

/** Reassembles the imported workspace views (resolver fields live there, not in content). */
async function readWorkspace(files: Map<string, Uint8Array>): Promise<JsonValue> {
  const view = (key: string) => { const bytes = files.get(`.masterselects/views/workspace/${encodeURIComponent(key)}/a.json`); return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { value: JsonValue }).value : null; };
  const restore = (value: JsonValue): JsonValue => !value || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(restore)
    : typeof value.$workspacePart === 'string' ? view(value.$workspacePart) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, restore(child)]));
  const root = view('project') as { $workspaceShape?: JsonValue } | null;
  return root && '$workspaceShape' in root ? restore(root.$workspaceShape!) : root ?? {};
}

const owner: RepositoryOwner = { writerEpoch: 'test-owner', assertOwned() {}, async release() {} };
const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'layout-repository', lineageId: 'layout-lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
function memory(locationId: string) {
  const files = new Map<string, Uint8Array>(); const writes: string[] = [];
  const collect = async (chunks: AsyncIterable<Uint8Array>) => {
    const parts: Uint8Array[] = []; let size = 0; for await (const part of chunks) { parts.push(part); size += part.length; }
    const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
  };
  const backend: RepositoryBackend = { locationId, capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null }; },
    async read(path, offset = 0, length) { const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing test file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async stat(path) { return files.has(path) ? { length: files.get(path)!.length } : null; },
    async writeNew(path, chunks, signal) { signal?.throwIfAborted(); if (files.has(path)) throw new RepositoryError('conflict', 'Existing immutable file'); files.set(path, await collect(chunks)); writes.push(path); },
    async replaceViewSlot(path, chunks) { files.set(path, await collect(chunks)); writes.push(path); },
    async removeUnpublished(path) { files.delete(path); },
  };
  return { backend, files, writes };
}
async function zip(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  const output: Uint8Array[] = [];
  async function* items() { for (const [path, bytes] of Object.entries(entries)) yield { path, length: bytes.length, chunks: (async function* () { yield bytes; })() }; }
  await writeZip(items(), async chunk => { output.push(chunk.slice()); });
  const result = new Uint8Array(output.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of output) { result.set(part, offset); offset += part.length; }
  return result;
}

describe('legacy package physical layout', () => {
  it('maps logical package paths to the media folder and its hidden cache like the old loader', () => {
    expect(legacyPhysicalCandidates('Raw/Video/a.mp4', 'My Media')).toEqual(['My Media/Video/a.mp4', 'Raw/Video/a.mp4']);
    expect(legacyPhysicalCandidates('Raw/Baked Audio/b.wav', 'My Media')[0]).toBe('My Media/Baked Audio/b.wav');
    expect(legacyPhysicalCandidates('Cache/artifacts/sha256/ab/x/artifact.bin', 'My Media')[0]).toBe('My Media/.masterselects-cache/artifacts/sha256/ab/x/artifact.bin');
    expect(legacyPhysicalCandidates('Cache/thumbnails/t.jpg', 'My Media')[0]).toBe('My Media/.masterselects-cache/thumbnails/t.jpg');
    expect(legacyPhysicalCandidates('Proxy/m/frame.webp', 'My Media')[0]).toBe('My Media/.masterselects-cache/Proxy/m/frame.webp');
    expect(legacyPhysicalCandidates('Audio Proxies/a.m4a', 'My Media')[0]).toBe('My Media/.masterselects-cache/Audio Proxies/a.m4a');
    expect(legacyPhysicalCandidates('Renders/out.mp4', 'My Media')[0]).toBe('My Media/Renders/out.mp4');
    expect(legacyPhysicalCandidates('Geometry/terrain/t.json.gz', 'My Media')[0]).toBe('My Media/Geometry/terrain/t.json.gz');
    expect(legacyPhysicalCandidates('Documents/doc.json', 'My Media')).toEqual(['Documents/doc.json']);
    // Auto-migrated projects keep the logical layout except linked artifacts/terrain.
    expect(legacyPhysicalCandidates('Raw/Video/a.mp4', 'Raw')).toEqual(['Raw/Video/a.mp4']);
    expect(legacyPhysicalCandidates('Cache/artifacts/sha256/ab/x/artifact.bin', 'Raw')[0]).toBe('Raw/.masterselects-cache/artifacts/sha256/ab/x/artifact.bin');
  });

  it('lists physical files under their logical package names', () => {
    expect(legacyLogicalPath('My Media/Video/a.mp4', 'My Media')).toBe('Raw/Video/a.mp4');
    expect(legacyLogicalPath('My Media/Baked Audio/b.wav', 'My Media')).toBe('Raw/Baked Audio/b.wav');
    expect(legacyLogicalPath('My Media/.masterselects-cache/artifacts/sha256/ab/x/artifact.bin', 'My Media')).toBe('Cache/artifacts/sha256/ab/x/artifact.bin');
    expect(legacyLogicalPath('My Media/.masterselects-cache/Proxy/m/frame.webp', 'My Media')).toBe('Proxy/m/frame.webp');
    expect(legacyLogicalPath('My Media/.masterselects-cache/Backups/project.msproj', 'My Media')).toBe('Backups/project.msproj');
    expect(legacyLogicalPath('My Media/Renders/out.mp4', 'My Media')).toBe('Renders/out.mp4');
    expect(legacyLogicalPath('Documents/doc.json', 'My Media')).toBe('Documents/doc.json');
    expect(legacyLogicalPath('My.msproj', 'My Media')).toBeNull();
    expect(legacyLogicalPath('My.before-audio.msproj.bak', 'My Media')).toBeNull();
    expect(legacyLogicalPath('Unrelated/notes.txt', 'My Media')).toBeNull();
    expect(legacySourceRole('My.msproj', 'My Media', 'My.msproj')).toBe('imported');
    expect(legacySourceRole('My.before-audio.msproj.bak', 'My Media', 'My.msproj')).toBe('ignored');
    expect(legacySourceRole('My Media/Video/a.mp4', 'My Media', 'My.msproj')).toBe('linked');
    expect(legacySourceRole('Documents/doc.json', 'My Media', 'My.msproj')).toBe('imported');
    expect(legacySourceRole('Footage/huge.mov', 'Raw', null)).toBe('ignored');
    expect(legacySourceRole('project.json', 'Raw', null)).toBe('imported');
    expect(legacySourceRole('Raw/clip.mov', 'Raw', null)).toBe('linked');
    for (const path of ['Raw/Video/a.mp4', 'Cache/artifacts/sha256/ab/x/artifact.bin', 'Proxy/m/frame.webp', 'Renders/out.mp4', 'Documents/doc.json'])
      expect(legacyLogicalPath(legacyPhysicalCandidates(path, 'My Media')[0], 'My Media')).toBe(path);
  });

  it('links raw media in place, resolves package artifacts and root documents without writing to the source', async () => {
    const source = memory('packaged-source'), target = memory('packaged-target');
    const artifact = new TextEncoder().encode('linked artifact bytes'); const artifactHash = (await hashBytes(artifact)).slice('sha256:'.length);
    const artifactEntry = `Cache/artifacts/sha256/${artifactHash.slice(0, 2)}/${artifactHash}/artifact.bin`;
    const video = new Uint8Array([1, 2, 3, 4, 5]);
    const project = createRepositoryProject('Packaged');
    project.media = [{ id: 'video', name: 'a.mp4', type: 'video', sourcePath: 'a.mp4', projectPath: 'Raw/Video/a.mp4', hasProxy: false, folderId: null, importedAt: project.createdAt },
      { id: 'elsewhere', name: 'b.mp4', type: 'video', sourcePath: 'b.mp4', projectPath: 'Raw/Video/b.mp4', hasProxy: false, folderId: null, importedAt: project.createdAt }];
    const manifest = { format: 'masterselects-project', formatVersion: 1, projectSchemaVersion: 1, projectName: 'Packaged', mediaFolderName: 'My Media', linkedArtifactEntries: [artifactEntry] };
    source.files.set('My.msproj', await zip({ 'manifest.json': canonicalBytes(manifest), 'project.json': canonicalBytes(project) }));
    source.files.set('My.before-audio.msproj.bak', new Uint8Array([9]));
    source.files.set(`My Media/.masterselects-cache/artifacts/sha256/${artifactHash.slice(0, 2)}/${artifactHash}/artifact.bin`, artifact);
    source.files.set('My Media/Video/a.mp4', video);
    source.files.set('Documents/doc.json', canonicalBytes({ title: 'Root document' }));
    const original = new Map([...source.files].map(([path, bytes]) => [path, bytes.slice()]));

    const bundle = await openLegacySource({ ...source.backend, sourceId: 'packaged-source' }, { kind: 'package', path: 'My.msproj' }, { staging: target.backend, importId: 'packaged' });
    expect(bundle.provenance.missingRequired).toEqual([]);
    const listed = (await bundle.list('', undefined, 1024)).paths;
    expect(listed).toEqual(expect.arrayContaining([artifactEntry, 'Raw/Video/a.mp4', 'Documents/doc.json', 'manifest.json', 'project.json']));
    expect(listed.some(path => path.endsWith('.msproj') || path.endsWith('.bak') || path.startsWith('My Media/'))).toBe(false);
    expect(await bundle.stat(artifactEntry)).toEqual({ length: artifact.length });
    expect(await bundle.linkedPath('Raw/Video/a.mp4')).toBe('My Media/Video/a.mp4');
    expect(await bundle.linkedPath('Documents/doc.json')).toBeNull();

    const root = { id: 'source-root:legacy-packaged', name: 'My Project' };
    await importLegacyRepository(bundle, descriptor, target.backend, owner, { importId: 'packaged', workspaceId: 'workspace', mediaSourceRoot: root });
    const recovered = await recoverRepository(target.backend, descriptor);
    const projection = await materializeProjection(target.backend, recovered.heads.content, recovered.checkpoints);
    const restored = decodeProjectDomains(projection.entities, await readWorkspace(target.files));
    // Linked media keep their bytes in the old folder: no copy, no full-content identity.
    expect(projection.entities.has('source-identity:video')).toBe(false);
    expect(target.files.has(blobPath(await hashBytes(video)))).toBe(false);
    expect(restored.media.find(item => item.id === 'video')).toMatchObject({ sourceRootId: root.id, sourceRelativePath: 'My Media/Video/a.mp4', projectPath: 'Raw/Video/a.mp4' });
    expect(restored.media.find(item => item.id === 'elsewhere')?.sourceRootId).toBeUndefined();
    expect(restored.mediaSourceRoots).toEqual([root]);
    expect(target.files.has(blobPath(await hashBytes(artifact)))).toBe(false);
    expect([...source.files]).toEqual([...original]); expect(source.writes).toEqual([]);
  });

  it('proves the source by package bytes and linked sizes, not by re-reading linked media', async () => {
    const source = memory('proof-source'), target = memory('proof-target');
    const project = createRepositoryProject('Proof');
    source.files.set('My.msproj', await zip({ 'manifest.json': canonicalBytes({ format: 'masterselects-project', formatVersion: 1, projectSchemaVersion: 1, mediaFolderName: 'My Media' }), 'project.json': canonicalBytes(project) }));
    source.files.set('My Media/Video/a.mp4', new Uint8Array([1, 2, 3]));
    let linkedReads = 0; const read = source.backend.read.bind(source.backend);
    const reader = { ...source.backend, sourceId: 'proof-source', read: (path: string, offset?: number, length?: number) => { if (path.startsWith('My Media/')) linkedReads++; return read(path, offset, length); } };
    const bundle = await openLegacySource(reader, { kind: 'package', path: 'My.msproj' }, { staging: target.backend, importId: 'proof' });
    await importLegacyRepository(bundle, descriptor, target.backend, owner, { importId: 'proof', workspaceId: 'workspace' });
    expect(linkedReads).toBe(0);
    source.files.set('My Media/Video/a.mp4', new Uint8Array([1, 2, 3, 4]));
    await expect(bundle.assertUnchanged()).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('legacy conversion target folder', () => {
  it('converts into an empty chosen folder, resumes the same source there and refuses other folders', async () => {
    const folders = new Map<string, ReturnType<typeof memory>>();
    const folder = (path: string) => { if (!folders.has(path)) folders.set(path, memory('folder:' + path)); return folders.get(path)!; };
    const backendFor = async (location: RepositoryLocation) => folder(location.kind === 'fsa' ? location.handle.name : location.path).backend;
    const source = memory('old-folder'); source.files.set('project.json', canonicalBytes(createRepositoryProject('Old')));
    const request = (path: string) => ({ source: { ...source.backend, sourceId: 'old-folder' }, sourceHandle: null, target: { kind: 'opfs', path } as RepositoryLocation, workspaceId: 'workspace', backendFor });
    folder('occupied').files.set('notes.txt', new Uint8Array([1]));
    await expect(prepareLegacyImport(request('occupied'))).rejects.toMatchObject({ code: 'conflict' });
    const converted = await prepareLegacyImport(request('converted'));
    expect(converted.location).toEqual({ kind: 'opfs', path: 'converted' });
    await expect(assertLegacyImportComplete(folder('converted').backend)).resolves.toBeUndefined();
    const resumed = await prepareLegacyImport(request('converted'));
    expect(resumed.descriptor.repositoryId).toBe(converted.descriptor.repositoryId);
    const other = memory('other-old-folder'); other.files.set('project.json', canonicalBytes(createRepositoryProject('Other')));
    await expect(prepareLegacyImport({ ...request('converted'), source: { ...other.backend, sourceId: 'other-old-folder' } })).rejects.toMatchObject({ code: 'conflict' });
    const complete = [...folder('converted').files.keys()].find(path => path.endsWith('/complete.json'))!;
    folder('converted').files.delete(complete);
    await expect(assertLegacyImportComplete(folder('converted').backend)).rejects.toMatchObject({ code: 'conflict' });
    expect(source.writes).toEqual([]);
  });
});
