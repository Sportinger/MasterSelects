import { RepositoryError, type JsonValue, type RepositoryRecord } from '../contracts';

/** Object undefined is omitted; array undefined/holes and foreign prototypes are errors. */
export function canonicalJson(input: unknown): string {
  const ancestors = new Set<object>();
  function encode(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RepositoryError('corrupt', 'Non-finite canonical number');
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (typeof value !== 'object') throw new RepositoryError('corrupt', 'Unsupported canonical value');
    if (ancestors.has(value)) throw new RepositoryError('corrupt', 'Cyclic canonical value');
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
          if (!Object.hasOwn(value, i)) throw new RepositoryError('corrupt', 'Sparse canonical array');
          parts.push(encode(value[i]));
        }
        return `[${parts.join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new RepositoryError('corrupt', 'Runtime object in canonical payload');
      if (Object.getOwnPropertySymbols(value).length) throw new RepositoryError('corrupt', 'Symbol canonical key');
      return `{${Object.keys(value).toSorted().flatMap(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!('value' in descriptor)) throw new RepositoryError('corrupt', 'Accessor canonical field');
        return descriptor.value === undefined ? [] : [`${JSON.stringify(key)}:${encode(descriptor.value)}`];
      }).join(',')}}`;
    } finally { ancestors.delete(value); }
  }
  return encode(input);
}

export const utf8 = new TextEncoder();
export function canonicalBytes(value: unknown): Uint8Array { return utf8.encode(canonicalJson(value)); }
export const canonicalEncode = canonicalBytes;
export function frozenJson<T>(value: T): T {
  const copy = JSON.parse(canonicalJson(value)) as T;
  function freeze(item: unknown): void {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
  }
  freeze(copy);
  return copy;
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Storage addresses never change the identity of a logical object version. */
function logical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(logical);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 4 && typeof value.hash === 'string' && typeof value.segmentId === 'string' && typeof value.offset === 'number' && typeof value.length === 'number') return { hash: value.hash };
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, logical(item)]));
  }
  return value;
}
export async function hashRecord(record: RepositoryRecord): Promise<string> {
  return hashBytes(canonicalBytes({ ...record, payload: logical(record.payload), references: record.references.map(ref => ({ hash: ref.hash })) }));
}
export function parseJson<T>(bytes: Uint8Array): T {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
  catch (cause) { throw new RepositoryError('corrupt', 'Invalid repository JSON', { cause }); }
}
