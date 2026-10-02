import { discoverLegacyCheckpoints } from './checkpointDiscovery';
import { iterateRevisionChanges } from './revisionChanges';
import { REPOSITORY_LIMITS, RepositoryError, type EntityDTO, type EntityKey, type JsonValue, type RecordReference, type RepositoryBackend, type RepositoryProjection, type RepositoryRecord, type RevisionPayload } from '../contracts';
import { readRecord } from '../segments/recordSegment';
import { canonicalBytes } from '../segments/canonical';
import type { PublicationBatch } from './publication';

export async function readRevision(backend: RepositoryBackend, reference: RecordReference, signal?: AbortSignal): Promise<RevisionPayload> {
  const record = await readRecord(backend, reference, signal);
  const payload = record.payload as unknown as RevisionPayload;
  if (record.kind !== 'revision' || !payload || !payload.revisionId || !payload.transactionId || !Array.isArray(payload.changes) || payload.parentRevisionId !== null && typeof payload.parentRevisionId !== 'string') throw new RepositoryError('corrupt', 'Invalid revision record');
  if (payload.checkpoint && !record.references.some(ref => ref.hash === payload.checkpoint!.hash && ref.segmentId === payload.checkpoint!.segmentId && ref.offset === payload.checkpoint!.offset && ref.length === payload.checkpoint!.length)) throw new RepositoryError('corrupt', 'Revision checkpoint dependency is undeclared');
  return payload;
}
export async function materializeEntityReferences(backend: RepositoryBackend, target: RecordReference, checkpoints: RecordReference[] = [], signal?: AbortSignal): Promise<{ revisionId: string | null; references: Map<EntityKey, RecordReference>; checkpointDistance: number; checkpointBytes: number }> {
  const selected = new Map<EntityKey, RecordReference | null>();
  const hints = new Map<string, RecordReference>();
  for (const hint of checkpoints) {
    const record = await readRecord(backend, hint, signal);
    const data = record.payload as unknown as { revisionId: string; blocks: RecordReference[] };
    if (record.kind !== 'checkpoint' || !data.revisionId || !Array.isArray(data.blocks)) throw new RepositoryError('corrupt', 'Invalid projection checkpoint');
    hints.set(data.revisionId, hint);
  }
  let cursor: RecordReference | null = target;
  let revisionId: string | null = null;
  let checkpointDistance = 0, checkpointBytes = 0;
  let persistedDistance: number | undefined, persistedBytes: number | undefined;
  const legacyWindow = new Set<string>();
  while (cursor) {
    if (signal?.aborted) throw new RepositoryError('cancelled', 'Projection load cancelled');
    const revision: RevisionPayload = await readRevision(backend, cursor, signal);
    if (revisionId === null) {
      persistedDistance = revision.checkpointDistance; persistedBytes = revision.checkpointBytes;
      if (persistedDistance !== undefined && (!Number.isSafeInteger(persistedDistance) || persistedDistance < 0 || persistedDistance > REPOSITORY_LIMITS.checkpointRevisions)) throw new RepositoryError('corrupt', 'Invalid persisted checkpoint distance');
      if (persistedBytes !== undefined && (!Number.isSafeInteger(persistedBytes) || persistedBytes < 0)) throw new RepositoryError('corrupt', 'Invalid persisted checkpoint byte distance');
    }
    revisionId ??= revision.revisionId;
    if (revision.checkpointDistance === undefined && !revision.checkpoint && !hints.has(revision.revisionId) && !legacyWindow.has(revision.revisionId)) {
      legacyWindow.clear(); const ancestors = new Map<string, RecordReference>();
      let next: RecordReference | null = cursor;
      for (let i = 0; next && i < REPOSITORY_LIMITS.checkpointRevisions; i++) {
        const ancestor: RevisionPayload = await readRevision(backend, next, signal);
        if (ancestor.checkpoint || hints.has(ancestor.revisionId)) break;
        ancestors.set(ancestor.revisionId, next); legacyWindow.add(ancestor.revisionId); next = ancestor.parent;
      }
      for (const [id, ref] of await discoverLegacyCheckpoints(backend, ancestors, signal)) hints.set(id, ref);
    }
    const checkpoint = revision.checkpoint ?? hints.get(revision.revisionId);
    if (checkpoint) {
      const record = await readRecord(backend, checkpoint, signal);
      const data = record.payload as unknown as { revisionId: string; blocks: RecordReference[] };
      if (record.kind !== 'checkpoint' || data.revisionId !== revision.revisionId || !Array.isArray(data.blocks)) throw new RepositoryError('corrupt', 'Checkpoint does not match requested revision');
      for (const ref of data.blocks) {
        const block = await readRecord(backend, ref, signal);
        const entries = (block.payload as unknown as { entries: Array<{ entityKey: string; reference: RecordReference }> }).entries;
        if (block.kind !== 'checkpoint' || !Array.isArray(entries)) throw new RepositoryError('corrupt', 'Invalid checkpoint block');
        for (const entry of entries) if (!selected.has(entry.entityKey)) selected.set(entry.entityKey, entry.reference);
      }
      break;
    }
    checkpointDistance++;
    for await (const change of iterateRevisionChanges(backend, revision, signal)) {
      checkpointBytes = Math.min(REPOSITORY_LIMITS.checkpointChangesetBytes, checkpointBytes + canonicalBytes(change).length);
      if (!selected.has(change.entityKey)) selected.set(change.entityKey, change.after);
    }
    cursor = revision.parent;
  }
  const references = new Map<EntityKey, RecordReference>();
  for (const [key, ref] of selected) if (ref) references.set(key, ref);
  return { revisionId, references, checkpointDistance: persistedDistance ?? Math.min(checkpointDistance, REPOSITORY_LIMITS.checkpointRevisions), checkpointBytes: Math.min(persistedBytes ?? checkpointBytes, REPOSITORY_LIMITS.checkpointChangesetBytes) };
}
export async function materializeProjection(backend: RepositoryBackend, target: RecordReference, checkpoints: RecordReference[] = [], generation = 0, signal?: AbortSignal): Promise<RepositoryProjection> {
  const { revisionId, references } = await materializeEntityReferences(backend, target, checkpoints, signal);
  const entities = new Map<EntityKey, EntityDTO>();
  for (const [key, ref] of references) {
    const record = await readRecord(backend, ref, signal);
    const dto = record.payload as unknown as EntityDTO;
    if (record.kind !== 'object' || !dto.type || !Number.isSafeInteger(dto.schemaVersion)) throw new RepositoryError('corrupt', 'Entity reference has wrong record type');
    entities.set(key, dto);
  }
  return { revisionId, generation, entities };
}
/** Checkpoints split mappings at bounded record boundaries and never duplicate payloads. */
export function checkpointRecords(revisionId: string, entries: Iterable<[EntityKey, RecordReference]>, id = `checkpoint-${crypto.randomUUID()}`): { records: PublicationBatch['records']; rootId: string } {
  const blocks: Array<Array<{ entityKey: string; reference: RecordReference }>> = [];
  let block: Array<{ entityKey: string; reference: RecordReference }> = [];
  let size = 0;
  for (const [entityKey, reference] of entries) {
    const entry = { entityKey, reference }; const bytes = canonicalBytes(entry).length;
    if (block.length && size + bytes > 512 * 1024) { blocks.push(block); block = []; size = 0; }
    block.push(entry); size += bytes;
  }
  if (block.length) blocks.push(block);
  const records: PublicationBatch['records'] = blocks.map((items, i) => ({ id: `${id}-${i}`, build: () => ({ kind: 'checkpoint', schemaVersion: 1, payload: { entries: items } as unknown as JsonValue, references: items.map(entry => entry.reference), blobs: [] }) }));
  records.push({ id, build: resolve => {
    const refs = blocks.map((_, i) => resolve(`${id}-${i}`));
    const record: RepositoryRecord = { kind: 'checkpoint', schemaVersion: 1, payload: { revisionId, blocks: refs } as unknown as JsonValue, references: refs, blobs: [] };
    return record;
  } });
  return { records, rootId: id };
}
