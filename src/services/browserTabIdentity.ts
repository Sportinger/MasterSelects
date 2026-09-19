const BROWSER_TAB_ID_SESSION_KEY = 'masterselects.aiBridgeTabId';

function createBrowserTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2, 10)}`;
}

export function getStableBrowserTabId(): string {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return createBrowserTabId();
  }
  try {
    const existing = window.sessionStorage.getItem(BROWSER_TAB_ID_SESSION_KEY);
    if (existing) return existing;
    const next = createBrowserTabId();
    window.sessionStorage.setItem(BROWSER_TAB_ID_SESSION_KEY, next);
    return next;
  } catch {
    return createBrowserTabId();
  }
}

export const browserTabId = getStableBrowserTabId();
