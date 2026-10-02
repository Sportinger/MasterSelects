import { normalizeLegacyAudioCaches } from './legacyAudioCaches';
import { bindLegacyLinkedMedia, legacyMediaProjectPath } from './legacyLinkedMedia';
import type { ProjectMediaSourceRoot } from '../../types/project.types';
import { normalizeLegacyProjectForRepository } from './legacyProjectCompatibility';
import type { BlobReference, EntityDTO, JsonValue, RecordReference, RepositoryBackend, RepositoryDescriptor, RepositoryOwner } from '../contracts';
import { RepositoryError } from '../contracts';
import { encodeProjectDomains, encodeProjectAggregate } from '../domains/projectDomains';
import { domainJson, entityKey } from '../domains/jsonBoundary';
import { importLegacyArtifactDependencies } from './legacyArtifacts';
import { importRawLegacyHistory } from './legacyHistory';
import type { LegacySourceBundle } from './legacySource';
import { RecordTransplant } from '../archive/recordTransplant';
import { canonicalBytes, hashBytes } from '../segments/canonical';
import { StreamHash } from '../segments/streamHash';
import { storeBlob } from '../persistence/blobStorage';
import { splitProjectWorkspace } from '../lifecycle/workspaceProjection';
import { recoverRepository } from '../persistence/recovery';
import { readJson, writeJson } from '../archive/streamIO';

export interface LegacyImportOptions {
  importId: string; workspaceId: string; signal?: AbortSignal;
  /** Old project folder registered as media source root; linked media resolve through it. */
  mediaSourceRoot?: ProjectMediaSourceRoot;
  /** Processed source entries, for visible progress during long conversions. */
  onProgress?(processedFiles: number): void;
  /** Artifact owner resolves source-bound manifests; never query the active project/global cache. */
  importArtifacts?: (source: LegacySourceBundle, target: RepositoryBackend, owner: RepositoryOwner, signal?: AbortSignal) => Promise<void>;
}
const privateEntry = (path: string): boolean => /(?:^|\/)(?:\.keys\.enc|\.env(?:\.[^/]*)?|\.dev\.vars|\.ai-bridge-token|\.ai-bridge-url|(?:api[-_]?keys|credentials|auth|tokens|provider[-_]?settings|api[-_]?provider[-_]?state|oauth|session[-_]?tokens)(?:\.json|\.enc))$/i.test(path)
  || /^(?:\.git|\.certs|node_modules|docs\/private|docs\/ongoing)\//.test(path);
/** Linked entries record size and physical location only; their bytes stay in the old folder. */
type EntryEvidence = { path: string; identity: BlobReference; classification: 'content' | 'journal' | 'cache' | 'unknown' }
  | { path: string; classification: 'linked'; length: number; sourcePath: string };
const classify = (path: string): Exclude<EntryEvidence['classification'], 'linked'> =>
  /^(AI\/Chat|Prompts)\//.test(path) || /(?:^|\/)project(?:\.autosave)?\.json$/.test(path) || /agent[-_]timeline/i.test(path) ? 'journal' :
  /^(Raw|Documents|Artifacts|Analysis|Transcripts|Geometry)\//.test(path) ? 'content' :
  /^(Cache|Proxy|Audio Proxies|Renders)\//.test(path) ? 'cache' : 'unknown';

/** Imported files retain all bytes and contradictory values, with no latest/longest guessing. */
export async function importLegacyRepository(source: LegacySourceBundle, descriptor: RepositoryDescriptor, target: RepositoryBackend, owner: RepositoryOwner, options: LegacyImportOptions): Promise<import('../contracts').CommitReference> {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.importId)) throw new RepositoryError('corrupt', 'Invalid import identity');
  const prefix = `.masterselects/imports/${options.importId}`;
  const binding = { sourceId: source.sourceId, sourceVersion: source.sourceVersion, targetLocationId: target.locationId,
    repositoryId: descriptor.repositoryId, lineageId: descriptor.lineageId };
  await writeJson(target, `${prefix}/target.json`, binding, options.signal);
  await owner.assertOwned(); await source.assertUnchanged();
  if (await target.stat(`${prefix}/complete.json`)) {
    const complete = await readJson<{ commit: import('../contracts').CommitReference }>(target, `${prefix}/complete.json`, 4096, options.signal);
    const recovered = await recoverRepository(target, descriptor, options.signal);
    if (recovered.head?.hash !== complete.commit.hash) throw new RepositoryError('conflict', 'Completed import target has changed');
    return complete.commit;
  }
  await writeJson(target, 'project.msrepo.json', descriptor, options.signal);
  const transport = new RecordTransplant(target, target, descriptor, owner, { signal: options.signal, transportId: options.importId });
  const audioCompatibility = await normalizeLegacyAudioCaches(source, transport, options.signal);
  const linkedMedia = await bindLegacyLinkedMedia(audioCompatibility.project, source, options.mediaSourceRoot, options.signal);
  const encoded = encodeProjectDomains(normalizeLegacyProjectForRepository(linkedMedia.project));
  const blocks: RecordReference[] = []; let entries: Array<{ entityKey: string; reference: RecordReference }> = []; let bytes = 0;
  const seal = async () => {
    if (!entries.length) return;
    blocks.push(await transport.add({ kind: 'checkpoint', schemaVersion: 1, payload: { entries } as unknown as JsonValue,
      references: entries.map(entry => entry.reference), blobs: [] })); entries = []; bytes = 0;
  };
  const writeEntities = async (entities: ReadonlyMap<string, EntityDTO>) => {
    for (const [entityKey, entity] of entities) {
      const reference = await transport.add({ kind: 'object', schemaVersion: 1, payload: entity as unknown as JsonValue, references: entity.references, blobs: entity.blobs });
      const entry = { entityKey, reference }; const size = canonicalBytes(entry).length;
      if (bytes + size > 512 * 1024) await seal(); entries.push(entry); bytes += size;
    }
  };
  let journalHead: RecordReference | null = null;
  const appendJournalDomains = async (id: string, rootKey: string, aggregates: ReadonlyMap<string, EntityDTO>) => {
    let mappingHead: RecordReference | null = null;
    let mappingEntries: Array<{ entityKey: string; reference: RecordReference }> = []; let mappingBytes = 0;
    const sealMapping = async () => {
      if (!mappingEntries.length) return;
      mappingHead = await transport.add({ kind: 'metadata', schemaVersion: 1,
        payload: { type: 'journal-aggregate-map', entries: mappingEntries, previous: mappingHead } as unknown as JsonValue,
        references: [...mappingEntries.map(entry => entry.reference), ...(mappingHead ? [mappingHead] : [])], blobs: [] });
      mappingEntries = []; mappingBytes = 0;
    };
    for (const [key, entity] of aggregates) {
      const reference = await transport.add({ kind: 'object', schemaVersion: 1, payload: entity as unknown as JsonValue, references: entity.references, blobs: entity.blobs });
      const entry = { entityKey: key, reference }; const size = canonicalBytes(entry).length;
      if (mappingBytes + size > 512 * 1024) await sealMapping(); mappingEntries.push(entry); mappingBytes += size;
    }
    await sealMapping();
    journalHead = await transport.add({ kind: 'journal', schemaVersion: 1,
      payload: { id, value: { $repositoryJournalAggregate: { rootKey, blocks: mappingHead } }, previous: journalHead } as unknown as JsonValue,
      references: [...(journalHead ? [journalHead] : []), ...(mappingHead ? [mappingHead] : [])], blobs: [] });
  };
  const mediaPaths = new Map<string, string[]>();
  for (const media of source.project.media) {
    const path = legacyMediaProjectPath(media);
    if (path) mediaPaths.set(path, [...(mediaPaths.get(path) ?? []), media.id]);
  }
  let evidenceHead: RecordReference | null = null; let evidencePage: EntryEvidence[] = []; let cursor: string | undefined;
  const sealEvidence = async () => {
    if (!evidencePage.length) return;
    evidenceHead = await transport.add({ kind: 'metadata', schemaVersion: 1,
      payload: { type: 'legacy-source-page', sourceId: source.sourceId, entries: evidencePage, previous: evidenceHead } as unknown as JsonValue,
      references: evidenceHead ? [evidenceHead] : [], blobs: evidencePage.flatMap(entry => 'identity' in entry ? [entry.identity] : []) }); evidencePage = [];
  };
  let processed = 0;
  do {
    const page = await source.list('', cursor, 128);
    for (const path of page.paths) {
      if (privateEntry(path)) continue;
      options.signal?.throwIfAborted(); await owner.assertOwned();
      if (++processed % 64 === 0) options.onProgress?.(processed);
      const linkedPath = await source.linkedPath(path);
      if (linkedPath) {
        const size = await source.stat(path);
        evidencePage.push({ path, classification: 'linked', length: size?.length ?? 0, sourcePath: linkedPath });
        if (evidencePage.length >= 128) await sealEvidence();
        continue;
      }
      const classification = classify(path);
      const hash = new StreamHash(); let length = 0;
      for await (const chunk of source.readChunks(path)) { hash.update(chunk); length += chunk.length; }
      const identity = { hash: hash.digest(), length };
      for (const id of mediaPaths.get(path) ?? []) {
        const verified = { identityStatus: 'verified', algorithm: 'sha256', contentHash: identity.hash, byteLength: identity.length } as const;
        encoded.entities.set('source-identity:' + id, { type: 'source-identity', schemaVersion: 1, value: verified, references: [], blobs: [identity] });
        for (const [key, entity] of encoded.entities) if (entity.type === 'media-aggregate' && entity.value && typeof entity.value === 'object' && !Array.isArray(entity.value) && entity.value.id === id)
          encoded.entities.set(key, { ...entity, value: { ...entity.value, $sourceIdentity: verified }, blobs: [...entity.blobs, identity] });
      }
      await storeBlob(target, owner, identity, source.readChunks(path), options.signal);
      const evidence: EntryEvidence = { path, identity, classification };
      const rawDomains = encodeProjectAggregate('legacyFile', 'project', path,
        { sourceId: source.sourceId, sourceVersion: source.sourceVersion, sourcePath: path, identity }, { blobs: [identity] });
      if (classification === 'journal') await appendJournalDomains(`legacy/file/${path}`, entityKey('legacyFile', 'project', path), rawDomains);
      else {
        await writeEntities(rawDomains);
        evidencePage.push(evidence); if (evidencePage.length >= 128) await sealEvidence();
      }
      // Sidecar content gets its own canonical domain, while original bytes stay reachable.
      if ((classification === 'content' || classification === 'journal') && path.endsWith('.json') && length <= 32 * 1024 * 1024) {
        const value = await source.readJson<unknown>(path);
        const domains = encodeProjectAggregate(classification === 'journal' ? 'legacyJournal' : 'legacySidecar', source.sourceId, path,
          { sourcePath: path, sourceVersion: source.sourceVersion, value }, { blobs: [identity] });
        await importLegacyArtifactDependencies(source, target, owner, transport, domains, options.signal, { evidenceOnly: true, sourcePath: path });
        if (classification === 'journal') await appendJournalDomains(`legacy/sidecar/${path}`, entityKey('legacyJournal', source.sourceId, path), domains);
        else await writeEntities(domains);
      }
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  await sealEvidence();
  await importLegacyArtifactDependencies(source, target, owner, transport, encoded.entities, options.signal);
  await options.importArtifacts?.(source, target, owner, options.signal);
  await writeEntities(encoded.entities);
  await seal();
  const revisionId = `import-${options.importId}`;
  const revision = await transport.add({ kind: 'revision', schemaVersion: 1, payload: {
    revisionId, transactionId: options.importId, parent: null, parentRevisionId: null, label: 'Imported project', source: 'legacy-import', createdAt: Number.isFinite(Date.parse(source.project.createdAt)) ? Date.parse(source.project.createdAt) : 0, changes: []
  }, references: [], blobs: [] });
  const checkpoint = await transport.add({ kind: 'checkpoint', schemaVersion: 1, payload: { revisionId, blocks } as unknown as JsonValue, references: blocks, blobs: [] });
  const navigation = await transport.add({ kind: 'navigation', schemaVersion: 1, payload: {
    workspaceId: options.workspaceId, sequence: 1, revisionId, revision, redoPreferences: {}
  } as unknown as JsonValue, references: [revision], blobs: [] });
  let historyMetadata: RecordReference | null = null;
  const history = source.project.uiState?.history;
  if (history) {
    const raw = importRawLegacyHistory(history, { sourceId: source.sourceId, sourcePath: source.provenance.selectedProjectPath, sourceDigest: source.sourceVersion.hash });
    // Bounded aggregate chunks retain the entire multi-root graph and explicit ambiguity.
    const domains = encodeProjectAggregate('legacyHistory', source.sourceId, 'raw', raw);
    await appendJournalDomains('legacy/history/raw', entityKey('legacyHistory', source.sourceId, 'raw'), domains);
    for (const node of raw.nodes) historyMetadata = await transport.add({ kind: 'metadata', schemaVersion: 1,
      payload: { key: `legacy-history:${source.sourceId}:${node.id}`, value: { name: node.originalId ?? node.id, source: 'Legacy source evidence',
        navigation: node.navigation === 'invalid' ? 'invalid' : 'ambiguous', revisionId: null,
        detail: `Read-only imported snapshot at ${node.sourcePointer}; parent ${node.parentId ?? '(root)'}; composition ${node.compositionContext ?? 'unproven'}. ${node.issues.join(', ')}`,
        sourcePointer: node.sourcePointer, parentId: node.parentId, compositionContext: node.compositionContext, evidence: journalHead }, previous: historyMetadata } as unknown as JsonValue,
      references: [...(historyMetadata ? [historyMetadata] : []), ...(journalHead ? [journalHead] : [])], blobs: [] });
  }
  for (const journal of encoded.journals.filter(journal => journal.id !== 'legacy/history')) {
    const aggregates = encodeProjectAggregate('importJournal', source.sourceId, journal.id, journal.value);
    await appendJournalDomains(journal.id, entityKey('importJournal', source.sourceId, journal.id), aggregates);
  }
  // Workspace stays outside content; a large project workspace is split into individual keys.
  for (const part of splitProjectWorkspace(encoded.workspace)) {
    const body = { format: 'masterselects-view', schemaVersion: 1, repositoryId: descriptor.repositoryId, workspaceId: options.workspaceId,
      viewKey: part.key, sequence: 1, value: domainJson(part.value) };
    await writeJson(target, `.masterselects/views/${encodeURIComponent(options.workspaceId)}/${encodeURIComponent(body.viewKey)}/a.json`, { ...body, checksum: await hashBytes(canonicalBytes(body)) }, options.signal);
  }
  await source.assertUnchanged();
  const heads: Record<string, RecordReference> = { [`navigation:${options.workspaceId}`]: navigation, content: revision };
  if (evidenceHead) heads['metadata:legacy-source'] = evidenceHead;
  if (audioCompatibility.evidence) heads['metadata:legacy-derived-audio-cache'] = audioCompatibility.evidence;
  if (historyMetadata) heads['metadata:legacy-history'] = historyMetadata;
  if (journalHead) heads.journal = journalHead;
  const commit = await transport.finish(heads, [checkpoint]);
  await recoverRepository(target, descriptor, options.signal); await source.assertUnchanged();
  await writeJson(target, `${prefix}/complete.json`, { ...binding, commit, provenance: source.provenance }, options.signal);
  return commit;
}
