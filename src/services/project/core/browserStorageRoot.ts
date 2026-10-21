// Chooses where browser-local projects live: the Origin Private File System,
// or - when the browser refuses OPFS - the IndexedDB fallback that serves the
// same directory/file handle surface. The choice is made once per page (and
// kept for the tab across reloads) so a project is never split between the
// two stores; the storage worker adopts the editor's choice.

import { Logger } from '../../logger';
import { RepositoryError } from '../repository/contracts';
import { BROWSER_STORAGE_UNAVAILABLE_MESSAGE, isBrowserStorageUnavailableError, retryTransientStorage } from './browserStorageFailure';
import { createFallbackDirectoryRoot } from './fallbackDirectoryHandle';
import { openIndexedDbEntryStore } from './indexedDbEntryStore';

const log = Logger.create('BrowserStorageRoot');

export type BrowserStorageKind = 'opfs' | 'indexeddb';

const TAB_CHOICE_KEY = 'ms.browserStorage.kind';

export const FALLBACK_STORAGE_NOTICE = 'This browser refused its project file storage, so this project is kept in a '
  + 'temporary browser database instead. Private Browsing and in-app browsers delete it when the window closes, and '
  + 'clearing site data removes it. Export a .msproj archive to keep a copy.';

let kind: BrowserStorageKind | null = null;
let fallbackRoot: Promise<FileSystemDirectoryHandle> | null = null;
const listeners = new Set<() => void>();

function readTabChoice(): string | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(TAB_CHOICE_KEY); } catch { return null; }
}

function choose(next: BrowserStorageKind): void {
  if (kind === next) return;
  kind = next;
  if (next === 'indexeddb') {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(TAB_CHOICE_KEY, next); } catch { /* storage unavailable */ }
  }
  for (const listener of listeners) listener();
}

function openFallbackRoot(): Promise<FileSystemDirectoryHandle> {
  fallbackRoot ??= openIndexedDbEntryStore().then(createFallbackDirectoryRoot);
  fallbackRoot.catch(() => { fallbackRoot = null; });
  return fallbackRoot;
}

/** The store chosen for browser-local projects in this context, or null before the first access. */
export function getBrowserStorageKind(): BrowserStorageKind | null { return kind; }

export function isBrowserStorageFallbackActive(): boolean { return kind === 'indexeddb'; }

export function subscribeBrowserStorageKind(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The storage worker follows the editor's choice instead of probing OPFS on its own. */
export function adoptBrowserStorageKind(next: BrowserStorageKind): void { choose(next); }

/**
 * Root directory for browser-local projects. OPFS is used whenever it opens;
 * only WebKit's opaque storage refusal on the first access selects the
 * fallback. Once chosen, a later OPFS failure is reported, never redirected.
 */
export async function getBrowserStorageRoot(): Promise<FileSystemDirectoryHandle> {
  if (kind === null && readTabChoice() === 'indexeddb') choose('indexeddb');
  if (kind === 'indexeddb') return openFallbackRoot();
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    throw new RepositoryError('unsupported', 'This browser does not provide project file storage.');
  }
  try {
    const root = await retryTransientStorage(() => navigator.storage.getDirectory(), 'Opening the origin private file system');
    choose('opfs');
    return root;
  } catch (error) {
    if (kind !== null || !isBrowserStorageUnavailableError(error)) throw error;
    let root: FileSystemDirectoryHandle;
    try { root = await openFallbackRoot(); }
    catch (fallbackError) {
      log.warn('Browser project storage is unavailable: OPFS and the IndexedDB fallback both refused access', { opfs: error, indexedDb: fallbackError });
      throw new RepositoryError('unsupported', BROWSER_STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
    log.warn('Origin private file system is unavailable; browser projects use the IndexedDB fallback for this tab', error);
    choose('indexeddb');
    return root;
  }
}
