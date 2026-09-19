import { Logger } from '../logger';

const log = Logger.create('AndroidProjectAutoRestore');

const READY_PROJECT_KEY = 'ms-android-auto-restore-project';
const TARGET_PROJECT_KEY_PREFIX = 'ms-android-auto-restore-target:';

type FileSystemEntryHandle = FileSystemFileHandle | FileSystemDirectoryHandle;
type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemEntryHandle>;
};

const knownMirrorHandles = new WeakSet<FileSystemDirectoryHandle>();

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isAndroidRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform ?? '';
  return /android/i.test(`${platform} ${navigator.userAgent}`);
}

function supportsAndroidAutoRestore(): boolean {
  return isAndroidRuntime()
    && typeof navigator.storage?.getDirectory === 'function';
}

function targetStorageKey(sourceName: string): string {
  return `${TARGET_PROJECT_KEY_PREFIX}${encodeURIComponent(sourceName)}`;
}

function readStoredName(key: string): string | null {
  const value = getStorage()?.getItem(key)?.trim();
  return value || null;
}

function writeStoredName(key: string, name: string): void {
  try {
    getStorage()?.setItem(key, name);
  } catch (error) {
    log.warn('Could not persist Android auto-restore metadata', error);
  }
}

function clearStoredName(key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // The browser may deny storage while clearing site data.
  }
}

async function getExistingDirectory(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name, { create: false });
  } catch {
    return null;
  }
}

async function selectMirrorDirectory(
  root: FileSystemDirectoryHandle,
  sourceName: string,
): Promise<FileSystemDirectoryHandle> {
  const storedTargetName = readStoredName(targetStorageKey(sourceName));
  if (storedTargetName) {
    return root.getDirectoryHandle(storedTargetName, { create: true });
  }

  let targetName = sourceName;
  for (let suffix = 0; await getExistingDirectory(root, targetName); suffix += 1) {
    targetName = `${sourceName} (Android${suffix === 0 ? '' : ` ${suffix + 1}`})`;
  }

  writeStoredName(targetStorageKey(sourceName), targetName);
  return root.getDirectoryHandle(targetName, { create: true });
}

async function copyDirectoryContents(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
  parentPath: string,
  onFileCopied?: (path: string) => void,
): Promise<void> {
  for await (const entry of (source as IterableDirectoryHandle).values()) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      const targetDirectory = await target.getDirectoryHandle(entry.name, { create: true });
      await copyDirectoryContents(entry, targetDirectory, path, onFileCopied);
      continue;
    }

    const sourceFile = await entry.getFile();
    const targetFile = await target.getFileHandle(entry.name, { create: true });
    const writable = await targetFile.createWritable();
    try {
      await writable.write(sourceFile);
      await writable.close();
      onFileCopied?.(path);
    } catch (error) {
      try {
        await writable.abort(error);
      } catch {
        // Preserve the original copy error.
      }
      throw error;
    }
  }
}

/**
 * Copies an Android picker-backed project into OPFS. The source is never
 * changed or removed. A partially copied target is reused on the next attempt.
 */
export async function prepareAndroidProjectAutoRestore(
  source: FileSystemDirectoryHandle,
  onFileCopied?: (path: string) => void,
): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsAndroidAutoRestore()) return null;

  const root = await navigator.storage.getDirectory();
  const target = await selectMirrorDirectory(root, source.name);
  if (await source.isSameEntry(target)) {
    knownMirrorHandles.add(target);
    return target;
  }

  clearStoredName(READY_PROJECT_KEY);
  await copyDirectoryContents(source, target, '', onFileCopied);
  knownMirrorHandles.add(target);
  return target;
}

export function markAndroidProjectAutoRestoreReady(handle: FileSystemDirectoryHandle): void {
  if (!supportsAndroidAutoRestore()) return;
  knownMirrorHandles.add(handle);
  writeStoredName(READY_PROJECT_KEY, handle.name);
}

export function isAndroidAutoRestoreProjectHandle(handle: FileSystemDirectoryHandle | null): boolean {
  return handle !== null && knownMirrorHandles.has(handle);
}

export async function getAndroidProjectAutoRestoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsAndroidAutoRestore()) return null;
  const name = readStoredName(READY_PROJECT_KEY);
  if (!name) return null;

  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle(name, { create: false });
    knownMirrorHandles.add(handle);
    return handle;
  } catch (error) {
    log.warn('Stored Android auto-restore project is unavailable', error);
    clearStoredName(READY_PROJECT_KEY);
    return null;
  }
}

export async function restoreAndroidProjectAutomatically(
  loadProject: (handle: FileSystemDirectoryHandle) => Promise<boolean>,
): Promise<boolean> {
  const handle = await getAndroidProjectAutoRestoreHandle();
  if (!handle) return false;

  const restored = await loadProject(handle);
  if (!restored) {
    clearStoredName(READY_PROJECT_KEY);
  }
  return restored;
}
