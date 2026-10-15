import type { JsonValue } from '../contracts';
import { encodeAggregate } from '../domains/jsonBoundary';
import { canonicalBytes } from '../segments/canonical';
import type { DraftRecord } from '../storageWorkerProtocol';

// Journal JSON is opaque evidence: a tool result can legitimately contain the
// codec's reserved keys. Object-entry shapes reconstruct those keys as data.
function escapeDomainMarkers(value: JsonValue): JsonValue {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(escapeDomainMarkers);
  const entries = Object.entries(value).map(([key, child]) => [key, escapeDomainMarkers(child)] as [string, JsonValue]);
  return '$repositoryEntity' in value || '$repositoryShape' in value
    ? { $repositoryShape: 'object', entries }
    : Object.fromEntries(entries);
}

/** Uses the existing import-journal representation; old readers already understand it. */
export function draftJournalAggregate(value: JsonValue): { value: JsonValue; records: DraftRecord[]; references: string[] } {
  if (canonicalBytes(value).length <= 256 * 1024) return { value, records: [], references: [] };
  const rootKey = 'journal/value';
  const entities = encodeAggregate(rootKey, 'journal-value', escapeDomainMarkers(value));
  const records: DraftRecord[] = [];
  let entries: JsonValue[] = [], references: string[] = [], previous: string | null = null;
  const local = (id: string): JsonValue => ({ $record: id });
  const seal = () => {
    const id = `journal-map-${records.length}`;
    records.push({ id, kind: 'metadata', schemaVersion: 1,
      payload: { type: 'journal-aggregate-map', entries, previous: previous ? local(previous) : null },
      references: [...references, ...(previous ? [previous] : [])], blobs: [] });
    previous = id; entries = []; references = [];
  };
  for (const [entityKey, entity] of entities) {
    const id = `journal-object-${records.length}`;
    records.push({ id, kind: 'object', schemaVersion: 1, payload: entity as unknown as JsonValue,
      references: entity.references, blobs: entity.blobs });
    entries.push({ entityKey, reference: local(id) }); references.push(id);
    if (entries.length >= 128) seal();
  }
  if (entries.length) seal();
  return { records, references: [previous!], value: { $repositoryJournalAggregate: { rootKey, blocks: local(previous!) } } };
}
