import { browserTabId } from '../browserTabIdentity';

export const LEGACY_LAST_PROJECT_HANDLE_KEY = 'lastProject';
export const LEGACY_NATIVE_LAST_PROJECT_PATH_KEY = 'ms-native-last-project-path';
export const LEGACY_OPFS_LAST_PROJECT_NAME_KEY = 'ms-opfs-last-project-name';

export function getTabLastProjectHandleKey(tabId = browserTabId): string {
  return `${LEGACY_LAST_PROJECT_HANDLE_KEY}:${tabId}`;
}

export function getTabNativeLastProjectPathKey(tabId = browserTabId): string {
  return `${LEGACY_NATIVE_LAST_PROJECT_PATH_KEY}:${tabId}`;
}

export function getTabOpfsLastProjectNameKey(tabId = browserTabId): string {
  return `${LEGACY_OPFS_LAST_PROJECT_NAME_KEY}:${tabId}`;
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastOpfsProjectName(tabId = browserTabId): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  const name = storage.getItem(getTabOpfsLastProjectNameKey(tabId))
    ?? storage.getItem(LEGACY_OPFS_LAST_PROJECT_NAME_KEY);
  return name?.trim() || null;
}

export function storeLastOpfsProjectName(name: string, tabId = browserTabId): void {
  const normalizedName = name.trim();
  const storage = getLocalStorage();
  if (!storage || !normalizedName) return;
  storage.setItem(getTabOpfsLastProjectNameKey(tabId), normalizedName);
  storage.setItem(LEGACY_OPFS_LAST_PROJECT_NAME_KEY, normalizedName);
}

export function clearLastOpfsProjectName(tabId = browserTabId): void {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.removeItem(getTabOpfsLastProjectNameKey(tabId));
}
