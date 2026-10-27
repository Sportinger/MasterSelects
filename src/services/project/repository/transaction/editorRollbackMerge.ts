import { Logger } from '../../../logger';

const log = Logger.create('EditorRollback');

/**
 * Runtime rollback of a cancelled editor transaction that keeps other transactions' edits.
 *
 * A transaction remembers, per store field it wrote, the value before and after its write. Undoing that write on
 * the current value must not throw away what other transactions changed in the same field meanwhile (a background
 * result, a user edit during an assistant tool's await): they are committed revisions of their own. So the write is
 * taken back per item (arrays of `{ id }` items, Maps, Sets, arrays of unique primitive values, plain records):
 * only the items this write changed return to their earlier value. A plain value returns only when nobody else
 * changed it since; otherwise the later value stays. Where a per-item revert would be ambiguous (duplicates, a
 * reorder, a key another transaction changed too) the later value stays and the conflict is logged.
 */
export function revertFieldWrite(current: unknown, before: unknown, after: unknown, field = 'field'): unknown {
  if (Object.is(current, after) || shallowEqual(current, after)) return before;
  if (isIdentifiedList(before) && isIdentifiedList(after) && isIdentifiedList(current)) return revertList(current, before, after);
  if (before instanceof Map && after instanceof Map && current instanceof Map) return revertMap(current, before, after);
  if (before instanceof Set && after instanceof Set && current instanceof Set) return revertSet(current, before, after);
  if (isPrimitiveList(before) && isPrimitiveList(after) && isPrimitiveList(current)) return revertPrimitiveList(current, before, after, field);
  if (isPlainRecord(before) && isPlainRecord(after) && isPlainRecord(current)) return revertRecord(current, before, after, field);
  // Someone else replaced the value after this write: their value is committed and stays.
  log.debug(`Cancel keeps the later value of ${field}: another transaction changed it after the cancelled write`);
  return current;
}

type Identified = { id: string };
function isIdentifiedList(value: unknown): value is Identified[] {
  return Array.isArray(value) && value.every(item => item !== null && typeof item === 'object' && typeof (item as Identified).id === 'string');
}

function revertList(current: Identified[], before: Identified[], after: Identified[]): Identified[] {
  const beforeById = new Map(before.map((item, index) => [item.id, { item, index }]));
  const afterById = new Map(after.map(item => [item.id, item]));
  const changed = new Set<string>();
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    if (beforeById.get(id)?.item !== afterById.get(id)) changed.add(id);
  }
  if (!changed.size) return current;
  // Items this write added go; items it changed or removed come back as they were.
  const result = current.filter(item => !changed.has(item.id) || beforeById.has(item.id))
    .map(item => (changed.has(item.id) ? beforeById.get(item.id)!.item : item));
  const present = new Set(result.map(item => item.id));
  for (const id of changed) {
    const original = beforeById.get(id);
    if (!original || present.has(id)) continue;
    result.splice(Math.min(original.index, result.length), 0, original.item);
  }
  return result;
}

function revertMap(current: Map<unknown, unknown>, before: Map<unknown, unknown>, after: Map<unknown, unknown>): Map<unknown, unknown> {
  const result = new Map(current);
  let touched = false;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) === after.get(key) && before.has(key) === after.has(key)) continue;
    touched = true;
    if (before.has(key)) result.set(key, before.get(key)); else result.delete(key);
  }
  return touched ? result : current;
}

function revertSet(current: Set<unknown>, before: Set<unknown>, after: Set<unknown>): Set<unknown> {
  const result = new Set(current);
  let touched = false;
  for (const value of after) if (!before.has(value)) { result.delete(value); touched = true; }
  for (const value of before) if (!after.has(value)) { result.add(value); touched = true; }
  return touched ? result : current;
}

type Primitive = string | number | boolean | null | undefined;
function isPrimitiveList(value: unknown): value is Primitive[] {
  return Array.isArray(value) && value.every(item => item === null || (typeof item !== 'object' && typeof item !== 'function'));
}
const isUnique = (values: Primitive[]) => new Set(values).size === values.length;

/** Arrays of unique ids or names (open tabs, selections): the write's additions go, its removals come back. */
function revertPrimitiveList(current: Primitive[], before: Primitive[], after: Primitive[], field: string): Primitive[] {
  if (!isUnique(before) || !isUnique(after) || !isUnique(current)) {
    log.warn(`Cancel keeps ${field}: it holds repeated values, so the cancelled write cannot be taken back per item`);
    return current;
  }
  const beforeSet = new Set(before), afterSet = new Set(after);
  const added = after.filter(value => !beforeSet.has(value));
  const removed = before.filter(value => !afterSet.has(value));
  if (!added.length && !removed.length) {
    log.warn(`Cancel keeps the order of ${field}: the cancelled write reordered it and another transaction changed it since`);
    return current;
  }
  const addedSet = new Set(added);
  const result = current.filter(value => !addedSet.has(value));
  for (const value of removed) {
    if (result.includes(value)) continue;
    result.splice(Math.min(before.indexOf(value), result.length), 0, value);
  }
  return result;
}

type PlainRecord = Record<string, unknown>;
function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Records (slot assignments, per-id settings): each key the write changed returns, unless someone changed it too. */
function revertRecord(current: PlainRecord, before: PlainRecord, after: PlainRecord, field: string): PlainRecord {
  const result: PlainRecord = { ...current };
  const conflicts: string[] = [];
  let touched = false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (Object.is(before[key], after[key]) && (key in before) === (key in after)) continue;
    if (!Object.is(current[key], after[key]) || (key in current) !== (key in after)) { conflicts.push(key); continue; }
    touched = true;
    if (key in before) result[key] = before[key]; else delete result[key];
  }
  if (conflicts.length) log.warn(`Cancel keeps ${field} keys another transaction changed after the cancelled write: ${conflicts.join(', ')}`);
  return touched ? result : current;
}

/** Same container kind with the same entries by identity: the value another write left is this write's result. */
function shallowEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => key in right && Object.is(left[key], right[key]));
  }
  return false;
}
