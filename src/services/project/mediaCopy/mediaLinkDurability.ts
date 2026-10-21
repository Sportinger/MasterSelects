// Whether a linked (not copied) media file can be found again after a reload.
// Linking keeps only a FileSystemHandle in IndexedDB; WebKit (Safari on iPhone,
// iPad and macOS) refuses to store handles, so linked media go offline on every
// reload there. The answer is measured with a real handle, never guessed from
// the user agent, and decides whether imports are copied into the project.

import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';

const log = Logger.create('MediaLinkDurability');

export type MediaLinkDurability = 'unknown' | 'durable' | 'not-durable';

/** Per-device choice: copying is the default wherever links cannot survive a reload. */
const LINK_PREFERENCE_KEY = 'ms.media.linkWhenNotDurable';

let durability: MediaLinkDurability = 'unknown';
let pendingProbe: Promise<MediaLinkDurability> | null = null;
let linkPreference: boolean | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function setDurability(next: MediaLinkDurability): void {
  if (durability === next) return;
  durability = next;
  if (next === 'not-durable') {
    log.info('This browser cannot keep linked files across reloads; imported media are copied into the project');
  }
  notify();
}

function isFileSystemHandle(value: unknown): value is FileSystemHandle {
  return typeof FileSystemHandle !== 'undefined' && value instanceof FileSystemHandle;
}

async function sampleHandle(): Promise<FileSystemHandle | null> {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
      ? await navigator.storage.getDirectory()
      : null;
  } catch {
    // OPFS refused (e.g. iOS Private Browsing): the next import handle answers instead.
    return null;
  }
}

async function measure(handle?: FileSystemHandle): Promise<MediaLinkDurability> {
  // Without the handle API every imported file is a page-lifetime File.
  if (typeof FileSystemHandle === 'undefined') return 'not-durable';
  const sample = isFileSystemHandle(handle) ? handle : await sampleHandle();
  if (!sample) return 'unknown';
  try {
    return await projectDB.canStoreHandle(sample) ? 'durable' : 'not-durable';
  } catch (error) {
    log.warn('Could not test whether linked media survive a reload', error);
    return 'unknown';
  }
}

/**
 * Measures (once per page) whether linked media survive a reload. A real import
 * handle is the best sample; without one the browser's own storage root is used.
 */
export async function probeMediaLinkDurability(handle?: FileSystemHandle): Promise<MediaLinkDurability> {
  if (durability !== 'unknown') return durability;
  pendingProbe ??= measure(handle).then((result) => {
    setDurability(result);
    return result;
  }).finally(() => { pendingProbe = null; });
  return pendingProbe;
}

export function getMediaLinkDurability(): MediaLinkDurability {
  return durability;
}

/** True unless the user chose to keep such media linked (and re-pick them after reloads). */
export function isCopyingUndurableMedia(): boolean {
  if (linkPreference === null) {
    try {
      linkPreference = typeof localStorage !== 'undefined' && localStorage.getItem(LINK_PREFERENCE_KEY) === 'true';
    } catch {
      linkPreference = false;
    }
  }
  return !linkPreference;
}

export function setCopyingUndurableMedia(copy: boolean): void {
  linkPreference = !copy;
  try {
    if (copy) localStorage.removeItem(LINK_PREFERENCE_KEY);
    else localStorage.setItem(LINK_PREFERENCE_KEY, 'true');
  } catch (error) {
    log.warn('Could not remember the media copy choice in this browser; it applies until the page reloads', error);
  }
  log.info(copy ? 'Media that cannot stay linked are copied into the project' : 'Media that cannot stay linked stay linked by choice');
  notify();
}

export function subscribeMediaLinkDurability(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test seam: forget the measured capability and the cached preference. */
export function resetMediaLinkDurabilityForTests(): void {
  durability = 'unknown';
  pendingProbe = null;
  linkPreference = null;
}
