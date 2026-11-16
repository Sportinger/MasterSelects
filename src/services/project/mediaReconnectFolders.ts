import type { MediaFile } from '../../stores/mediaStore';
import { getProjectMediaSourceRootStates, normalizeProjectSourceRelativePath } from './mediaSourceRoots';
import { mediaFilesNeedingAccess, offlineMediaFiles } from './mediaReconnect';

/**
 * Offline media grouped by the folder they were last found in, so the reconnect dialog can name
 * each folder and re-allow it directly instead of asking the user to search for it again.
 *
 * - `prompt`: the folder is remembered in this browser; one click re-allows it without a picker.
 * - `granted`: the folder is allowed, but the files are no longer in it (moved, renamed, other drive).
 * - `missing`: this browser does not know the folder (new origin, cleared site data); it must be chosen.
 */
export type OfflineMediaFolderAccess = 'prompt' | 'granted' | 'missing';

export interface OfflineMediaFolder {
  /** Source root id, or `files:<folder>` for media saved without a source root. */
  key: string;
  rootId?: string;
  /** Folder the user picked back then, e.g. `Ute_Marlene`. */
  name: string;
  /** Subfolder inside it that holds all missing files of this group, e.g. `Audio_Stems`. */
  subPath?: string;
  files: string[];
  access: OfflineMediaFolderAccess;
  /** Where the folder picker should open: the remembered folder or a remembered file in it. */
  startIn: FileSystemHandle | null;
}

function directoryOf(path: string | undefined): string[] {
  const normalized = normalizeProjectSourceRelativePath(path);
  return normalized ? normalized.split('/').slice(0, -1) : [];
}

function commonPrefix(paths: string[][]): string[] {
  if (paths.length === 0) return [];
  const [first, ...rest] = paths;
  let length = first!.length;
  for (const path of rest) {
    let index = 0;
    while (index < length && index < path.length && path[index] === first![index]) index++;
    length = index;
  }
  return first!.slice(0, length);
}

function joinPath(segments: string[]): string | undefined {
  return segments.length ? segments.join('/') : undefined;
}

/** Offline media by remembered folder; folders that need only a click come first. */
export async function offlineMediaFolders(files: MediaFile[] = offlineMediaFiles()): Promise<OfflineMediaFolder[]> {
  if (files.length === 0) return [];
  const [roots, fileAccess] = await Promise.all([getProjectMediaSourceRootStates(), mediaFilesNeedingAccess()]);
  const rootsById = new Map(roots.map(root => [root.id, root]));
  const fileHandles = new Map(fileAccess.map(entry => [entry.mediaId, entry.handle]));
  const groups = new Map<string, { root?: typeof roots[number]; media: MediaFile[]; dirs: string[][] }>();

  for (const file of files) {
    const root = file.sourceRootId ? rootsById.get(file.sourceRootId) : undefined;
    // Media without a known source root still carry the folder path they were imported from.
    const fallbackDir = directoryOf(file.filePath);
    const key = root ? root.id : `files:${fallbackDir.join('/')}`;
    const group = groups.get(key) ?? { root, media: [], dirs: [] };
    group.media.push(file);
    group.dirs.push(root ? directoryOf(file.sourceRelativePath) : fallbackDir);
    groups.set(key, group);
  }

  const folders = [...groups.entries()].map(([key, { root, media, dirs }]): OfflineMediaFolder => {
    const common = commonPrefix(dirs);
    if (root) {
      const access: OfflineMediaFolderAccess = !root.handle ? 'missing' : root.permission === 'granted' ? 'granted' : 'prompt';
      return {
        key,
        rootId: root.id,
        name: root.name,
        subPath: joinPath(common),
        files: media.map(file => file.name),
        access,
        startIn: root.handle,
      };
    }
    const handle = media.map(file => fileHandles.get(file.id)).find(Boolean) ?? null;
    return {
      key,
      name: common.at(-1) ?? 'Single files',
      subPath: joinPath(common.slice(0, -1)),
      files: media.map(file => file.name),
      access: handle ? 'prompt' : 'missing',
      startIn: handle,
    };
  });
  const order: Record<OfflineMediaFolderAccess, number> = { prompt: 0, missing: 1, granted: 2 };
  return folders.toSorted((left, right) => order[left.access] - order[right.access] || right.files.length - left.files.length);
}

/** Folder picker id per remembered folder: the browser reopens each picker where that folder was chosen. */
export function folderPickerId(folder: Pick<OfflineMediaFolder, 'key'>): string {
  const suffix = folder.key.replace(/[^A-Za-z0-9]/g, '').slice(-20);
  return `ms-media-${suffix || 'files'}`;
}
