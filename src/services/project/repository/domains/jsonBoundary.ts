import type { BlobReference, EntityDTO, JsonValue } from '../contracts';

/** No stringify-based cloning: it silently loses handles, nonfinite numbers and holes. */
export function domainJson(value: unknown, path = '$', seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Nonfinite domain number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError(`Non-JSON domain value at ${path}`);
  if (seen.has(value)) throw new TypeError(`Cyclic domain value at ${path}`);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError(`Runtime object at ${path}`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return Array.from(value, (item, index) => domainJson(item, `${path}[${index}]`, seen));
    const result: Record<string, JsonValue> = Object.create(null);
    for (const key of Object.keys(value).toSorted()) {
      if (key === '__proto__') throw new TypeError(`Reserved domain key at ${path}.${key}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new TypeError(`Accessor in domain at ${path}.${key}`);
      if (descriptor.value !== undefined) result[key] = domainJson(descriptor.value, `${path}.${key}`, seen);
    }
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`Symbol domain field at ${path}`);
    return result;
  } finally { seen.delete(value); }
}

export const BLOCK_BYTES = 48 * 1024;
const encoder = new TextEncoder();
function byteLength(value: JsonValue): number { return encoder.encode(JSON.stringify(value)).length; }
export function entityKey(domain: string, owner: string, id: string): string {
  return [domain, owner, id].map(encodeURIComponent).join('/');
}
export function entityDependencies(value: JsonValue, result = new Set<string>()): Set<string> {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && typeof value.$repositoryEntity === 'string') result.add(value.$repositoryEntity);
    for (const child of Object.values(value)) entityDependencies(child, result);
  }
  return result;
}

/** Structural blocks use stable aggregate-relative keys. A changed clip never scans sibling clips. */
export function encodeAggregate(key: string, type: string, input: unknown, blobs: BlobReference[] = []): Map<string, EntityDTO> {
  const entities = new Map<string, EntityDTO>();
  const put = (blockKey: string, blockType: string, value: JsonValue) => {
    if (byteLength(value) > 256 * 1024) throw new RangeError(`Domain block too large: ${blockKey}`);
    entities.set(blockKey, { type: blockType, schemaVersion: 1, value, references: [], blobs: blockKey === key ? blobs : [] });
  };
  const pack = (value: JsonValue, path: string): JsonValue => {
    if (typeof value === 'string' && encoder.encode(value).length > BLOCK_BYTES) {
      const blocks: JsonValue[] = [];
      // Fixed UTF-16 boundaries are lossless, including a surrogate crossing a block.
      for (let offset = 0; offset < value.length; offset += 8_192) {
        const blockKey = `${key}/block/${path}/${offset / 8_192}`;
        put(blockKey, 'domain-string-block', value.slice(offset, offset + 8_192));
        blocks.push({ $repositoryEntity: blockKey });
      }
      return { $repositoryShape: 'string', blocks: pack(blocks, `${path}/members`) };
    }
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const items = value.map((item, index) => pack(item, `${path}/${index}`));
      if (items.length <= 128 && byteLength(items) <= BLOCK_BYTES) return items;
      const blocks: JsonValue[] = [];
      let block: JsonValue[] = [];
      const flush = () => {
        const blockKey = `${key}/block/${path}/${blocks.length}`;
        put(blockKey, 'domain-array-block', block);
        blocks.push({ $repositoryEntity: blockKey }); block = [];
      };
      for (const item of items) {
        if (block.length && (block.length >= 128 || byteLength([...block, item]) > BLOCK_BYTES)) flush();
        block.push(item);
      }
      if (block.length) flush();
      return { $repositoryShape: 'array', blocks: blocks.length > 128 ? pack(blocks, `${path}/members`) : blocks };
    }
    const packed = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, pack(child, `${path}/${encodeURIComponent(name)}`)]));
    if (byteLength(packed) <= BLOCK_BYTES) return packed;
    const entries = Object.entries(packed).map(([name, child]) => [name, child] as JsonValue);
    return { $repositoryShape: 'object', entries: pack(entries, `${path}/entries`) };
  };
  put(key, type, pack(domainJson(input), 'root'));
  return entities;
}

export interface DecodeAggregateOptions {
  /**
   * Project opening only: a missing membership list (a dangling reference written by an older
   * build) decodes as empty instead of making the whole project unopenable. Callers report it.
   */
  onMissingMembership?: (entityId: string) => void;
}
export function decodeAggregate(key: string, entities: ReadonlyMap<string, EntityDTO>, options: DecodeAggregateOptions = {}): JsonValue {
  const active = new Set<string>();
  const read = (entityId: string): JsonValue => {
    if (active.has(entityId)) throw new TypeError(`Cyclic domain reference: ${entityId}`);
    const entity = entities.get(entityId);
    if (!entity && options.onMissingMembership && entityId.startsWith('membership/')) {
      options.onMissingMembership(entityId);
      return [];
    }
    if (!entity || entity.schemaVersion !== 1) throw new TypeError(`Missing/unsupported domain entity: ${entityId}`);
    active.add(entityId);
    try { return unpack(entity.value); } finally { active.delete(entityId); }
  };
  const unpack = (value: JsonValue): JsonValue => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(unpack);
    if (typeof value.$repositoryEntity === 'string') return read(value.$repositoryEntity);
    if (value.$repositoryShape === 'array' || value.$repositoryShape === 'string') {
      const refs = unpack(value.blocks);
      if (!Array.isArray(refs)) throw new TypeError('Invalid block membership');
      if (value.$repositoryShape === 'string') {
        if (refs.some((part) => typeof part !== 'string')) throw new TypeError('Invalid string block');
        return refs.join('');
      }
      if (refs.some((part) => !Array.isArray(part))) throw new TypeError('Invalid array block');
      return refs.flat() as JsonValue[];
    }
    if (value.$repositoryShape === 'object') {
      const entries = unpack(value.entries);
      if (!Array.isArray(entries)) throw new TypeError('Invalid object block');
      const result: Record<string, JsonValue> = Object.create(null);
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || entry[0] === '__proto__') throw new TypeError('Invalid domain entry');
        result[entry[0]] = entry[1];
      }
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, unpack(child)]));
  };
  return read(key);
}
