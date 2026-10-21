import type { StoragePersistence } from './permanentSaveOptions';

/** `navigator.storage.persisted()`: null when the check failed, `unsupported` without the API. */
export async function readStoragePersistence(): Promise<StoragePersistence> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persisted !== 'function') return 'unsupported';
  try { return await navigator.storage.persisted(); } catch { return null; }
}
