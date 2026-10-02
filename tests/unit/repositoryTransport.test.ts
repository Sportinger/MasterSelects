import type { ProjectFile } from '../../src/services/project/types/project.types';
import { normalizeLegacyAudioCaches } from '../../src/services/project/repository/import/legacyAudioCaches';
import { decodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import type { ArtifactManifest } from '../../src/artifacts/types';
import { buildArtifactProjectRelativePath, buildVersionedArtifactId } from '../../src/artifacts/ids';
import { hashArtifactManifest } from '../../src/services/project/repository/artifacts/manifestIdentity';
import { importLegacyArtifactDependencies } from '../../src/services/project/repository/import/legacyArtifacts';
import { RepositoryJournalReader } from '../../src/services/project/repository/journal/RepositoryJournalReader';
import { segmentRecords } from '../../src/services/project/repository/segments/recordSegment';
import { Blob } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import type { EntityDTO, RepositoryBackend, RepositoryDescriptor, RepositoryOwner } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { canonicalBytes, hashBytes } from '../../src/services/project/repository/segments/canonical';
import { readRecord } from '../../src/services/project/repository/segments/recordSegment';
import { blobPath, storeBlob, verifyBlob } from '../../src/services/project/repository/persistence/blobStorage';
import { recoverRepository } from '../../src/services/project/repository/persistence/recovery';
import { materializeProjection } from '../../src/services/project/repository/persistence/projection';
import { RecordTransplant } from '../../src/services/project/repository/archive/recordTransplant';
import { exportRepositoryArchive, restoreRepositoryArchive } from '../../src/services/project/repository/archive/archiveTransport';
import { backupRepository } from '../../src/services/project/repository/archive/repositoryBackup';
import { findCompletedBackup } from '../../src/services/project/repository/archive/backupCompletion';
import { openLegacySource } from '../../src/services/project/repository/import/legacySource';
import { importLegacyRepository } from '../../src/services/project/repository/import/legacyImport';
import { createRepositoryProject } from '../../src/services/project/repository/lifecycle/defaultProject';
import { prepareArchive } from '../../src/services/project/repository/archive/selectiveArchive';
import { assertClassicZipBounds, writeZip, extractZip } from '../../src/services/project/repository/archive/streamZip';

const owner: RepositoryOwner = { writerEpoch: 'test-owner', assertOwned() {}, async release() {} };
const descriptor: RepositoryDescriptor = { format: 'masterselects-repository', formatVersion: 1, repositoryId: 'source-repository', lineageId: 'shared-lineage', requiredReaderCapabilities: [], requiredWriterCapabilities: [] };
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
async function* chunks(bytes: Uint8Array, size = 137) { for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size); }
async function fixture() {
  const source = memory('source'); source.files.set('project.msrepo.json', canonicalBytes(descriptor));
  const binary = new TextEncoder().encode('original immutable artifact bytes'); const identity = { hash: await hashBytes(binary), length: binary.length };
  await storeBlob(source.backend, owner, identity, chunks(binary));
  const transport = new RecordTransplant(source.backend, source.backend, descriptor, owner);
  const entity: EntityDTO = { type: 'fixture', schemaVersion: 1, value: { edited: true }, references: [], blobs: [identity] };
  const reference = await transport.add({ kind: 'object', schemaVersion: 1, payload: entity as never, references: [], blobs: [identity] });
  const revision = await transport.add({ kind: 'revision', schemaVersion: 1, payload: { revisionId: 'initial', transactionId: 'initial-tx', parent: null, parentRevisionId: null, label: 'Initial', source: 'user', createdAt: 1, changes: [{ entityKey: 'fixture', before: null, after: reference }] } as never, references: [reference], blobs: [] });
  const pin = await transport.finish({ content: revision }); return { ...source, identity, entity, revision, pin };
}

describe('repository portable transports', () => {
  it('exports a standalone current root with actual blobs and restores without a source index', async () => {
    const source = await fixture(); const staging = memory('archive'); const output: Uint8Array[] = [];
    const original = new Map([...source.files].map(([path, bytes]) => [path, bytes.slice()]));
    const manifest = await exportRepositoryArchive(source.backend, descriptor, source.pin, staging.backend, owner,
      { targetRepositoryId: 'archive-repository', history: { kind: 'current', revision: source.revision }, journals: 'none', workspace: [], media: 'linked' }, async chunk => { output.push(chunk.slice()); });
    const restored = memory('restore'); const zip = new Blob(output); const bytes = new Uint8Array(await zip.arrayBuffer());
    await restoreRepositoryArchive(chunks(bytes), restored.backend, owner);
    const recovery = await recoverRepository(restored.backend, manifest.repository);
    const root = await readRecord(restored.backend, recovery.heads.content);
    expect((root.payload as { parent: unknown }).parent).toBeNull();
    const projection = await materializeProjection(restored.backend, recovery.heads.content, recovery.checkpoints);
    expect(projection.entities.get('fixture')).toEqual(source.entity);
    await verifyBlob(restored.backend, source.identity);
    expect(restored.files.has(blobPath(source.identity.hash))).toBe(true);
    expect([...source.files]).toEqual([...original]);
    expect(manifest.repository.repositoryId).not.toBe(descriptor.repositoryId);
    expect(manifest.repository.lineageId).toBe(descriptor.lineageId);
  });
  it('backs up incrementally with complete receipt last and rejects conflicting immutable bytes', async () => {
    const source = await fixture(); const target = memory('backup');
    await backupRepository(source.backend, descriptor, source.pin, target.backend, owner, { views: [] });
    expect(target.writes.at(-1)).toMatch(/complete\.json$/);
    expect((await recoverRepository(target.backend, descriptor)).head).toEqual(source.pin);
    await backupRepository(source.backend, descriptor, source.pin, target.backend, owner, { views: [] });
    target.files.set(blobPath(source.identity.hash), new Uint8Array(source.identity.length));
    await expect(backupRepository(source.backend, descriptor, source.pin, target.backend, owner, { views: [] })).rejects.toMatchObject({ code: 'corrupt' });
  });
  it('retains original legacy/autosave bytes, rejects source changes and excludes credentials', async () => {
    const source = memory('legacy'); const target = memory('import');
    const project = createRepositoryProject('Original'); source.files.set('project.json', canonicalBytes(project));
    source.files.set('.keys.enc', new TextEncoder().encode('private credential bytes'));
    const reader = { ...source.backend, sourceId: 'legacy-source' };
    const bundle = await openLegacySource(reader, { kind: 'directory' }, { staging: target.backend, importId: 'legacy-import' });
    const before = source.files.get('project.json')!.slice();
    await importLegacyRepository(bundle, descriptor, target.backend, owner, { importId: 'legacy-import', workspaceId: 'workspace' });
    expect(source.files.get('project.json')).toEqual(before);
    expect([...target.files.values()].some(bytes => new TextDecoder().decode(bytes).includes('private credential bytes'))).toBe(false);
    source.files.set('project.json', canonicalBytes({ ...project, name: 'Changed' }));
    await expect(bundle.assertUnchanged()).rejects.toMatchObject({ code: 'conflict' });
  });
  it('cancels streaming ZIP before consuming more source and rejects duplicate entry names', async () => {
    const abort = new AbortController(); abort.abort();
    const entries = async function* () { yield { path: 'a.bin', chunks: chunks(new Uint8Array([1])) }; };
    await expect(writeZip(entries(), async () => {}, abort.signal)).rejects.toMatchObject({ code: 'cancelled' });
    const output: Uint8Array[] = [];
    const duplicates = async function* () { yield { path: 'a.bin', chunks: chunks(new Uint8Array([1])) }; yield { path: 'a.bin', chunks: chunks(new Uint8Array([2])) }; };
    await writeZip(duplicates(), async chunk => { output.push(chunk.slice()); });
    await expect(extractZip((async function* () { yield* output; })(), async entry => { for await (const _part of entry.chunks) { /* Drain bounded stream. */ } })).rejects.toMatchObject({ code: 'budget' });
  });
  it('keeps an imported empty-change root checkpoint in a selected branch', async () => {
    const source = memory('checkpoint-source'); source.files.set('project.msrepo.json', canonicalBytes(descriptor));
    const writer = new RecordTransplant(source.backend, source.backend, descriptor, owner);
    const object = await writer.add({ kind: 'object', schemaVersion: 1, payload: { type: 'fixture', schemaVersion: 1, value: { populated: true }, references: [], blobs: [] }, references: [], blobs: [] });
    const block = await writer.add({ kind: 'checkpoint', schemaVersion: 1, payload: { entries: [{ entityKey: 'fixture', reference: object }] } as never, references: [object], blobs: [] });
    const root = await writer.add({ kind: 'revision', schemaVersion: 1, payload: { revisionId: 'import-root', transactionId: 'import', parent: null, parentRevisionId: null, label: 'Imported', source: 'legacy-import', createdAt: 1, changes: [] }, references: [], blobs: [] });
    const checkpoint = await writer.add({ kind: 'checkpoint', schemaVersion: 1, payload: { revisionId: 'import-root', blocks: [block] } as never, references: [block], blobs: [] });
    const pin = await writer.finish({ content: root }, [checkpoint]); const target = memory('branch-target');
    const manifest = await prepareArchive(source.backend, descriptor, pin, target.backend, owner, { history: { kind: 'branches', roots: { imported: root } }, journals: 'none', workspace: [], media: 'linked' });
    const recovered = await recoverRepository(target.backend, manifest.repository);
    const projection = await materializeProjection(target.backend, recovered.heads['branch:imported'], recovered.checkpoints);
    expect(projection.entities.get('fixture')?.value).toEqual({ populated: true });
  });
  it('excludes raw and semantic imported chat evidence from all-history journals:none', async () => {
    const source = memory('private-legacy'); const imported = memory('private-import');
    source.files.set('project.json', canonicalBytes(createRepositoryProject('Private evidence')));
    const sentinel = 'PRIVATE_CHAT_SENTINEL_8841';
    source.files.set('AI/Chat/chat.json', canonicalBytes({ messages: [{ text: sentinel }] }));
    const bundle = await openLegacySource({ ...source.backend, sourceId: 'private-legacy' }, { kind: 'directory' }, { staging: imported.backend, importId: 'private_import' });
    const pin = await importLegacyRepository(bundle, descriptor, imported.backend, owner, { importId: 'private_import', workspaceId: 'workspace' });
    const target = memory('without-journals');
    await prepareArchive(imported.backend, descriptor, pin, target.backend, owner, { history: { kind: 'all' }, journals: 'none', workspace: [], media: 'linked' });
    expect([...target.files.values()].some(bytes => new TextDecoder().decode(bytes).includes(sentinel))).toBe(false);
    const full = memory('with-journals');
    await prepareArchive(imported.backend, descriptor, pin, full.backend, owner, { history: { kind: 'all' }, journals: 'all', workspace: [], media: 'linked' });
    expect([...full.files.values()].some(bytes => new TextDecoder().decode(bytes).includes(sentinel))).toBe(true);
  });
  it('rejects classic ZIP size, offset and entry-count overflow without allocating large buffers', () => {
    expect(() => assertClassicZipBounds(0xffffffff, 0, 0, 1)).toThrow(/ZIP64/);
    expect(() => assertClassicZipBounds(0, 0xfffffffe, 0, 1)).toThrow(/ZIP64/);
    expect(() => assertClassicZipBounds(0, 0, 0, 0xffff)).toThrow(/ZIP64/);
    expect(() => assertClassicZipBounds(1024, 1024, 100, 2)).not.toThrow();
  });
  it('selects a verified completed backup snapshot while retaining its mirrored identity', async () => {
    const source = await fixture(); const target = memory('completed-backup');
    await backupRepository(source.backend, descriptor, source.pin, target.backend, owner, { views: [] });
    const completion = await findCompletedBackup(target.backend, descriptor);
    expect(completion?.commit).toEqual(source.pin);
    expect(JSON.parse(new TextDecoder().decode(target.files.get('project.msrepo.json')!)).repositoryId).toBe(descriptor.repositoryId);
  });

});


describe('source-bound legacy artifact compatibility', () => {
  it('preserves dangling archived pointers and records unresolved evidence without fabricating artifacts', async () => {
    const source = memory('old-pointer-source'), target = memory('old-pointer-target');
    source.files.set('project.json', canonicalBytes(createRepositoryProject('Legacy pointers')));
    const artifactId = `artifact:sha256:${'9a'.repeat(32)}:manifest:${'25'.repeat(32)}`;
    const path = 'Analysis/agent-timeline-pointer-v1-old.json';
    const pointer = { type: 'agent-timeline-manifest-pointer', schemaVersion: 'agent-timeline-manifest-pointer/v1', mediaFileId: 'old-media',
      sourceIdentityHash: '87'.repeat(32), manifestRef: artifactId, shardIndexRef: artifactId, publishedAt: '2026-09-30T16:42:47.610Z' };
    const original = canonicalBytes(pointer); source.files.set(path, original);
    const bundle = await openLegacySource({ ...source.backend, sourceId: 'pointer-source' }, { kind: 'directory' }, { staging: target.backend, importId: 'old_pointers' });
    await importLegacyRepository(bundle, descriptor, target.backend, owner, { importId: 'old_pointers', workspaceId: 'workspace' });
    const recovered = await recoverRepository(target.backend, descriptor);
    const journal = new RepositoryJournalReader({ getHead: () => recovered.heads.journal,
      readRecord: reference => readRecord(target.backend, reference) });
    expect(await journal.latest(`legacy/sidecar/${path}`)).toEqual({ sourcePath: path, sourceVersion: bundle.sourceVersion, value: pointer });
    const identity = { hash: await hashBytes(original), length: original.length };
    await verifyBlob(target.backend, identity); expect(Array.from(target.files.get(blobPath(identity.hash))!)).toEqual(Array.from(original));
    const evidence: unknown[] = [];
    for (const segment of recovered.commit!.segments) for await (const entry of segmentRecords(target.backend, segment)) {
      const payload = entry.record.payload;
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.type === 'legacy-unresolved-artifact') evidence.push(payload);
    }
    expect(evidence).toContainEqual(expect.objectContaining({ artifactId, status: 'unresolved', classification: 'archived-evidence',
      sourceId: bundle.sourceId, sourceVersion: bundle.sourceVersion, sourcePath: path, reason: 'manifest-missing' }));
    expect(bundle.provenance.missingRequired).toEqual([]);
    expect(source.files.get(path)).toEqual(original);
  });

  it('keeps missing active content requirements strict', async () => {
    const source = memory('required-source'), target = memory('required-target');
    source.files.set('project.json', canonicalBytes(createRepositoryProject('Required artifact')));
    const bundle = await openLegacySource({ ...source.backend, sourceId: 'required-source' }, { kind: 'directory' }, { staging: target.backend, importId: 'required' });
    const artifactId = `artifact:sha256:${'11'.repeat(32)}:manifest:${'22'.repeat(32)}`;
    const entities = new Map<string, EntityDTO>([['active', { type: 'authored', schemaVersion: 1, value: { artifactId }, references: [], blobs: [] }]]);
    const transport = new RecordTransplant(target.backend, target.backend, descriptor, owner);
    await expect(importLegacyArtifactDependencies(bundle, target.backend, owner, transport, entities)).rejects.toMatchObject({ code: 'corrupt' });
    expect(bundle.provenance.missingRequired).toHaveLength(1);
    expect(entities.get('active')!.references).toEqual([]);
  });

  it('uses source-local mutable manifests only when they prove the requested version', async () => {
    const source = memory('mutable-source'), target = memory('mutable-target');
    source.files.set('project.json', canonicalBytes(createRepositoryProject('Mutable artifact')));
    const binary = new TextEncoder().encode('authored legacy payload'); const hash = (await hashBytes(binary)).slice(7);
    const manifest: ArtifactManifest = { artifactId: `sha256:${hash}`, hash, hashAlgorithm: 'sha256', schemaVersion: 1,
      size: binary.length, encoding: 'text', mimeType: 'text/plain', createdAt: '2026-09-30T16:42:47.610Z',
      producer: { providerId: 'legacy' }, sourceRefs: [], storage: { kind: 'project-cache', projectRelativePath: buildArtifactProjectRelativePath(hash) } };
    source.files.set(buildArtifactProjectRelativePath(hash, 'manifest.json'), canonicalBytes(manifest));
    source.files.set(buildArtifactProjectRelativePath(hash), binary);
    const bundle = await openLegacySource({ ...source.backend, sourceId: 'mutable-source' }, { kind: 'directory' }, { staging: target.backend, importId: 'mutable' });
    const requested = buildVersionedArtifactId(hash, await hashArtifactManifest(manifest));
    const entities = new Map<string, EntityDTO>([['active', { type: 'authored', schemaVersion: 1, value: { artifactId: requested }, references: [], blobs: [] }]]);
    const transport = new RecordTransplant(target.backend, target.backend, descriptor, owner);
    await importLegacyArtifactDependencies(bundle, target.backend, owner, transport, entities);
    const reference = entities.get('active')!.references[0]; await transport.finish({ artifact: reference });
    const converted = await readRecord(target.backend, reference);
    expect(converted.payload).toMatchObject({ type: 'artifact-manifest', manifest: { hash, size: binary.length } });
    await verifyBlob(target.backend, { hash: 'sha256:' + hash, length: binary.length });
    const wrong = new Map<string, EntityDTO>([['active', { type: 'authored', schemaVersion: 1,
      value: { artifactId: buildVersionedArtifactId(hash, 'sha256:' + 'ff'.repeat(32)) }, references: [], blobs: [] }]]);
    await expect(importLegacyArtifactDependencies(bundle, target.backend, owner, transport, wrong)).rejects.toThrow('cannot prove requested artifact version');
  });
});


describe('legacy derived waveform cache compatibility', () => {
  it('clears missing shared waveform bindings and registry while retaining authored audio and source evidence', async () => {
    const source = memory('waveform-source'), target = memory('waveform-target');
    const missing = 'sha256:' + 'ad'.repeat(32), available = 'sha256:' + 'bc'.repeat(32), otherAuthored = 'sha256:' + 'de'.repeat(32);
    const project = createRepositoryProject('Waveform evidence');
    project.media = [{ id: 'audio', name: 'audio.wav', type: 'audio', sourcePath: 'Raw/audio.wav', hasProxy: false, folderId: null, importedAt: project.createdAt,
      audioAnalysisRefs: { waveformPyramidId: missing, loudnessEnvelopeId: otherAuthored } }];
    const state = { sourceAudioRevisionId: 'authored-revision', muted: true, soloSafe: true,
      editStack: [], effectStack: [], bakeHistory: [], sourceAnalysisRefs: { waveformPyramidId: missing },
      processedAnalysisRefs: { processedWaveformPyramidId: missing, waveformPyramidId: available } };
    project.compositions[0].clips = [{ id: 'clip', audioState: state } as unknown as ProjectFile['compositions'][number]['clips'][number]];
    project.audio = { schemaVersion: 1, analysisArtifactIds: [missing, available, otherAuthored], updatedAt: project.updatedAt };
    source.files.set('project.json', canonicalBytes(project));
    source.files.set(buildArtifactProjectRelativePath('bc'.repeat(32), 'manifest.json'), canonicalBytes({ legacy: true }));
    source.files.set(buildArtifactProjectRelativePath('bc'.repeat(32)), new Uint8Array([1]));
    const bundle = await openLegacySource({ ...source.backend, sourceId: 'waveform-source' }, { kind: 'directory' }, { staging: target.backend, importId: 'waveforms' });
    const transport = new RecordTransplant(target.backend, target.backend, descriptor, owner);
    const normalized = await normalizeLegacyAudioCaches(bundle, transport);
    expect(normalized.project.media[0].audioAnalysisRefs).toEqual({ loudnessEnvelopeId: otherAuthored });
    const audio = normalized.project.compositions[0].clips[0].audioState!;
    expect(audio.sourceAnalysisRefs).toEqual({}); expect(audio.processedAnalysisRefs).toEqual({ waveformPyramidId: available });
    expect(audio).toMatchObject({ sourceAudioRevisionId: 'authored-revision', muted: true, soloSafe: true, editStack: [], effectStack: [], bakeHistory: [] });
    expect(normalized.project.audio!.analysisArtifactIds).toEqual([available, otherAuthored]);
    expect(bundle.project.media[0].audioAnalysisRefs!.waveformPyramidId).toBe(missing);
    expect(bundle.project.audio!.analysisArtifactIds).toContain(missing);
    expect(normalized.evidence).not.toBeNull(); await transport.finish({ evidence: normalized.evidence! });
    const evidence = await readRecord(target.backend, normalized.evidence!);
    expect(evidence.payload).toMatchObject({ type: 'legacy-unresolved-audio-cache', status: 'unresolved', artifactId: missing,
      sourceId: bundle.sourceId, sourceVersion: bundle.sourceVersion, sourcePath: 'project.json', reason: 'manifest-missing',
      bindings: ['/media/0/audioAnalysisRefs/waveformPyramidId', '/compositions/0/clips/0/audioState/sourceAnalysisRefs/waveformPyramidId',
        '/compositions/0/clips/0/audioState/processedAnalysisRefs/processedWaveformPyramidId', '/audio/analysisArtifactIds/0'] });
  });

  it('imports canonical active audio with unavailable waveform removed and preserves the original project bytes', async () => {
    const source = memory('waveform-import-source'), target = memory('waveform-import-target');
    const missing = 'sha256:' + 'ad'.repeat(32); const project = createRepositoryProject('Regenerable waveform');
    project.media = [{ id: 'audio', name: 'audio.wav', type: 'audio', sourcePath: 'Raw/audio.wav', hasProxy: false, folderId: null, importedAt: project.createdAt,
      audioAnalysisRefs: { waveformPyramidId: missing } }];
    project.audio = { schemaVersion: 1, analysisArtifactIds: [missing] };
    const original = canonicalBytes(project); source.files.set('project.json', original); source.files.set('Raw/audio.wav', new Uint8Array([1, 2, 3]));
    const bundle = await openLegacySource({ ...source.backend, sourceId: 'waveform-import-source' }, { kind: 'directory' }, { staging: target.backend, importId: 'waveform_import' });
    await importLegacyRepository(bundle, descriptor, target.backend, owner, { importId: 'waveform_import', workspaceId: 'workspace' });
    const recovered = await recoverRepository(target.backend, descriptor);
    const projection = await materializeProjection(target.backend, recovered.heads.content, recovered.checkpoints);
    const restored = decodeProjectDomains(projection.entities, {});
    expect(restored.media[0].audioAnalysisRefs?.waveformPyramidId).toBeUndefined();
    expect(restored.audio!.analysisArtifactIds ?? []).not.toContain(missing);
    const evidence = await readRecord(target.backend, recovered.heads['metadata:legacy-derived-audio-cache']);
    expect(evidence.payload).toMatchObject({ artifactId: missing, classification: 'reproducible-waveform', status: 'unresolved' });
    const identity = { hash: await hashBytes(original), length: original.length };
    await verifyBlob(target.backend, identity); expect(Array.from(target.files.get(blobPath(identity.hash))!)).toEqual(Array.from(original));
    expect(Array.from(source.files.get('project.json')!)).toEqual(Array.from(original));
  });
});
