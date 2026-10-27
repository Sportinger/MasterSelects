import { Logger } from '../../../services/logger';

const log = Logger.create('CacheReset');

interface CacheClearingWindow extends Window {
  __CLEARING_CACHE__?: boolean;
}

/** IndexedDB databases the reset deletes (settings, media blobs and caches, saved folder access, credentials). */
export const CACHE_RESET_DATABASES = [
  'webvj-db',
  'webvj-projects',
  'webvj-apikeys',
  'keyval-store',
  'MASterSelectsDB',
  'multicam-settings',
] as const;

/** Asks with the browser's own confirm (desktop File menu), then resets. */
export async function clearAllCacheAndReload(): Promise<void> {
  if (!confirm('This will clear ALL cached data and reload. Continue?')) {
    return;
  }
  await clearAllCacheAndReloadConfirmed();
}

/**
 * Resets without asking: for callers that already showed their own confirmation (the phone settings).
 * Projects in the browser's project storage (OPFS) and in project folders are not touched.
 * Every step runs even when an earlier one fails (blocked site data, service workers unavailable).
 * If any step failed, nothing reloads: the autosave pause (__CLEARING_CACHE__) is lifted again and
 * the error is thrown, so the editor keeps saving and the caller can say the reset did not finish.
 */
export async function clearAllCacheAndReloadConfirmed(): Promise<void> {
  const target = window as CacheClearingWindow;
  target.__CLEARING_CACHE__ = true;
  const failures: string[] = [];
  const step = async (name: string, action: () => unknown) => {
    try {
      await action();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await step('local storage', () => localStorage.clear());
  await step('session storage', () => sessionStorage.clear());
  for (const name of CACHE_RESET_DATABASES) {
    await step(`database ${name}`, () => indexedDB.deleteDatabase(name));
  }
  if ('caches' in window) {
    await step('caches', async () => {
      const names = await caches.keys();
      for (const name of names) await caches.delete(name);
    });
  }
  if ('serviceWorker' in navigator) {
    await step('service workers', async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) await registration.unregister();
    });
  }

  if (failures.length > 0) {
    target.__CLEARING_CACHE__ = false;
    log.warn('Cache reset did not finish', failures);
    throw new Error(`The cache reset did not finish (${failures.join('; ')}).`);
  }

  setTimeout(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (error) {
      log.warn('Clearing storage before the reload failed', error);
    }
    window.location.href = `${window.location.origin}${window.location.pathname}?cleared=${Date.now()}`;
  }, 100);
}
