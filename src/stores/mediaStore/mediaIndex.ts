// Shared id-indexes for mediaStore arrays.
//
// The cache is keyed on the array *reference* (WeakMap), so the Map is rebuilt
// only when the underlying array changes — zustand replaces the array on every
// mutation — and is shared across all subscribers. This turns the per-clip
// `s.files.find(...)` / `s.compositions.find(...)` lookups (O(n) per clip, i.e.
// O(clips × items)) into O(1) Map.get lookups, building the index at most once
// per array change regardless of how many clips read it. (issue #228)

const idIndexCache = new WeakMap<object, Map<string, unknown>>();

/**
 * Returns a cached `id -> item` Map for the given array. The Map is memoized on
 * the array reference, so repeated calls with the same array are O(1) and shared.
 */
export function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  let map = idIndexCache.get(items);
  if (!map) {
    map = new Map(items.map((item) => [item.id, item] as [string, unknown]));
    idIndexCache.set(items, map);
  }
  return map as Map<string, T>;
}
