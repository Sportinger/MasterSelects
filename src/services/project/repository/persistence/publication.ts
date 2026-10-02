import { validateCommit, type RecoveryProofs } from './recovery';
import { REPOSITORY_LIMITS, RepositoryError, type CommitManifest, type CommitReference, type RecordReference, type RepositoryBackend, type RepositoryDescriptor, type RepositoryOwner, type RepositoryRecord } from '../contracts';
import { canonicalBytes, hashBytes, parseJson } from '../segments/canonical';
import { SegmentBuilder, segmentPath, validateRecord, type PreparedSegment } from '../segments/recordSegment';

export type PublicationPointer = RecordReference | string;
export interface PublicationBatch {
  batchId: string;
  firstOperation: number;
  lastOperation: number;
  records: Array<{ id: string; build(resolve: (id: string) => RecordReference): RepositoryRecord }>;
  heads: Record<string, PublicationPointer>;
  checkpoints?: PublicationPointer[];
}
export interface PublicationResult {
  commit: CommitManifest;
  reference: CommitReference;
  records: ReadonlyMap<string, RecordReference>;
}
export interface PreparedPublication extends PublicationResult { segments: PreparedSegment[]; bytes: Uint8Array; }
export const commitPath = (id: string): string => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new RepositoryError('corrupt', 'Invalid commit ID');
  return `.masterselects/commits/${id}.json`;
};
export async function* oneChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> { yield bytes; }
export async function preparePublication(batch: PublicationBatch, descriptor: RepositoryDescriptor, owner: RepositoryOwner, previous: CommitReference | null): Promise<PreparedPublication> {
  if (!batch.batchId || !Number.isSafeInteger(batch.firstOperation) || batch.firstOperation < 1 || !Number.isSafeInteger(batch.lastOperation) || batch.lastOperation < batch.firstOperation) throw new RepositoryError('corrupt', 'Invalid publication operation range');
  const builder = new SegmentBuilder();
  const records = new Map<string, RecordReference>();
  const resolve = (id: string): RecordReference => {
    const ref = records.get(id);
    if (!ref) throw new RepositoryError('corrupt', `Unresolved batch record ${id}`);
    return ref;
  };
  let bytesUsed = 0;
  for (const item of batch.records) {
    if (records.has(item.id)) throw new RepositoryError('corrupt', 'Duplicate batch record ID');
    const record = item.build(resolve); validateRecord(record);
    const ref = await builder.add(record); records.set(item.id, ref); bytesUsed += ref.length + 4;
    if (bytesUsed > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Publication exceeds queue byte budget');
  }
  await builder.seal();
  const pointer = (value: PublicationPointer): RecordReference => typeof value === 'string' ? resolve(value) : value;
  const commit: CommitManifest = {
    format: 'masterselects-commit', schemaVersion: 1, repositoryId: descriptor.repositoryId,
    commitId: crypto.randomUUID(), batchId: batch.batchId, previous, writerEpoch: owner.writerEpoch,
    firstOperation: batch.firstOperation, lastOperation: batch.lastOperation,
    segments: builder.segments.map(segment => segment.descriptor),
    heads: Object.fromEntries(Object.entries(batch.heads).map(([key, value]) => [key, pointer(value)])),
    checkpoints: (batch.checkpoints ?? []).map(pointer),
  };
  const bytes = canonicalBytes(commit);
  if (bytes.length > REPOSITORY_LIMITS.recordBytes) throw new RepositoryError('budget', 'Commit descriptor block exceeds bounded manifest size');
  return { commit, reference: { commitId: commit.commitId, hash: await hashBytes(bytes) }, records, segments: builder.segments, bytes };
}
async function writeVerified(backend: RepositoryBackend, path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  const existing = await backend.stat(path);
  if (existing && existing.length !== bytes.length) throw new RepositoryError('corrupt', `Immutable path has conflicting length: ${path}`);
  if (!existing) {
    try { await backend.writeNew(path, oneChunk(bytes), signal); }
    catch (cause) {
      // Lost completion acknowledgement is resolved from immutable bytes, never overwritten.
      const stat = await backend.stat(path);
      if (!stat || stat.length !== bytes.length) throw cause;
    }
  }
  const read = await backend.read(path, 0, bytes.length, signal);
  if ((await backend.stat(path))?.length !== bytes.length || read.length !== bytes.length || await hashBytes(read) !== await hashBytes(bytes)) throw new RepositoryError('corrupt', `Immutable write verification failed: ${path}`);
}
export async function writePublication(backend: RepositoryBackend, owner: RepositoryOwner, publication: PreparedPublication, signal?: AbortSignal, proofs?: RecoveryProofs): Promise<void> {
  await owner.assertOwned();
  for (const segment of publication.segments) { await owner.assertOwned(); await writeVerified(backend, segmentPath(segment.descriptor.segmentId), segment.bytes, signal); }
  // Missing/corrupt dependencies cannot become a committed manifest merely because framing is valid.
  await validateCommit(backend, publication.commit, { repositoryId: publication.commit.repositoryId }, signal, proofs);
  await owner.assertOwned();
  const path = commitPath(publication.commit.commitId);
  if (backend.publishCommit && !await backend.stat(path)) {
    try { await backend.publishCommit(path, publication.bytes, publication.commit.previous, owner, signal); }
    catch (cause) { if (!await backend.stat(path)) throw cause; }
  }
  await writeVerified(backend, path, publication.bytes, signal);
}
export async function readCommit(backend: RepositoryBackend, path: string, signal?: AbortSignal): Promise<{ commit: CommitManifest; reference: CommitReference }> {
  const stat = await backend.stat(path);
  if (!stat || stat.length > REPOSITORY_LIMITS.recordBytes) throw new RepositoryError('corrupt', 'Invalid commit manifest length');
  const bytes = await backend.read(path, 0, stat.length, signal);
  if (bytes.length !== stat.length) throw new RepositoryError('corrupt', 'Truncated commit manifest');
  const commit = parseJson<CommitManifest>(bytes);
  if (commit.format !== 'masterselects-commit' || commit.schemaVersion !== 1 || !commit.repositoryId || !commit.batchId || !commit.writerEpoch || !Number.isSafeInteger(commit.firstOperation) || commit.firstOperation < 1 || !Number.isSafeInteger(commit.lastOperation) || commit.lastOperation < commit.firstOperation || !Array.isArray(commit.segments) || !Array.isArray(commit.checkpoints) || !commit.heads || commitPath(commit.commitId) !== path) throw new RepositoryError('corrupt', 'Invalid commit manifest');
  if (commit.previous !== null && (typeof commit.previous !== 'object' || !commit.previous)) throw new RepositoryError('corrupt', 'Missing predecessor reference');
  if (commit.previous && (!/^sha256:[a-f0-9]{64}$/.test(commit.previous.hash) || !commit.previous.commitId)) throw new RepositoryError('corrupt', 'Invalid predecessor reference');
  return { commit, reference: { commitId: commit.commitId, hash: await hashBytes(bytes) } };
}
