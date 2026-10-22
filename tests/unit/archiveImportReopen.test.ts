import { describe, expect, it } from 'vitest';
import type { EntityDTO, RepositoryBackend, RepositoryDescriptor, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { canonicalBytes, hashBytes } from '../../src/services/project/repository/segments/canonical';
import { blobPath, storeBlob } from '../../src/services/project/repository/persistence/blobStorage';
import { RecordTransplant } from '../../src/services/project/repository/archive/recordTransplant';
import { exportRepositoryArchive } from '../../src/services/project/repository/archive/archiveTransport';
import { writeZip } from '../../src/services/project/repository/archive/streamZip';
import { archiveManifestProjectName, probeRepositoryArchiveManifest } from '../../src/services/project/repository/archive/archiveManifestProbe';
import type { RepositoryLocation } from '../../src/services/project/repository/storageWorkerProtocol';
import {
  assertLegacyImportComplete, hasResumableInPlaceImport, isLegacyProjectBackend, prepareLegacyImport,
} from '../../src/services/project/repository/lifecycle/legacyImportPreparation';

// Live AWS run: an imported .msproj opened once, then every later open failed with
// "Legacy source has no project state". The archive restore recorded no finished import.

const owner: RepositoryOwner = { writerEpoch: 'test-owner', assertOwned() {}, async release() {} };
const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'source-repository', lineageId: 'lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };

function memory(locationId: string) {
  const files = new Map<string, Uint8Array>();
  const collect = async (chunks: AsyncIterable<Uint8Array>) => {
    const parts: Uint8Array[] = []; let size = 0; for await (const part of chunks) { parts.push(part); size += part.length; }
    const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
  };
  const backend: RepositoryBackend = { locationId, capabilities: { rangeReads: true, immutableWrites: true, replaceViewSlots: true, ownership: true, durability: 'stream-close' },
    async acquireOwner() { return owner; },
    async list(prefix, cursor, limit = 128) { const names = [...files.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).toSorted(); const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null }; },
    async read(path, offset = 0, length) { const bytes = files.get(path); if (!bytes) throw new RepositoryError('io', 'Missing test file'); return bytes.slice(offset, length === undefined ? undefined : offset + length); },
    async stat(path) { return files.has(path) ? { length: files.get(path)!.length } : null; },
    async writeNew(path, chunks, signal) { signal?.throwIfAborted(); if (files.has(path)) throw new RepositoryError('conflict', 'Existing immutable file'); files.set(path, await collect(chunks)); },
    async replaceViewSlot(path, chunks) { files.set(path, await collect(chunks)); },
    async removeUnpublished(path) { files.delete(path); },
  };
  return { backend, files };
}
async function* chunks(bytes: Uint8Array) { yield bytes; }
function joined(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** A self-contained repository archive with one embedded original, as File > Export .msproj writes it. */
async function repositoryArchive(projectName?: string) {
  const source = memory('source'); source.files.set('project.msrepo.json', canonicalBytes(descriptor));
  const original = new TextEncoder().encode('embedded original media bytes');
  const identity = { hash: await hashBytes(original), length: original.length };
  await storeBlob(source.backend, owner, identity, chunks(original));
  const transport = new RecordTransplant(source.backend, source.backend, descriptor, owner);
  const entity: EntityDTO = { type: 'fixture', schemaVersion: 1, value: { edited: true }, references: [], blobs: [identity] };
  const reference = await transport.add({ kind: 'object', schemaVersion: 1, payload: entity as never, references: [], blobs: [identity] });
  const revision = await transport.add({ kind: 'revision', schemaVersion: 1, payload: { revisionId: 'initial', transactionId: 'tx', parent: null, parentRevisionId: null, label: 'Initial', source: 'user', createdAt: 1, changes: [{ entityKey: 'fixture', before: null, after: reference }] } as never, references: [reference], blobs: [] });
  const pin = await transport.finish({ content: revision });
  const output: Uint8Array[] = [];
  await exportRepositoryArchive(source.backend, descriptor, pin, memory('export-staging').backend, owner,
    { targetRepositoryId: 'archive-repository', history: { kind: 'current', revision }, journals: 'none', workspace: [], media: 'linked', projectName },
    async chunk => { output.push(chunk.slice()); });
  return { bytes: joined(output), identity };
}

/** A browser-storage project folder holding only the copied archive, as the archive import creates it. */
async function importedFolder(projectName?: string) {
  const archive = await repositoryArchive(projectName);
  const folder = memory('folder:Show');
  folder.files.set('Show.msproj', archive.bytes);
  const staging = memory('staging');
  const backendFor = async (location: RepositoryLocation) => location.kind === 'opfs' && location.path.startsWith('repository-archive-staging/') ? staging.backend : folder.backend;
  const request = { source: { ...folder.backend, sourceId: 'folder:Show' }, sourceHandle: null, target: { kind: 'opfs', path: 'Show' } as RepositoryLocation,
    inPlace: true, workspaceId: 'workspace', backendFor, removeStaging: async () => { staging.files.clear(); } };
  return { ...archive, folder, request };
}

const completion = (files: Map<string, Uint8Array>) => [...files].filter(([path]) => /^\.masterselects\/imports\/[^/]+\/complete\.json$/.test(path))
  .map(([, bytes]) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>);

describe('.msproj archive import becomes an ordinary repository project', () => {
  it('records a finished import, so later opens never treat the folder as an unconverted package', async () => {
    const { folder, request, identity } = await importedFolder('Show');
    const { descriptor: restored } = await prepareLegacyImport(request);
    expect(folder.files.has('project.msrepo.json')).toBe(true);
    expect(folder.files.has(blobPath(identity.hash))).toBe(true);
    const [marker] = completion(folder.files);
    expect(marker).toMatchObject({ kind: 'repository-archive', package: 'Show.msproj', repositoryId: restored.repositoryId });
    expect(marker.commit).toBeTruthy();
    expect(await isLegacyProjectBackend(folder.backend)).toBe(false);
    expect(await hasResumableInPlaceImport(folder.backend)).toBe(false);
    await expect(assertLegacyImportComplete(folder.backend)).resolves.toBeUndefined();
  });

  it('still opens after the archive copy was removed from the folder', async () => {
    const { folder, request } = await importedFolder('Show');
    await prepareLegacyImport(request);
    folder.files.delete('Show.msproj');
    expect(await isLegacyProjectBackend(folder.backend)).toBe(false);
    expect(await hasResumableInPlaceImport(folder.backend)).toBe(false);
  });

  it('refuses a restore that stopped before its commit instead of opening a half-built project', async () => {
    const { folder, request } = await importedFolder('Show');
    // Interrupted copy: the binding and the repository descriptor exist, the commit does not.
    folder.files.set('.masterselects/imports/interrupted/target.json', canonicalBytes({ kind: 'repository-archive', sourceId: 'folder:Show' }));
    folder.files.set('project.msrepo.json', canonicalBytes({ ...descriptor, repositoryId: 'partial' }));
    expect(await hasResumableInPlaceImport(folder.backend)).toBe(true);
    await expect(prepareLegacyImport(request)).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('did not finish') });
  });
});

describe('archive manifest probe', () => {
  it('reads the recorded project name from the ZIP directory without extracting the archive', async () => {
    const { bytes } = await repositoryArchive('Opera Night');
    const probe = await probeRepositoryArchiveManifest(new Blob([bytes]));
    expect(probe.kind).toBe('repository-archive');
    expect(archiveManifestProjectName(probe)).toBe('Opera Night');
  });

  it('falls back for archives without a name, old packages and foreign files', async () => {
    expect(archiveManifestProjectName(await probeRepositoryArchiveManifest(new Blob([(await repositoryArchive()).bytes])))).toBeNull();
    const output: Uint8Array[] = [];
    async function* entries() { yield { path: 'project.json', chunks: chunks(new TextEncoder().encode('{}')) }; }
    await writeZip(entries(), async chunk => { output.push(chunk.slice()); });
    expect(await probeRepositoryArchiveManifest(new Blob([joined(output)]))).toMatchObject({ kind: 'none', reason: 'archive has no repository manifest' });
    expect(await probeRepositoryArchiveManifest(new Blob(['not a zip archive at all, just text']))).toMatchObject({ kind: 'none' });
  });
});
