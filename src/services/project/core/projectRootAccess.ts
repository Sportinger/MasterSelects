// Acquires the directory that holds project folders.
//
// Chrome and Edge let the user pick a real folder through the File System
// Access API. WebKit - every browser on iPadOS/iOS, plus Safari on macOS -
// has no picker, but it does implement the same FileSystemDirectoryHandle
// API over the Origin Private File System. Older WebKit can read these
// handles without supporting writable streams; creation checks both capabilities.

import { Logger } from '../../logger';

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

export function resolveProjectRootMode(): ProjectRootMode {
  if (isFsaPickerAvailable()) return 'fsa';
  if (isOpfsAvailable()) return 'opfs';
  return 'none';
}

/** Reading OPFS does not imply support for transactional writable streams. */
export function getProjectWriteSupportError(): string | null {
  const mode = resolveProjectRootMode();
  if (mode === 'none') return 'This browser does not provide project file storage.';
  if (mode === 'opfs' && (
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
      try {
        return await navigator.storage.getDirectory();
      } catch (error) {
        // WebKit can abort OPFS while its storage process is resuming. Retry
        // acquisition once; no project directory or file has been mutated.
        if (!(error instanceof DOMException) || !['AbortError', 'UnknownError'].includes(error.name)) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
        return await navigator.storage.getDirectory();
      }
    } catch (error) {
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

/**
 * Names of the project folders inside a root. OPFS has no system dialog to
 * open an existing project, so the app has to offer the list itself.
 */
export async function listProjectFolderNames(root: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];

  try {
    for await (const entry of (root as IterableDirectoryHandle).values()) {
      if (entry.kind === 'directory') {
        names.push(entry.name);
      }
    }
  } catch (error) {
    log.error('Failed to list project folders', error);
    throw error;
  }

  return names.toSorted((a, b) => a.localeCompare(b));
}
