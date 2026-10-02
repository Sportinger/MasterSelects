import { RepositoryError, type CommitReference, type JsonValue, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner, type RepositoryRecord } from '../contracts';
import { canonicalBytes } from '../segments/canonical';
import { readRecord, segmentRecords } from '../segments/recordSegment';
import { commitPath, readCommit } from '../persistence/publication';
import { materializeEntityReferences, readRevision } from '../persistence/projection';
import { storeBlob } from '../persistence/blobStorage';
import { recoverRepository } from '../persistence/recovery';
import { RecordTransplant } from './recordTransplant';
import { freezeViews } from './frozenViews';
import { readJson, writeJson } from './streamIO';
import type { ArchiveOptions, RepositoryArchiveManifest } from './archiveManifest';

export async function* pinnedCommits(source: RepositoryBackend, pin: CommitReference, signal?: AbortSignal) {
  let cursor: CommitReference | null = pin;
  while (cursor) {
    const item: Awaited<ReturnType<typeof readCommit>> = await readCommit(source, commitPath(cursor.commitId), signal);
    if (item.reference.hash !== cursor.hash) throw new RepositoryError('corrupt', 'Pinned commit ancestry hash mismatch');
    yield item.commit; cursor = item.commit.previous;
  }
}
async function retainApplicableCheckpoints(source: RepositoryBackend, transplant: RecordTransplant, roots: RecordReference[], hints: RecordReference[], signal?: AbortSignal): Promise<RecordReference[]> {
  const retained: RecordReference[] = [];
  for (const hint of hints) {
    const checkpoint = await readRecord(source, hint, signal);
    const revisionId = (checkpoint.payload as unknown as { revisionId?: string }).revisionId;
    if (!revisionId) continue;
    let applicable = false;
    for (const root of roots) {
      let cursor: RecordReference | null = root;
      while (cursor) {
        signal?.throwIfAborted();
        const revision = await readRevision(source, cursor, signal);
        if (revision.revisionId === revisionId) { applicable = true; break; }
        cursor = revision.parent;
      }
      if (applicable) break;
    }
    if (applicable) retained.push(await transplant.copy(hint));
  }
  return retained;
}
/** Creates a separate repository; it never modifies or repacks published source segments. */
export async function prepareArchive(source: RepositoryBackend, sourceDescriptor: RepositoryDescriptor, pin: CommitReference, target: RepositoryBackend, owner: RepositoryOwner, options: ArchiveOptions): Promise<RepositoryArchiveManifest> {
  if (source.locationId === target.locationId || await target.stat('project.msrepo.json')) throw new RepositoryError('conflict', 'Archive target must be a separate empty repository');
  if (options.media === 'self-contained' && !options.resolveSources) throw new RepositoryError('unsupported', 'Self-contained export requires the domain source resolver');
  const descriptor: RepositoryDescriptor = { ...sourceDescriptor, repositoryId: options.targetRepositoryId ?? crypto.randomUUID() };
  // Views are frozen before lengthy content traversal.
  await freezeViews(source, target, sourceDescriptor.repositoryId, descriptor.repositoryId, options.workspace, options.signal);
  await writeJson(target, 'project.msrepo.json', descriptor, options.signal);
  let bindingHead: RecordReference | null = null;
  const knownSources = new Set<string>();
  let transplant: RecordTransplant;
  const onRecord = async (record: RepositoryRecord): Promise<void> => {
    if (record.kind === 'journal' && options.journals === 'none') throw new RepositoryError('conflict', 'Selected content depends on a journal excluded by the export selection');
    if (options.media !== 'self-contained' || record.kind !== 'object') return;
    for await (const external of options.resolveSources!(record)) {
      const key = `${external.sourceId}:${external.identity.hash}`;
      // Durable source identity file avoids retaining a project-sized source registry.
      const path = `.masterselects/transport/sources/${external.identity.hash.slice(7)}-${encodeURIComponent(external.sourceId)}.json`;
      if (knownSources.has(key) || await target.stat(path)) continue;
      await storeBlob(target, owner, external.identity, external.chunks, options.signal);
      await writeJson(target, path, { sourceId: external.sourceId, ...external.identity }, options.signal);
      bindingHead = await transplant.add({ kind: 'metadata', schemaVersion: 1,
        payload: { type: 'source-binding', sourceId: external.sourceId, identity: external.identity, previous: bindingHead } as unknown as JsonValue,
        references: bindingHead ? [bindingHead] : [], blobs: [external.identity] });
      knownSources.add(key); if (knownSources.size > 128) knownSources.delete(knownSources.values().next().value!);
    }
  };
  transplant = new RecordTransplant(source, target, descriptor, owner, { signal: options.signal, onRecord });
  const heads: Record<string, RecordReference> = {};
  let selectedRevisionId: string | null = null;
  const checkpoints: RecordReference[] = [];
  const selection = options.history;
  if (selection.kind === 'current' || selection.kind === 'named') {
    const recovered = await recoverRepository(source, sourceDescriptor, options.signal);
    const { references: entityRefs } = await materializeEntityReferences(source, selection.revision, recovered.checkpoints, options.signal);
    const blocks: RecordReference[] = []; let entries: Array<{ entityKey: string; reference: RecordReference }> = []; let bytes = 0;
    const seal = async () => {
      if (!entries.length) return;
      blocks.push(await transplant.add({ kind: 'checkpoint', schemaVersion: 1, payload: { entries } as unknown as JsonValue, references: entries.map(entry => entry.reference), blobs: [] }));
      entries = []; bytes = 0;
    };
    for (const [entityKey, ref] of entityRefs) {
      const reference = await transplant.copy(ref); const entry = { entityKey, reference };
      const length = canonicalBytes(entry).length;
      if (bytes + length > 512 * 1024) await seal(); entries.push(entry); bytes += length;
    }
    await seal();
    const original = await readRevision(source, selection.revision, options.signal);
    const revisionId = original.revisionId; selectedRevisionId = revisionId;
    heads.content = await transplant.add({ kind: 'revision', schemaVersion: 1,
      payload: { revisionId, transactionId: crypto.randomUUID(), parent: null, parentRevisionId: null, label: selection.name ?? 'Imported current state', source: 'archive-import', createdAt: original.createdAt, changes: [] }, references: [], blobs: [] });
    checkpoints.push(await transplant.add({ kind: 'checkpoint', schemaVersion: 1, payload: { revisionId, blocks } as unknown as JsonValue, references: blocks, blobs: [] }));
  } else if (selection.kind === 'branches') {
    const recovered = await recoverRepository(source, sourceDescriptor, options.signal);
    checkpoints.push(...await retainApplicableCheckpoints(source, transplant, Object.values(selection.roots), recovered.checkpoints, options.signal));
    for (const [key, reference] of Object.entries(selection.roots)) {
      const copied = await transplant.copy(reference); heads[`branch:${key}`] = copied;
      selectedRevisionId ??= (await readRevision(source, reference, options.signal)).revisionId;
      heads.content ??= copied;
      heads[`metadata:branch:${key}`] = await transplant.add({ kind: 'metadata', schemaVersion: 1,
        payload: { key: `branch-head:${key}`, value: { name: key, revisionId: (await readRevision(source, reference, options.signal)).revisionId }, revision: copied, previous: null } as unknown as JsonValue, references: [copied], blobs: [] });
    }
  } else {
    for await (const commit of pinnedCommits(source, pin, options.signal)) {
      for (const segment of commit.segments) for await (const entry of segmentRecords(source, segment, options.signal)) {
        // History roots select dependencies; unrelated journal objects and metadata are not roots.
        if (entry.record.kind === 'revision') await transplant.copy(entry.reference);
      }
      for (const [key, reference] of Object.entries(commit.heads)) if (!(key in heads) && key !== 'content' && key !== 'journal' && !key.startsWith('journal:') && !key.startsWith('navigation:') && !(options.journals !== 'all' && (key.startsWith('metadata:legacy') || key.startsWith('metadata:journal')))) heads[key] = await transplant.copy(reference);
      if (!heads.content) {
        const candidate = commit.heads.content ?? Object.entries(commit.heads).find(([key]) => key.startsWith('navigation:'))?.[1];
        if (candidate) {
          const record = await readRecord(source, candidate, options.signal);
          const reference = record.kind === 'navigation' ? (record.payload as unknown as { revision: RecordReference }).revision : candidate;
          heads.content = await transplant.copy(reference);
          selectedRevisionId = (await readRevision(source, reference, options.signal)).revisionId;
        }
      }
      if (!checkpoints.length) for (const reference of commit.checkpoints) checkpoints.push(await transplant.copy(reference));
    }
  }
  if (options.journals === 'all') {
    for await (const commit of pinnedCommits(source, pin, options.signal)) {
      if (commit.heads.journal) { heads.journal = await transplant.copy(commit.heads.journal); break; }
    }
  } else if (Array.isArray(options.journals)) {
    let previous: RecordReference | null = null;
    // Selected events are rebuilt without inheriting unrelated conversation ancestry.
    for (const original of options.journals) {
      const record = await readRecord(source, original, options.signal);
      if (record.kind !== 'journal') throw new RepositoryError('corrupt', 'Selected journal reference is not a journal');
      const payload = record.payload as { id: string; value: JsonValue; previous: JsonValue };
      const prior = payload.previous as unknown as RecordReference | null;
      const mappings = new Map<string, RecordReference>();
      for (const reference of record.references) if (reference.hash !== prior?.hash) mappings.set(reference.hash, await transplant.copy(reference));
      const rewrite = (value: JsonValue): JsonValue => {
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === 'object') {
          if (typeof value.hash === 'string' && typeof value.segmentId === 'string') {
            const mapped = mappings.get(value.hash); if (!mapped) throw new RepositoryError('corrupt', 'Undeclared selected journal dependency');
            return mapped as unknown as JsonValue;
          }
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
        }
        return value;
      };
      previous = await transplant.add({ ...record, payload: { id: payload.id, value: rewrite(payload.value), previous } as unknown as JsonValue,
        references: [...mappings.values(), ...(previous ? [previous] : [])] });
    }
    if (previous) heads.journal = previous;
  }
  if (heads.content) {
    const revisionId = selectedRevisionId;
    if (!revisionId) throw new RepositoryError('corrupt', 'Archive content cursor could not be resolved');
    heads['navigation:archive'] = await transplant.add({ kind: 'navigation', schemaVersion: 1,
      payload: { workspaceId: 'archive', sequence: 1, revisionId, revision: heads.content, redoPreferences: {} } as unknown as JsonValue,
      references: [heads.content], blobs: [] });
  }
  for (const [key, reference] of Object.entries(options.metadata ?? {})) heads[`metadata:${key}`] = await transplant.copy(reference);
  if (bindingHead) heads.sources = bindingHead;
  const anchor = await transplant.add({ kind: 'metadata', schemaVersion: 1,
    payload: { type: 'fork-anchor', sourceRepositoryId: sourceDescriptor.repositoryId, sourceCommit: pin, lineageId: descriptor.lineageId } as unknown as JsonValue, references: [], blobs: [] });
  heads.import = anchor;
  const targetCommit = await transplant.finish(heads, checkpoints);
  await recoverRepository(target, descriptor, options.signal);
  const manifest: RepositoryArchiveManifest = { format: 'masterselects-repository-archive', formatVersion: 1, repository: descriptor,
    sourceRepositoryId: sourceDescriptor.repositoryId, sourceCommit: pin, targetCommit,
    history: { kind: selection.kind, name: 'name' in selection ? selection.name : undefined, roots: Object.keys(heads).filter(key => key === 'content' || key.startsWith('branch:')) },
    journals: Array.isArray(options.journals) ? 'selected' : options.journals, workspace: options.workspace, media: options.media,
    selfContained: options.media === 'self-contained', sourceBindingsHead: bindingHead };
  await writeJson(target, 'archive-manifest.json', manifest, options.signal);
  return manifest;
}

export async function readArchiveManifest(backend: RepositoryBackend, signal?: AbortSignal): Promise<RepositoryArchiveManifest> {
  const manifest = await readJson<RepositoryArchiveManifest>(backend, 'archive-manifest.json', 1024 * 1024, signal);
  if (manifest.format !== 'masterselects-repository-archive' || manifest.formatVersion !== 1) throw new RepositoryError('unsupported', 'Unknown repository archive format');
  if (manifest.repository.format !== 'masterselects-repository' || manifest.repository.formatVersion !== 1) throw new RepositoryError('unsupported', 'Unknown archived repository format');
  return manifest;
}
