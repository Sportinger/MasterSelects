import { RepositoryError, type EntityDTO, type JsonValue, type RecordReference, type RepositoryRecord } from '../contracts';
import { canonicalBytes } from '../segments/canonical';
import { decodeAggregate } from '../domains/jsonBoundary';
const identity = (ref: RecordReference) => `${ref.segmentId}:${ref.offset}:${ref.length}:${ref.hash}`;
function reference(value: unknown): value is RecordReference {
  const ref = value as Partial<RecordReference> | null;
  return Boolean(ref && typeof ref.segmentId === 'string' && /^sha256:[a-f0-9]{64}$/.test(ref.hash ?? '')
    && Number.isSafeInteger(ref.offset) && ref.offset! >= 0 && Number.isSafeInteger(ref.length) && ref.length! > 0);
}
/** Resolves bounded structural import records while retaining the original logical journal ID. */
export async function resolveAggregateJournalValue(value: JsonValue,
  readRecord: (reference: RecordReference) => Promise<RepositoryRecord>): Promise<JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('$repositoryJournalAggregate' in value)) return value;
  const marker = value.$repositoryJournalAggregate;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || typeof marker.rootKey !== 'string' || !reference(marker.blocks))
    throw new RepositoryError('corrupt', 'Malformed aggregate journal marker');
  const entities = new Map<string, EntityDTO>(); const visited = new Set<string>();
  let cursor: RecordReference | null = marker.blocks; let bytes = 0;
  while (cursor) {
    const key = identity(cursor); if (visited.has(key)) throw new RepositoryError('corrupt', 'Cyclic journal aggregate mapping'); visited.add(key);
    const record = await readRecord(cursor); const payload = record.payload;
    if (record.kind !== 'metadata' || !payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.type !== 'journal-aggregate-map' || !Array.isArray(payload.entries)
      || payload.previous !== null && !reference(payload.previous)) throw new RepositoryError('corrupt', 'Malformed journal aggregate mapping');
    const declared = new Set(record.references.map(identity));
    if (payload.previous && !declared.has(identity(payload.previous as unknown as RecordReference))) throw new RepositoryError('corrupt', 'Undeclared journal mapping ancestry');
    for (const entry of payload.entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.entityKey !== 'string' || !reference(entry.reference)
        || !declared.has(identity(entry.reference)) || entities.has(entry.entityKey)) throw new RepositoryError('corrupt', 'Invalid journal aggregate entry');
      const object = await readRecord(entry.reference); const entity = object.payload as unknown as EntityDTO;
      if (object.kind !== 'object' || !entity || typeof entity.type !== 'string' || !Number.isSafeInteger(entity.schemaVersion)
        || entity.value === undefined || !Array.isArray(entity.references) || !Array.isArray(entity.blobs)) throw new RepositoryError('corrupt', 'Invalid journal aggregate object');
      bytes += canonicalBytes(entity).length;
      if (bytes > 32 * 1024 * 1024) throw new RepositoryError('budget', 'Journal aggregate exceeds logical JSON budget');
      entities.set(entry.entityKey, entity);
    }
    cursor = payload.previous as unknown as RecordReference | null;
  }
  if (!entities.has(marker.rootKey)) throw new RepositoryError('corrupt', 'Missing journal aggregate root');
  return decodeAggregate(marker.rootKey, entities);
}
