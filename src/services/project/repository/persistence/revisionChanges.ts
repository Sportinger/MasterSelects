import { RepositoryError, type EntityChange, type RepositoryBackend, type RevisionPayload } from '../contracts';
import { readRecord, validateReference } from '../segments/recordSegment';
function checked(change: EntityChange): EntityChange {
  if (!change || typeof change.entityKey !== 'string' || !change.entityKey || change.before === undefined || change.after === undefined) throw new RepositoryError('corrupt', 'Malformed entity changeset');
  if (change.before !== null) validateReference(change.before);
  if (change.after !== null) validateReference(change.after);
  return change;
}
/** Never flatten large historical changesets into one unbounded array. */
export async function* iterateRevisionChanges(backend: RepositoryBackend, revision: RevisionPayload,
  signal?: AbortSignal): AsyncGenerator<EntityChange> {
  if (!Array.isArray(revision.changes)) throw new RepositoryError('corrupt', 'Revision changes must be an array');
  if (revision.changeBlocks !== undefined && !Array.isArray(revision.changeBlocks)) throw new RepositoryError('corrupt', 'Malformed changeset block list');
  if (revision.changeBlocks?.length && revision.changes.length) throw new RepositoryError('corrupt', 'Revision mixes inline and block changesets');
  for (const change of revision.changes) { signal?.throwIfAborted(); yield checked(change); }
  for (const reference of revision.changeBlocks ?? []) {
    signal?.throwIfAborted(); validateReference(reference);
    const record = await readRecord(backend, reference, signal);
    const payload = record.payload as unknown as { type: string; changes: EntityChange[] };
    if (record.kind !== 'object' || payload.type !== 'revision-changeset' || !Array.isArray(payload.changes)) throw new RepositoryError('corrupt', 'Revision references invalid changeset block');
    for (const change of payload.changes) { signal?.throwIfAborted(); yield checked(change); }
  }
}
