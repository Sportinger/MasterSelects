import { rememberRecoveredHead } from './checkpointDiscovery';
import { recoveryReadCache } from './recoveryReadCache';
import { readNavigationPreferences } from './navigationPreferences';
import type { NavigationPayload } from '../contracts';
import { iterateRevisionChanges } from './revisionChanges';
import { REPOSITORY_LIMITS, RepositoryError, type CommitManifest, type CommitReference, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryRecord, type RevisionPayload, type SegmentDescriptor } from '../contracts';
import { readRecord, segmentRecords } from '../segments/recordSegment';
import { readCommit } from './publication';
import { commitPath } from './publication';
import { verifyBlob } from './blobStorage';

export interface RecoveryResult {
  head: CommitReference | null;
  commit: CommitManifest | null;
  operationSequence: number;
  heads: Record<string, RecordReference>;
  checkpoints: RecordReference[];
  warnings: string[];
}
export async function* commitFiles(backend: RepositoryBackend, signal?: AbortSignal): AsyncGenerator<string> {
  let cursor: string | undefined;
  do {
    if (signal?.aborted) throw new RepositoryError('cancelled', 'Recovery cancelled');
    const page = await backend.list('.masterselects/commits/', cursor, 128, signal);
    for (const path of page.paths) if (path.endsWith('.json')) yield path;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
/**
 * Proofs for immutable, already validated publications. A held owner keeps them for its session, so
 * later publications validate only their new records instead of re-reading imported history.
 */
export interface RecoveryProofs {
  segments: Map<string, SegmentDescriptor>;
  blobs: Set<string>;
  /** Validated record locators (segment:offset:length:hash) inside proven segments. */
  records?: Set<string>;
}
export function createRecoveryProofs(): RecoveryProofs { return { segments: new Map(), blobs: new Set(), records: new Set() }; }
const PROVEN_RECORD_LIMIT = 262144;
// Commit manifests are immutable; each path is parsed and hashed once per backend.
const commitManifests = new WeakMap<RepositoryBackend, Map<string, Awaited<ReturnType<typeof readCommit>>>>();
interface ClosureValidation {
  completed: Set<string>;
  verifiedBlobs: Set<string>;
}
const validationKey = (ref: RecordReference) => `${ref.segmentId}:${ref.offset}:${ref.length}:${ref.hash}`;
/** Frames retain only locators, not payloads. Completed records are shared for this bounded commit. */
async function validateClosure(backend: RepositoryBackend, ref: RecordReference, state: ClosureValidation, newSegments: Set<string>, verifyPublished: (ref: RecordReference) => Promise<void>, readValidated: (ref: RecordReference) => Promise<RepositoryRecord>, signal?: AbortSignal): Promise<void> {
  const stack: Array<{ reference: RecordReference; child: number }> = [{ reference: ref, child: 0 }];
  const active = new Set<string>();
  while (stack.length) {
    signal?.throwIfAborted();
    const frame = stack[stack.length - 1], key = validationKey(frame.reference);
    if (state.completed.has(key)) { stack.pop(); continue; }
    if (frame.child === 0) {
      if (active.has(key)) throw new RepositoryError('corrupt', 'Cyclic record dependency');
      active.add(key);
    }
    const record = await readValidated(frame.reference);
    if (frame.child === 0) for (const blob of record.blobs) {
      const blobKey = `${blob.hash}:${blob.length}`;
      if (!state.verifiedBlobs.has(blobKey)) {
        await verifyBlob(backend, blob, signal); state.verifiedBlobs.add(blobKey);
        if (state.verifiedBlobs.size > 4096) state.verifiedBlobs.delete(state.verifiedBlobs.values().next().value!);
      }
    }
    if (frame.child < record.references.length) {
      const child = record.references[frame.child++];
      if (newSegments.has(child.segmentId)) {
        const childKey = validationKey(child);
        if (active.has(childKey)) throw new RepositoryError('corrupt', 'Cyclic record dependency');
        if (!state.completed.has(childKey)) stack.push({ reference: child, child: 0 });
      } else await verifyPublished(child);
      continue;
    }
    active.delete(key); state.completed.add(key); stack.pop();
  }
}
export async function validateCommit(backend: RepositoryBackend, commit: CommitManifest, descriptor: Pick<RepositoryDescriptor, 'repositoryId'>, signal?: AbortSignal, proofs?: RecoveryProofs): Promise<void> {
  if (commit.repositoryId !== descriptor.repositoryId) throw new RepositoryError('corrupt', 'Foreign repository commit');
  if (commit.segments.reduce((bytes, segment) => bytes + segment.length, 0) > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Commit dependency validation exceeds publication byte budget');
  // A wide checkpoint is visited once per dependency; decoding/hash proof must not repeat per edge.
  // Conservative decoded-object estimates and entry cap bound retained payloads, including deep journals.
  const records = new Map<string, { record: RepositoryRecord; bytes: number }>();
  let retainedBytes = 0;
  const remember = (ref: RecordReference, record: RepositoryRecord): RepositoryRecord => {
    const key = validationKey(ref), bytes = ref.length * 8 + 512;
    const prior = records.get(key);
    if (prior) { records.delete(key); retainedBytes -= prior.bytes; }
    records.set(key, { record, bytes }); retainedBytes += bytes;
    while (retainedBytes > REPOSITORY_LIMITS.objectCacheBytes || records.size > 1024) {
      const oldest = records.keys().next().value!;
      retainedBytes -= records.get(oldest)!.bytes; records.delete(oldest);
    }
    return record;
  };
  const readValidated = async (ref: RecordReference): Promise<RepositoryRecord> => {
    signal?.throwIfAborted();
    const cached = records.get(validationKey(ref));
    if (cached) return remember(ref, cached.record);
    return remember(ref, await readRecord(backend, ref, signal));
  };
  const newSegments = new Set(commit.segments.map(segment => segment.segmentId));
  const closure: ClosureValidation = { completed: new Set(), verifiedBlobs: proofs?.blobs ?? new Set() };
  const verified = new Set<string>();
  const validateTypes = async (record: RepositoryRecord): Promise<void> => {
    if (record.kind === 'revision') {
      const data = record.payload as unknown as RevisionPayload;
      if (!data || !data.revisionId || !data.transactionId || !Array.isArray(data.changes) || typeof data.createdAt !== 'number' || (data.parent === null) !== (data.parentRevisionId === null)) throw new RepositoryError('corrupt', 'Malformed revision payload');
      if (data.parent) {
        const parent = await readValidated(data.parent);
        if (parent.kind !== 'revision' || (parent.payload as unknown as RevisionPayload).revisionId !== data.parentRevisionId) throw new RepositoryError('corrupt', 'Revision parent identity mismatch');
      }
      for await (const change of iterateRevisionChanges(backend, data, signal)) {
        if (!change.entityKey || change.before === undefined || change.after === undefined) throw new RepositoryError('corrupt', 'Malformed entity change');
        for (const ref of [change.before, change.after]) if (ref && (await readValidated(ref)).kind !== 'object') throw new RepositoryError('corrupt', 'Changeset reference has wrong record kind');
      }
    } else if (record.kind === 'navigation') {
      const data = record.payload as unknown as NavigationPayload;
      if (!data || !data.workspaceId || !Number.isSafeInteger(data.sequence) || !data.revision) throw new RepositoryError('corrupt', 'Malformed navigation payload');
      const revision = await readValidated(data.revision);
      if (revision.kind !== 'revision' || (revision.payload as unknown as RevisionPayload).revisionId !== data.revisionId) throw new RepositoryError('corrupt', 'Navigation revision identity mismatch');
      await readNavigationPreferences(data, readValidated);
    }
  };
  const verifyPublished = async (ref: RecordReference): Promise<void> => {
    if (proofs?.records?.has(validationKey(ref)) && proofs.segments.has(ref.segmentId)) return;
    await readValidated(ref);
    if (verified.has(ref.segmentId)) return;
    const proven = proofs?.segments.get(ref.segmentId);
    if (proven) {
      if (ref.offset + ref.length > proven.length) throw new RepositoryError('corrupt', 'Reference exceeds published segment');
      return;
    }
    let previous = commit.previous;
    while (previous) {
      const parent = await readCommit(backend, commitPath(previous.commitId), signal);
      if (parent.reference.hash !== previous.hash) throw new RepositoryError('corrupt', 'Damaged predecessor manifest');
      const segment = parent.commit.segments.find(item => item.segmentId === ref.segmentId);
      if (segment) {
        // Complete predecessor validation already proved this segment's transitive closure.
        for await (const entry of segmentRecords(backend, segment, signal)) { void entry; }
        verified.add(ref.segmentId);
        if (verified.size > 128) verified.delete(verified.values().next().value!);
        return;
      }
      previous = parent.commit.previous;
    }
    throw new RepositoryError('corrupt', 'Record dependency was never published');
  };
  const validatedRecords: string[] = [];
  for (const segment of commit.segments) {
    for await (const entry of segmentRecords(backend, segment, signal)) {
      remember(entry.reference, entry.record); validatedRecords.push(validationKey(entry.reference));
      await validateTypes(entry.record);
      await validateClosure(backend, entry.reference, closure, newSegments, verifyPublished, readValidated, signal);
    }
  }
  for (const ref of Object.values(commit.heads)) {
    if (newSegments.has(ref.segmentId)) await validateClosure(backend, ref, closure, newSegments, verifyPublished, readValidated, signal);
    else await verifyPublished(ref);
  }
  for (const ref of commit.checkpoints) {
    if ((await readValidated(ref)).kind !== 'checkpoint') throw new RepositoryError('corrupt', 'Checkpoint points to wrong record kind');
    if (newSegments.has(ref.segmentId)) await validateClosure(backend, ref, closure, newSegments, verifyPublished, readValidated, signal);
    else await verifyPublished(ref);
  }
  // Only a completely validated commit contributes reusable record proofs.
  if (proofs?.records) for (const key of validatedRecords) {
    proofs.records.add(key);
    if (proofs.records.size > PROVEN_RECORD_LIMIT) proofs.records.delete(proofs.records.values().next().value!);
  }
}

/** Discovery uses one paged scan per recovery, retaining only paths and immutable manifests. */
export async function recoverRepository(backend: RepositoryBackend, descriptor: RepositoryDescriptor, signal?: AbortSignal, visit?: (commit: CommitManifest) => Promise<void>, confirmed?: RecoveryResult, sessionProofs?: RecoveryProofs): Promise<RecoveryResult> {
  const authoritativeBackend = backend;
  backend = recoveryReadCache(backend);
  const proofs: RecoveryProofs = sessionProofs ?? { segments: new Map(), blobs: new Set() };
  let manifests = commitManifests.get(authoritativeBackend);
  if (!manifests) { manifests = new Map(); commitManifests.set(authoritativeBackend, manifests); }
  // A held owner may reuse previously validated immutable ancestry. Only new descendants are revalidated.
  const result: RecoveryResult = confirmed ? { ...confirmed, heads: { ...confirmed.heads }, checkpoints: [...confirmed.checkpoints], warnings: [...confirmed.warnings] }
    : { head: null, commit: null, operationSequence: 0, heads: {}, checkpoints: [], warnings: [] };
  const warn = (message: string): void => { if (result.warnings.length < 128 && !result.warnings.includes(message)) result.warnings.push(message); };
  const discovered: string[] = [];
  for await (const path of commitFiles(backend, signal)) discovered.push(path);
  // Read independent manifests with bounded parallel I/O. Validation and head
  // selection below remain ordered and detect incomplete or divergent history.
  let nextManifest = 0;
  await Promise.all(Array.from({ length: Math.min(8, discovered.length) }, async () => {
    while (nextManifest < discovered.length) {
      const path = discovered[nextManifest++]; signal?.throwIfAborted();
      if (manifests.has(path)) continue;
      try { manifests.set(path, await readCommit(backend, path, signal)); }
      catch (error) { if (signal?.aborted) throw error; warn(`Damaged publication retained: ${path}`); }
    }
  }));
  for (;;) {
    let candidate: Awaited<ReturnType<typeof readCommit>> | null = null;
    for (const path of discovered) {
      signal?.throwIfAborted();
      const item = manifests.get(path); if (!item) continue;
      const predecessorMatches = item.commit.previous?.commitId === result.head?.commitId && item.commit.previous?.hash === result.head?.hash;
      if (!predecessorMatches) continue;
      try {
        if (item.commit.firstOperation !== result.operationSequence + 1) throw new RepositoryError('corrupt', 'Non-contiguous operation range');
        await validateCommit(backend, item.commit, descriptor, signal, proofs);
      } catch (error) { if (signal?.aborted) throw error; warn(`Incomplete publication retained: ${path}`); continue; }
      if (candidate) throw new RepositoryError('conflict', `Divergent complete commits ${candidate.commit.commitId} and ${item.commit.commitId}; both preserved`);
      candidate = item;
    }
    if (!candidate) { rememberRecoveredHead(authoritativeBackend, result.head); return result; }
    // Only complete, selected publication closure becomes reusable ancestry proof.
    for (const segment of candidate.commit.segments) {
      const previous = proofs.segments.get(segment.segmentId);
      if (previous && (previous.hash !== segment.hash || previous.length !== segment.length)) throw new RepositoryError('corrupt', 'Published segment identity changed');
      proofs.segments.set(segment.segmentId, segment);
      if (proofs.segments.size > 4096) proofs.segments.delete(proofs.segments.keys().next().value!);
    }
    result.head = candidate.reference; result.commit = candidate.commit;
    result.operationSequence = candidate.commit.lastOperation;
    Object.assign(result.heads, candidate.commit.heads);
    // Only newest checkpoint hints are retained; old ones remain reachable in immutable commits.
    if (candidate.commit.checkpoints.length) result.checkpoints = candidate.commit.checkpoints;
    if (visit) await visit(candidate.commit);
  }
}
