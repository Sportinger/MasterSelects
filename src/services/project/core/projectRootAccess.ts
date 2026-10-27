// Acquires the directory that holds project folders.
//
// Chrome and Edge let the user pick a real folder through the File System
// Access API. WebKit - every browser on iPadOS/iOS, plus Safari on macOS -
// has no picker, but it does implement the same FileSystemDirectoryHandle
// API over the Origin Private File System. Older WebKit can read these
// handles without supporting writable streams; creation checks both capabilities.

import { Logger } from '../../logger';
import { RepositoryError } from '../repository/contracts';
import { BROWSER_STORAGE_UNAVAILABLE_MESSAGE, isBrowserStorageUnavailableError } from './browserStorageFailure';
import { isBrowserStorageFallbackActive, getBrowserStorageRoot } from './browserStorageRoot';

const log = Logger.create('ProjectRootAccess');

type DirectoryPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker: (options?: {
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
  }) => Promise<FileSystemDirectoryHandle>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

/** `none` means the browser can store projects nowhere — the UI must say so. */
export type ProjectRootMode = 'fsa' | 'opfs' | 'none';

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

export function isFsaPickerAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const candidate = window as Partial<DirectoryPickerWindow> & { showSaveFilePicker?: unknown };
  return typeof candidate.showDirectoryPicker === 'function'
    && typeof candidate.showSaveFilePicker === 'function';
}

export function isOpfsAvailable(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.storage?.getDirectory === 'function';
}

/** Where a new project goes: the default root (a picked folder where possible) or browser storage. */
export type ProjectStorageTarget = 'default' | 'browser';

let browserStorageScopes = 0;

/** True while a creation that explicitly targets browser storage runs (see withBrowserStorageProjectRoot). */
export function isBrowserStorageProjectRootForced(): boolean {
  return browserStorageScopes > 0;
}

/**
 * Runs `create` with browser storage (OPFS, or its IndexedDB fallback) as the project root even
 * where a folder picker exists, so no folder dialog appears. The phone editor creates its projects
 * this way: Android Chrome has a picker, but its system folders are slow. Only creation is scoped;
 * opening and saving keep following each project's own location, so folder projects keep opening.
 */
export async function withBrowserStorageProjectRoot<T>(create: () => Promise<T>): Promise<T> {
  if (!isOpfsAvailable() && !isBrowserStorageFallbackActive()) {
    throw new RepositoryError('unsupported', BROWSER_STORAGE_UNAVAILABLE_MESSAGE);
  }
  browserStorageScopes += 1;
  if (isFsaPickerAvailable()) log.info('Creating in browser storage although a folder picker exists');
  try {
    return await create();
  } finally {
    browserStorageScopes -= 1;
  }
}

export function resolveProjectRootMode(): ProjectRootMode {
  if (browserStorageScopes > 0) return 'opfs';
  if (isFsaPickerAvailable()) return 'fsa';
  if (isOpfsAvailable()) return 'opfs';
  return 'none';
}

/** Reading OPFS does not imply support for transactional writable streams. */
export function getProjectWriteSupportError(): string | null {
  const mode = resolveProjectRootMode();
  if (mode === 'none') return 'This browser does not provide project file storage.';
  // The IndexedDB fallback writes through its own streams.
  if (mode === 'opfs' && !isBrowserStorageFallbackActive() && (
    typeof FileSystemFileHandle === 'undefined'
    || typeof FileSystemFileHandle.prototype.createWritable !== 'function'
  )) {
    return 'This browser is missing project-file writing support. Update your browser before creating or saving projects.';
  }
  return null;
}

/**
 * Browser-managed storage is evictable by default: under storage pressure the
 * browser may drop OPFS project data as well as IndexedDB-held FSA handles and
 * caches. Requesting persistence is the only defence the platform offers, so
 * ask before the first browser-storage write rather than after data exists.
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function') {
    return false;
  }

  try {
    if (typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted()) {
      return true;
    }
    const granted = await navigator.storage.persist();
    if (granted) {
      log.info('Storage persistence granted');
    } else {
      // Without this the browser may reclaim projects and imported media,
      // and WebKit additionally clears script-writable storage after seven
      // days without a visit. The user has to be told, not silently exposed.
      log.warn('Storage persistence DENIED - stored projects may be evicted by the browser');
    }
    return granted;
  } catch (error) {
    log.warn('Storage persistence request failed', error);
    return false;
  }
}

/**
 * Returns the folder that contains project folders, or null when the user
 * cancelled the picker. Callers that distinguish inaccessible storage from an
 * empty result can request failures to propagate; picker cancellation stays null.
 */
export async function acquireProjectRoot(mode: ProjectRootMode, options: { throwOnFailure?: boolean } = {}): Promise<FileSystemDirectoryHandle | null> {
  if (mode === 'opfs') {
    await ensurePersistentStorage();
    try {
      // OPFS (retried once while WebKit's storage process resumes), or the
      // IndexedDB fallback when the browser refuses OPFS outright.
      return await getBrowserStorageRoot();
    } catch (error) {
      if (isBrowserStorageUnavailableError(error)) {
        // Environment, not code: Private Browsing, in-app browsers or low space.
        // Callers show the explanation; this is not an application error.
        log.warn('Browser project storage is unavailable in this browser', error);
        if (options.throwOnFailure) throw error instanceof RepositoryError ? error : new RepositoryError('unsupported', BROWSER_STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
        return null;
      }
      log.error('Failed to open the origin private file system', error);
      if (options.throwOnFailure) throw error;
      return null;
    }
  }

  if (mode === 'fsa') {
    try {
      return await (window as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });
    } catch (error) {
      if (isAbortError(error)) return null;
      log.error('Folder picker failed', error);
      if (options.throwOnFailure) throw error;
      return null;
    }
  }

  return null;
}

/** Browser-storage folders the repository layer uses for staging, scratch recovery and downloads. */
const INTERNAL_STORAGE_FOLDERS = new Set([
  'archive-downloads', 'archive-staging', 'repository-archive-staging',
  'repository-backup-restores', 'repository-file-staging', 'repository-scratch',
]);

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError');
}

async function hasFile(folder: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await folder.getFileHandle(name); return true; } catch (error) { if (isNotFound(error)) return false; throw error; }
}

/** A project folder holds a repository, a legacy project.json, or a not yet imported .msproj archive. */
async function isProjectFolder(folder: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasFile(folder, 'project.msrepo.json') || await hasFile(folder, 'project.json')) return true;
  for await (const entry of (folder as IterableDirectoryHandle).values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.msproj')) return true;
  }
  return false;
}

/**
 * Names of the project folders inside a root. OPFS has no system dialog to
 * open an existing project, so the app has to offer the list itself. Model
 * caches and repository staging folders share that root and are not projects.
 */
export async function listProjectFolderNames(root: FileSystemDirectoryHandle): Promise<string[]> {
  const folders: FileSystemDirectoryHandle[] = [];
  const names: string[] = [];

  try {
    for await (const entry of (root as IterableDirectoryHandle).values()) {
      if (entry.kind === 'directory' && !INTERNAL_STORAGE_FOLDERS.has(entry.name)) folders.push(entry);
    }
    for (const folder of folders) if (await isProjectFolder(folder)) names.push(folder.name);
  } catch (error) {
    log.error('Failed to list project folders', error);
    throw error;
  }

  if (folders.length > names.length) log.debug('Skipped browser-storage folders without a project', { skipped: folders.length - names.length });
  return names.toSorted((a, b) => a.localeCompare(b));
}
