// Chooses where browser-local projects live: the Origin Private File System,
// or - when the browser refuses OPFS - the IndexedDB fallback that serves the
// same directory/file handle surface. The choice is made once per page (and
// kept for the tab across reloads) so a project is never split between the
// two stores; the storage worker adopts the editor's choice.

import { Logger } from '../../logger';
import { RepositoryError } from '../repository/contracts';
import { BROWSER_STORAGE_UNAVAILABLE_MESSAGE, isOpfsRefusal, retryTransientStorage } from './browserStorageFailure';
import { createFallbackDirectoryRoot } from './fallbackDirectoryHandle';
import { openIndexedDbEntryStore } from './indexedDbEntryStore';

const log = Logger.create('BrowserStorageRoot');

export type BrowserStorageKind = 'opfs' | 'indexeddb';

const TAB_CHOICE_KEY = 'ms.browserStorage.kind';

export const FALLBACK_STORAGE_NOTICE = 'This browser did not give MasterSelects its permanent project storage, so '
  + 'projects are kept in a temporary browser database instead. They can be lost: Private Browsing and in-app browsers '
  + 'delete it when the window closes, and clearing site data removes it. Use Save permanently to keep your work.';

/** The risk and the way out, for the chooser notice that already names the reason. */
export const FALLBACK_STORAGE_RISK = 'Projects here can be lost: clearing site data removes them, and Private Browsing or '
  + 'in-app browsers delete them when the window closes. Use Save permanently (.msproj) to keep your work.';

/** Why this tab uses the temporary fallback: OPFS refused on first access, or not offered at all. */
export type BrowserStorageFallbackReason = 'refused' | 'missing';

/** What the person can do to get permanent storage back, by reason. */
export function describeBrowserStorageFallback(reason: BrowserStorageFallbackReason | null): string {
  return reason === 'missing'
    ? 'This browser is too old to store projects permanently. Update it (or use a current Chrome, Edge or Safari) to save normally.'
    : 'This browser refused permanent storage, usually in Private Browsing, in an in-app browser or on a full device. Open MasterSelects in a regular browser window to save normally.';
}

let kind: BrowserStorageKind | null = null;
let fallbackReason: BrowserStorageFallbackReason | null = null;
let fallbackRoot: Promise<FileSystemDirectoryHandle> | null = null;
const listeners = new Set<() => void>();

function readTabChoice(): string | null {
  let stored: string | null = null;
  try { stored = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(TAB_CHOICE_KEY); } catch { /* storage unavailable */ }
  // Dev-only switch so a device whose OPFS works (e.g. an iPad on the LAN) can exercise the fallback,
  // until Save permanently moved this tab's project into OPFS.
  if (import.meta.env.DEV && import.meta.env.VITE_MS_FORCE_BROWSER_STORAGE === 'indexeddb' && stored !== 'opfs') return 'indexeddb';
  return stored;
}

function rememberTabChoice(next: BrowserStorageKind): void {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(TAB_CHOICE_KEY, next); } catch { /* storage unavailable */ }
}

function choose(next: BrowserStorageKind): void {
  if (kind === next) return;
  kind = next;
  if (next === 'indexeddb') rememberTabChoice(next);
  for (const listener of listeners) listener();
}

function openFallbackRoot(): Promise<FileSystemDirectoryHandle> {
  fallbackRoot ??= openIndexedDbEntryStore().then(createFallbackDirectoryRoot);
  fallbackRoot.catch(() => { fallbackRoot = null; });
  return fallbackRoot;
}

/** The origin private file system itself, never the fallback; throws when the browser refuses it. */
export async function openPersistentBrowserRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    throw new RepositoryError('unsupported', 'This browser does not provide project file storage.');
  }
  return retryTransientStorage(() => navigator.storage.getDirectory(), 'Opening the origin private file system');
}

/** Root of one specific store, independent of this tab's choice (used to move projects between them). */
export function getBrowserStorageRootOf(store: BrowserStorageKind): Promise<FileSystemDirectoryHandle> {
  return store === 'indexeddb' ? openFallbackRoot() : openPersistentBrowserRoot();
}

/** The store a browser-local location lives in: its explicit store, else this tab's choice. */
export function resolveBrowserStore(store?: BrowserStorageKind): BrowserStorageKind | null { return store ?? kind; }

/**
 * After Save permanently moved the open project into OPFS, this tab keeps using
 * OPFS (also across reloads). Projects left in the fallback stay there until moved.
 */
export function switchBrowserStorageToOpfs(): void {
  rememberTabChoice('opfs');
  if (kind === 'opfs') return;
  log.info('Browser projects in this tab now use the origin private file system');
  kind = 'opfs';
  for (const listener of listeners) listener();
}

/** The store chosen for browser-local projects in this context, or null before the first access. */
export function getBrowserStorageKind(): BrowserStorageKind | null { return kind; }

/** Why the fallback is active (null when it is not). A tab that kept the fallback across a reload is checked again. */
export function getBrowserStorageFallbackReason(): BrowserStorageFallbackReason | null {
  if (kind !== 'indexeddb') return null;
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return 'missing';
  return fallbackReason ?? 'refused';
}

/** Some browser store exists: OPFS, or IndexedDB for the emergency fallback. */
export function isBrowserProjectStorageAvailable(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') return true;
  return typeof indexedDB !== 'undefined';
}

export function isBrowserStorageFallbackActive(): boolean { return kind === 'indexeddb'; }

export function subscribeBrowserStorageKind(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The storage worker follows the editor's choice instead of probing OPFS on its own. */
export function adoptBrowserStorageKind(next: BrowserStorageKind): void { choose(next); }

/**
 * Root directory for browser-local projects. OPFS is used whenever it opens;
 * only the browser's refusal on the first access (WebKit's opaque failure, a
 * SecurityError in Firefox Private Browsing) selects the fallback. Once chosen,
 * a later OPFS failure is reported, never redirected.
 */
export async function getBrowserStorageRoot(): Promise<FileSystemDirectoryHandle> {
  if (kind === null && readTabChoice() === 'indexeddb') choose('indexeddb');
  if (kind === 'indexeddb') return openFallbackRoot();
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    // Older browsers (Android Chrome before 109, some WebViews) offer no OPFS at all. Without this last
    // resort they could not create or open any project; the editor says the storage is temporary.
    if (kind !== null || typeof indexedDB === 'undefined') {
      throw new RepositoryError('unsupported', 'This browser does not provide project file storage.');
    }
    const root = await openFallbackRoot();
    log.warn('This browser has no origin private file system; browser projects use the temporary IndexedDB fallback');
    fallbackReason = 'missing';
    choose('indexeddb');
    return root;
  }
  try {
    const root = await retryTransientStorage(() => navigator.storage.getDirectory(), 'Opening the origin private file system');
    choose('opfs');
    return root;
  } catch (error) {
    if (kind !== null || !isOpfsRefusal(error)) throw error;
    let root: FileSystemDirectoryHandle;
    try { root = await openFallbackRoot(); }
    catch (fallbackError) {
      log.warn('Browser project storage is unavailable: OPFS and the IndexedDB fallback both refused access', { opfs: error, indexedDb: fallbackError });
      throw new RepositoryError('unsupported', BROWSER_STORAGE_UNAVAILABLE_MESSAGE, { cause: error });
    }
    log.warn('Origin private file system is unavailable; browser projects use the IndexedDB fallback for this tab', error);
    fallbackReason = 'refused';
    choose('indexeddb');
    return root;
  }
}
