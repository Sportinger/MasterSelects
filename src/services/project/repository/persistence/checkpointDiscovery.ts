import { RepositoryError, type CommitReference, type RecordReference, type RepositoryBackend } from '../contracts';
import { commitPath, readCommit } from './publication';
import { readRecord } from '../segments/recordSegment';

// Proven heads are scoped to the actual backend instance, never inferred from directory contents.
const recoveredHeads = new WeakMap<RepositoryBackend, CommitReference | null>();
export function rememberRecoveredHead(backend: RepositoryBackend, head: CommitReference | null): void {
  recoveredHeads.set(backend, head);
}
/** Legacy side-by-side checkpoints must belong to authenticated confirmed publication ancestry. */
export async function discoverLegacyCheckpoints(backend: RepositoryBackend, revisions: ReadonlyMap<string, RecordReference>,
  signal?: AbortSignal, confirmedHead?: CommitReference | null): Promise<Map<string, RecordReference>> {
  const hints = new Map<string, RecordReference>();
  let previous = confirmedHead === undefined ? recoveredHeads.get(backend) : confirmedHead;
  let upperOperation = Infinity;
  while (previous) {
    signal?.throwIfAborted();
    const item = await readCommit(backend, commitPath(previous.commitId), signal);
    if (item.reference.hash !== previous.hash || item.commit.lastOperation >= upperOperation) throw new RepositoryError('corrupt', 'Damaged confirmed checkpoint ancestry');
    upperOperation = item.commit.firstOperation;
    const commit = item.commit;
    for (const reference of commit.checkpoints) {
      const record = await readRecord(backend, reference, signal);
      const payload = record.payload as { revisionId?: string };
      const revision = payload.revisionId ? revisions.get(payload.revisionId) : undefined;
      if (record.kind === 'checkpoint' && revision && commit.segments.some(segment => segment.segmentId === revision.segmentId) && !hints.has(payload.revisionId!)) hints.set(payload.revisionId!, reference);
    }
    previous = commit.previous;
  }
  return hints;
}
