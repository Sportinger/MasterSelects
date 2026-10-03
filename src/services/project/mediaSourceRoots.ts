import { Logger } from '../logger';
import { projectDB } from '../projectDB';
import { projectFileService } from '../projectFileService';
import { PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID, type ProjectMediaSourceRoot } from './types/project.types';
import { mediaSourceRootHandleKey as handleKey } from './mediaSourceRootAccess';
import { rememberRecentFsaProjectMediaSourceRoots } from './recentProjects';

const log = Logger.create('MediaSourceRoots');

type PermissionDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export interface ProjectMediaSourceRootState extends ProjectMediaSourceRoot {
  handle: FileSystemDirectoryHandle | null;
  permission: PermissionState | 'missing';
}

function createRootId(): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `source-root:${suffix}`;
}

function currentRoots(): ProjectMediaSourceRoot[] {
  const projectData = typeof projectFileService.getProjectData === 'function'
    ? projectFileService.getProjectData()
    : null;
  return (projectData?.mediaSourceRoots ?? [])
    .filter((root): root is ProjectMediaSourceRoot => Boolean(
      root
      && typeof root.id === 'string'
      && root.id.trim()
      && typeof root.name === 'string'
      && root.name.trim(),
    ))
    .map((root) => ({ id: root.id.trim(), name: root.name.trim() }));
}

async function storedRootHandle(rootId: string): Promise<FileSystemDirectoryHandle | null> {
  // The project folder root follows the open project; it is never stored under its shared id.
  if (rootId === PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID) {
    const projectHandle = typeof projectFileService.getProjectHandle === 'function' ? projectFileService.getProjectHandle() : null;
    return projectHandle?.kind === 'directory' ? projectHandle : null;
  }
  try {
    const handle = await projectDB.getStoredHandle(handleKey(rootId));
    return handle?.kind === 'directory' ? handle as FileSystemDirectoryHandle : null;
  } catch (error) {
    log.warn('Could not restore media source root handle', { rootId, error });
    return null;
  }
}

async function sameDirectory(
  left: FileSystemDirectoryHandle,
  right: FileSystemDirectoryHandle,
): Promise<boolean> {
  const candidate = left as PermissionDirectoryHandle;
  try {
    return await candidate.isSameEntry(right);
  } catch {
    return false;
  }
}

export function normalizeProjectSourceRelativePath(value: string | undefined): string | null {
  if (!value) return null;
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function persistRootDescriptor(
  root: ProjectMediaSourceRoot,
  roots: ProjectMediaSourceRoot[],
): ProjectMediaSourceRoot {
  const nextRoots = roots.some((entry) => entry.id === root.id)
    ? roots.map((entry) => entry.id === root.id ? root : entry)
    : [...roots, root];
  projectFileService.updateProjectData({
    mediaSourceFolders: [...new Set(nextRoots.map((entry) => entry.name))],
    mediaSourceRoots: nextRoots,
  });
  // Opening the project after a reload re-allows these folders in the same click.
  const projectHandle = typeof projectFileService.getProjectHandle === 'function'
    ? projectFileService.getProjectHandle()
    : null;
  if (projectHandle) {
    void rememberRecentFsaProjectMediaSourceRoots(projectHandle, nextRoots.map((entry) => entry.id))
      .catch((error: unknown) => log.debug('Could not remember media folders for the recent project', error));
  }
  return root;
}

export function registerProjectMediaSourceRootDescriptor(
  name: string,
  preferredRootId?: string,
): ProjectMediaSourceRoot {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error('Source folder name is required');

  const roots = currentRoots();
  const matched = roots.find((root) => root.id === preferredRootId)
    ?? roots.find((root) => root.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
  return persistRootDescriptor(
    matched ? { ...matched, name: normalizedName } : { id: createRootId(), name: normalizedName },
    roots,
  );
}

export async function registerProjectMediaSourceRoot(
  handle: FileSystemDirectoryHandle,
  preferredRootId?: string,
): Promise<ProjectMediaSourceRoot> {
  const roots = currentRoots();
  let matched = roots.find((root) => root.id === preferredRootId);
  let reusableByName: ProjectMediaSourceRoot | undefined;
  if (matched?.id === PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID) {
    const projectFolder = await storedRootHandle(matched.id);
    if (!projectFolder || !await sameDirectory(projectFolder, handle)) matched = undefined;
  }

  for (const root of matched ? [] : roots) {
    if (root.name.toLocaleLowerCase() !== handle.name.toLocaleLowerCase()) continue;
    const stored = await storedRootHandle(root.id);
    if (stored && await sameDirectory(stored, handle)) {
      matched = root;
      break;
    }
    if (!stored && !reusableByName && root.id !== PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID) reusableByName = root;
  }

  const root = matched ?? reusableByName ?? { id: createRootId(), name: handle.name };
  if (root.id !== PROJECT_FOLDER_MEDIA_SOURCE_ROOT_ID) await projectDB.storeHandle(handleKey(root.id), handle);
  return persistRootDescriptor({ ...root, name: handle.name }, roots);
}

/**
 * Whether an old-format folder was already converted into a separate project folder. Those
 * conversions registered the old folder as their `source-root:legacy-*` media source root.
 */
export async function isSeparatelyConvertedLegacyFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const prefix = handleKey('source-root:legacy-');
  for (const entry of await projectDB.getAllHandles()) {
    if (!entry.key.startsWith(prefix) || entry.handle.kind !== 'directory') continue;
    if (await sameDirectory(entry.handle as FileSystemDirectoryHandle, handle)) return true;
  }
  return false;
}

/** Stores a root handle for a descriptor written by another project, e.g. a legacy import. */
export async function storeProjectMediaSourceRootHandle(rootId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await projectDB.storeHandle(handleKey(rootId), handle);
}

export async function getProjectMediaSourceRootStates(): Promise<ProjectMediaSourceRootState[]> {
  return Promise.all(currentRoots().map(async (root) => {
    const handle = await storedRootHandle(root.id);
    if (!handle) return { ...root, handle: null, permission: 'missing' as const };
    const permissionHandle = handle as PermissionDirectoryHandle;
    let permission: PermissionState = 'granted';
    try {
      permission = typeof permissionHandle.queryPermission === 'function'
        ? await permissionHandle.queryPermission({ mode: 'read' })
        : 'granted';
    } catch {
      permission = 'denied';
    }
    return { ...root, handle, permission };
  }));
}

export async function requestProjectMediaSourceRootAccess(
  root: ProjectMediaSourceRootState,
): Promise<FileSystemDirectoryHandle | null> {
  if (!root.handle) return null;
  if (root.permission === 'granted') return root.handle;
  const handle = root.handle as PermissionDirectoryHandle;
  if (typeof handle.requestPermission !== 'function') return null;
  try {
    return await handle.requestPermission({ mode: 'read' }) === 'granted' ? root.handle : null;
  } catch {
    return null;
  }
}

export async function resolveFileWithinProjectMediaSourceRoot(
  rootId: string,
  fileHandle: FileSystemFileHandle,
): Promise<string | null> {
  const root = await storedRootHandle(rootId);
  if (!root) return null;
  const permissionHandle = root as PermissionDirectoryHandle;
  try {
    const permission = typeof permissionHandle.queryPermission === 'function'
      ? await permissionHandle.queryPermission({ mode: 'read' })
      : 'granted';
    if (permission !== 'granted') return null;
    const segments = await root.resolve(fileHandle);
    return segments ? normalizeProjectSourceRelativePath(segments.join('/')) : null;
  } catch {
    return null;
  }
}

export async function resolveProjectMediaSourceLocation(
  fileHandle: FileSystemFileHandle | undefined,
): Promise<{ sourceRootId: string; sourceRelativePath: string } | null> {
  if (!fileHandle) return null;
  for (const root of currentRoots()) {
    const sourceRelativePath = await resolveFileWithinProjectMediaSourceRoot(root.id, fileHandle);
    if (sourceRelativePath) return { sourceRootId: root.id, sourceRelativePath };
  }
  return null;
}

export async function readProjectMediaSourceFile(
  rootId: string | undefined,
  relativePath: string | undefined,
): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  if (!rootId) return null;
  const normalizedPath = normalizeProjectSourceRelativePath(relativePath);
  if (!normalizedPath) return null;
  const root = await storedRootHandle(rootId);
  if (!root) return null;

  const permissionHandle = root as PermissionDirectoryHandle;
  try {
    const permission = typeof permissionHandle.queryPermission === 'function'
      ? await permissionHandle.queryPermission({ mode: 'read' })
      : 'granted';
    if (permission !== 'granted') return null;

    const segments = normalizedPath.split('/');
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const handle = await directory.getFileHandle(segments.at(-1)!);
    return { file: await handle.getFile(), handle };
  } catch (error) {
    log.warn('Could not read media from source root', { rootId, relativePath: normalizedPath, error });
    return null;
  }
}
