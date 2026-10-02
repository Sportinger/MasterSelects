import { PROJECT_FOLDERS } from '../../core/constants';

/**
 * Physical layout of a legacy `.msproj` project folder, mirroring the old package loader
 * (`getPackagedPhysicalFolderPath` / `getFsaProjectFolderReadCandidates`). Package entries
 * use logical project paths; linked files live below the media folder, caches below its
 * hidden cache folder. Auto-migrated projects (media folder `Raw`) keep the logical layout.
 */
const CACHE_FOLDER = '.masterselects-cache';
const CACHE_CHILDREN = new Set<string>([PROJECT_FOLDERS.PROXY, PROJECT_FOLDERS.AUDIO_PROXIES, PROJECT_FOLDERS.BACKUPS]);
const MEDIA_CHILDREN = new Set<string>([PROJECT_FOLDERS.DOWNLOADS, PROJECT_FOLDERS.RENDERS, 'Geometry']);
/** Root folders the old loaders read directly or as legacy fallback candidates. */
const ROOT_FOLDERS = new Set<string>([...Object.values(PROJECT_FOLDERS).map(folder => folder.split('/')[0]), 'Geometry']);

/** Media, proxies, renders and caches stay in the old folder; imports link rather than copy them. */
const LINKED_FOLDERS = new Set<string>([PROJECT_FOLDERS.RAW, PROJECT_FOLDERS.PROXY, PROJECT_FOLDERS.AUDIO_PROXIES, PROJECT_FOLDERS.RENDERS,
  PROJECT_FOLDERS.DOWNLOADS, PROJECT_FOLDERS.BACKUPS, PROJECT_FOLDERS.CACHE]);
export function isLegacyLinkedPath(path: string): boolean {
  const [head, rest] = split(path);
  return Boolean(rest) && LINKED_FOLDERS.has(head);
}
/**
 * How a physical file of the old folder takes part in conversion and in the source proof:
 * imported files are copied and fully hashed, linked media contribute path and size only, and
 * unrelated files (backups next to the package, foreign folders) are neither read nor proven.
 */
export type LegacySourceRole = 'imported' | 'linked' | 'ignored';
export function legacySourceRole(physical: string, mediaFolder: string, packagePath: string | null): LegacySourceRole {
  if (!physical.includes('/')) return physical === packagePath || packagePath === null && physical.endsWith('.json') ? 'imported' : 'ignored';
  const logical = legacyLogicalPath(physical, mediaFolder);
  return logical === null ? 'ignored' : isLegacyLinkedPath(logical) ? 'linked' : 'imported';
}

function split(path: string): [string, string] {
  const index = path.indexOf('/');
  return index < 0 ? [path, ''] : [path.slice(0, index), path.slice(index + 1)];
}

/** Candidate physical paths for a logical package path, preferred first. */
export function legacyPhysicalCandidates(path: string, mediaFolder: string): string[] {
  const [head, rest] = split(path);
  if (!rest) return [path];
  // Linked artifacts and terrain always use the media folder, even in the migrated layout.
  if (head === PROJECT_FOLDERS.CACHE && rest.startsWith('artifacts/')) return [`${mediaFolder}/${CACHE_FOLDER}/${rest}`, path];
  if (head === 'Geometry') return [`${mediaFolder}/${path}`, path];
  if (mediaFolder === PROJECT_FOLDERS.RAW) return [path];
  if (head === PROJECT_FOLDERS.RAW) return [`${mediaFolder}/${rest}`, path];
  if (head === PROJECT_FOLDERS.CACHE) return [`${mediaFolder}/${CACHE_FOLDER}/${rest}`, path];
  if (CACHE_CHILDREN.has(head)) return [`${mediaFolder}/${CACHE_FOLDER}/${path}`, path];
  if (MEDIA_CHILDREN.has(head)) return [`${mediaFolder}/${path}`, path];
  return [path];
}

/** Logical package path of a physical source file, or null when it is not project content. */
export function legacyLogicalPath(physical: string, mediaFolder: string): string | null {
  const [head, rest] = split(physical);
  if (!rest) return null; // Top-level files: the package itself, `.bak` copies, notes.
  if (head !== mediaFolder) return ROOT_FOLDERS.has(head) ? physical : null;
  const [child, childRest] = split(rest);
  if (child === CACHE_FOLDER) {
    if (!childRest) return null;
    const [cacheChild] = split(childRest);
    if (childRest.startsWith('artifacts/')) return `${PROJECT_FOLDERS.CACHE}/${childRest}`;
    if (mediaFolder === PROJECT_FOLDERS.RAW) return null;
    return CACHE_CHILDREN.has(cacheChild) ? childRest : `${PROJECT_FOLDERS.CACHE}/${childRest}`;
  }
  if (child === 'Geometry') return rest;
  if (mediaFolder === PROJECT_FOLDERS.RAW) return physical;
  return MEDIA_CHILDREN.has(child) ? rest : `${PROJECT_FOLDERS.RAW}/${rest}`;
}
