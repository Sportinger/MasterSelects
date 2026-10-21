// Where a recent project lives, as File > Open Recent and the startup chooser show it.
// After Save permanently the same project name can appear twice (the folder copy and a
// temporary copy that was kept); the location tells them apart.

import type { RecentProjectEntry } from './recentProjects';

export type RecentProjectLocation = 'Folder' | 'Native' | 'Browser local' | 'Temporary';

/**
 * `fallbackActive`: this tab keeps browser projects in the temporary IndexedDB fallback,
 * which decides entries recorded before their store was remembered.
 */
export function recentProjectLocation(entry: Pick<RecentProjectEntry, 'backend' | 'store'>, fallbackActive: boolean): RecentProjectLocation {
  if (entry.backend === 'native') return 'Native';
  if (entry.backend === 'fsa') return 'Folder';
  const store = entry.store ?? (fallbackActive ? 'indexeddb' : 'opfs');
  return store === 'indexeddb' ? 'Temporary' : 'Browser local';
}

/**
 * Most recent first, except that a temporary copy never precedes a permanent project of
 * the same name: the permanent copy is the one to continue with.
 */
export function orderRecentProjectsForChoice<T extends Pick<RecentProjectEntry, 'backend' | 'store' | 'name'>>(entries: readonly T[], fallbackActive: boolean): T[] {
  const key = (entry: T) => entry.name.trim().toLocaleLowerCase();
  const permanentNames = new Set(entries.filter(entry => recentProjectLocation(entry, fallbackActive) !== 'Temporary').map(key));
  const ordered: T[] = [];
  const deferred = new Map<string, T[]>();
  for (const entry of entries) {
    const name = key(entry);
    if (recentProjectLocation(entry, fallbackActive) === 'Temporary' && permanentNames.has(name)) {
      deferred.set(name, [...deferred.get(name) ?? [], entry]);
      continue;
    }
    ordered.push(entry);
  }
  // Each deferred temporary copy follows the last permanent entry of its name.
  for (const [name, copies] of deferred) {
    const after = ordered.findLastIndex(entry => key(entry) === name);
    ordered.splice(after + 1, 0, ...copies);
  }
  return ordered;
}
