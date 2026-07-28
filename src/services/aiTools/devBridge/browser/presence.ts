export type BrowserHot = NonNullable<ImportMeta['hot']>;

const AI_BRIDGE_TAB_ID_SESSION_KEY = 'masterselects.aiBridgeTabId';
const AI_BRIDGE_PRESENCE_INTERVAL_MS = 3000;

function createBridgeTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2, 10)}`;
}

function getStableBridgeTabId(): string {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return createBridgeTabId();
  }
  try {
    const existing = window.sessionStorage.getItem(AI_BRIDGE_TAB_ID_SESSION_KEY);
    if (existing) return existing;
    const next = createBridgeTabId();
    window.sessionStorage.setItem(AI_BRIDGE_TAB_ID_SESSION_KEY, next);
    return next;
  } catch {
    return createBridgeTabId();
  }
}

export const tabId = getStableBridgeTabId();

export function getTabPriorityDelayMs(isTargetedRequest = false): number {
  if (typeof document === 'undefined') return 0;

  const isVisible = document.visibilityState === 'visible';
  const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

  if (!isVisible) return isTargetedRequest ? 500 : -1;
  if (hasFocus) return 0;
  return 150;
}

export function registerBridgePresence(
  hot: BrowserHot,
  createDisposable: () => () => void,
  getSessionDetails?: () => Record<string, unknown>,
): () => void {
  let presenceIntervalId: number | null = null;
  const sendPresence = () => {
    let session: Record<string, unknown> | undefined;
    try {
      session = getSessionDetails?.();
    } catch {
      // Presence must remain available even if optional project metadata cannot be read.
    }
    hot.send('ai-tools:presence', {
      tabId,
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'hidden',
      hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : false,
      session,
    });
  };

  sendPresence();
  const disposeBridgeResources = createDisposable();
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', sendPresence);
    window.addEventListener('blur', sendPresence);
    document.addEventListener('visibilitychange', sendPresence);
    presenceIntervalId = window.setInterval(sendPresence, AI_BRIDGE_PRESENCE_INTERVAL_MS);
  }

  hot.dispose(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', sendPresence);
      window.removeEventListener('blur', sendPresence);
      document.removeEventListener('visibilitychange', sendPresence);
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
    }
    disposeBridgeResources();
  });

  return sendPresence;
}
