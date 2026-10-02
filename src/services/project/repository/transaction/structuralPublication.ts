import { RepositoryError, type EntityDTO, type JsonValue, type RecordReference, type RepositoryRecord } from '../contracts';
import type { LogicalEntityChange } from './ProjectTransactionCoordinator';
import type { DraftRecord } from '../storageWorkerProtocol';
const identity = (reference: RecordReference) => `${reference.hash}:${reference.segmentId}:${reference.offset}:${reference.length}`;
function aggregate(key: string) { return key.split('/block/')[0]; }
function dependencies(key: string, value: JsonValue): string[] {
  const found = new Set<string>(); const prefix = `${aggregate(key)}/block/`;
  const visit = (item: JsonValue) => {
    if (!item || typeof item !== 'object') return;
    if (!Array.isArray(item) && typeof item.$repositoryEntity === 'string' && item.$repositoryEntity.startsWith(prefix)) found.add(item.$repositoryEntity);
    Object.values(item).forEach(visit);
  };
  visit(value); return [...found];
}
export interface StructuralPublication {
  records: DraftRecord[]; changes: JsonValue[]; beforeReferences: RecordReference[];
  updates: Map<string, RecordReference | string | null>;
}
/** Refresh only immutable block ancestors. Editable membership IDs deliberately stay projection-bound. */
export async function prepareStructuralPublication(requested: readonly LogicalEntityChange[], current: ReadonlyMap<string, RecordReference>,
  groups: ReadonlyMap<string, ReadonlySet<string>>, read: (reference: RecordReference) => Promise<RepositoryRecord>): Promise<StructuralPublication> {
  const changes = new Map(requested.map(change => [change.entityKey, change]));
  const affected = new Set(requested.filter(change => change.entityKey.includes('/block/')).map(change => aggregate(change.entityKey)));
  const previous = new Map<string, EntityDTO>();
  for (const root of affected) for (const key of groups.get(root) ?? []) {
    const reference = current.get(key); if (!reference) continue;
    const record = await read(reference);
    if (record.kind !== 'object') throw new RepositoryError('corrupt', 'Structural entity pointer has wrong kind');
    previous.set(key, record.payload as unknown as EntityDTO);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, dto] of previous) if (!changes.has(key) && dependencies(key, dto.value).some(child => changes.has(child))) {
      changes.set(key, { entityKey: key, before: dto, after: dto }); grew = true;
    }
  }
  const records: DraftRecord[] = [], updates = new Map<string, RecordReference | string | null>();
  const active = new Set<string>();
  const build = (key: string): void => {
    if (updates.has(key)) return;
    const change = changes.get(key); if (!change) return;
    if (active.has(key)) throw new RepositoryError('corrupt', 'Cyclic structural block publication');
    active.add(key);
    if (!change.after) { updates.set(key, null); active.delete(key); return; }
    const old = previous.get(key);
    const oldStructural = new Set((old ? dependencies(key, old.value) : []).flatMap(child => { const ref = current.get(child); return ref ? [identity(ref)] : []; }));
    const external = change.after.references.filter(ref => !oldStructural.has(identity(ref)));
    const pointers: Array<RecordReference | string> = [...external];
    for (const child of dependencies(key, change.after.value)) {
      build(child);
      const reference = updates.has(child) ? updates.get(child) : current.get(child);
      if (!reference) throw new RepositoryError('corrupt', `Missing structural block ${child}`);
      pointers.push(reference);
    }
    const id = `entity-${records.length}`;
    const value = { ...change.after, references: pointers.map(ref => typeof ref === 'string' ? { $record: ref } : ref) };
    records.push({ id, kind: 'object', schemaVersion: 1, payload: value as unknown as JsonValue, references: pointers, blobs: change.after.blobs });
    updates.set(key, id); active.delete(key);
  };
  for (const key of changes.keys()) build(key);
  const beforeReferences: RecordReference[] = [];
  const encoded: JsonValue[] = [];
  for (const key of changes.keys()) {
    const before = current.get(key) ?? null; if (before) beforeReferences.push(before);
    const after = updates.get(key) ?? null;
    encoded.push({ entityKey: key, before: before as unknown as JsonValue, after: typeof after === 'string' ? { $record: after } : after as unknown as JsonValue });
  }
  return { records, updates, changes: encoded, beforeReferences };
}
