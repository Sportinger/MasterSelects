import { REPOSITORY_LIMITS, RepositoryError, type NavigationPayload, type RecordReference, type RepositoryRecord } from '../contracts';
import { canonicalBytes } from '../segments/canonical';
import { validateReference } from '../segments/recordSegment';
import type { DraftRecord } from '../storageWorkerProtocol';

const BLOCK_BYTES = 128 * 1024;
const BLOCK_TYPE = 'navigation-redo-preferences';

/** Keep long-lived workspace cursors bounded without discarding any branch choices. */
export function draftNavigationRecords(revisionId: string, revision: string | RecordReference,
  workspaceId: string, redoPreferences: Readonly<Record<string, string>>, sequence: number): DraftRecord[] {
  const records: DraftRecord[] = [];
  let entries: Array<[string, string]> = [], bytes = 2;
  const flush = () => {
    records.push({ id: `navigation-redo-${records.length}`, kind: 'object', schemaVersion: 1,
      payload: { type: BLOCK_TYPE, redoPreferences: Object.fromEntries(entries) }, references: [], blobs: [] });
    entries = []; bytes = 2;
  };
  for (const [parent, child] of Object.entries(redoPreferences)) {
    if (typeof child !== 'string') throw new RepositoryError('corrupt', 'Invalid redo preference');
    // Encoded keys/values include JSON escaping and UTF-8, plus colon and comma.
    const size = canonicalBytes(parent).length + canonicalBytes(child).length + 2;
    if (size > BLOCK_BYTES - 2) throw new RepositoryError('budget', 'A redo preference exceeds the navigation block budget');
    if (bytes + size > BLOCK_BYTES) flush();
    entries.push([parent, child]); bytes += size;
  }
  const blocked = records.length > 0;
  if (blocked && entries.length) flush();
  const blockIds = records.map(record => record.id);
  records.push({ id: 'navigation', kind: 'navigation', schemaVersion: 1,
    payload: { workspaceId, sequence, revisionId,
      revision: typeof revision === 'string' ? { $record: revision } : { ...revision },
      redoPreferences: blocked ? {} : Object.fromEntries(entries),
      ...(blocked ? { redoPreferenceBlocks: blockIds.map(id => ({ $record: id })) } : {}) },
    references: [revision, ...blockIds], blobs: [] });
  return records;
}

/** Legacy inline cursors and new blocked cursors share the same logical map. */
export async function readNavigationPreferences(navigation: NavigationPayload,
  read: (reference: RecordReference) => Promise<RepositoryRecord>): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  const append = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RepositoryError('corrupt', 'Malformed redo preferences');
    for (const [parent, child] of Object.entries(value)) {
      if (typeof child !== 'string' || (Object.hasOwn(result, parent) && result[parent] !== child))
        throw new RepositoryError('corrupt', 'Invalid or conflicting redo preference');
      result[parent] = child;
    }
  };
  append(navigation.redoPreferences);
  const blocks = navigation.redoPreferenceBlocks ?? [];
  if (!Array.isArray(blocks)) throw new RepositoryError('corrupt', 'Malformed navigation preference blocks');
  let bytes = 0;
  for (const reference of blocks) {
    if (!reference || typeof reference !== 'object') throw new RepositoryError('corrupt', 'Malformed navigation preference reference');
    validateReference(reference);
    bytes += reference.length;
    if (bytes > REPOSITORY_LIMITS.queueBytes) throw new RepositoryError('budget', 'Navigation preferences exceed the read budget');
    const record = await read(reference);
    const payload = record.payload as { type?: unknown; redoPreferences?: unknown } | null;
    if (record.kind !== 'object' || payload?.type !== BLOCK_TYPE || record.references.length || record.blobs.length)
      throw new RepositoryError('corrupt', 'Invalid navigation preference block');
    append(payload.redoPreferences);
  }
  return result;
}
