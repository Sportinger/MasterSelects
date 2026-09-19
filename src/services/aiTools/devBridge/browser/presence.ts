import { browserTabId } from '../../../browserTabIdentity';

export type BrowserHot = NonNullable<ImportMeta['hot']>;

const AI_BRIDGE_PRESENCE_INTERVAL_MS = 3000;
const AI_BRIDGE_INITIAL_CONNECTION_GRACE_MS = 500;

export const tabId = browserTabId;

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
  let initialConnectionTimeoutId: number | null = null;
  let connectionState: 'unknown' | 'connected' | 'disconnected' = 'unknown';
  const sendPresence = () => {
    if (connectionState !== 'connected') return;
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

  const handleConnect = () => {
    connectionState = 'connected';
    sendPresence();
  };
  const handleDisconnect = () => {
    connectionState = 'disconnected';
  };

  hot.on('vite:ws:connect', handleConnect);
  hot.on('vite:ws:disconnect', handleDisconnect);

  const disposeBridgeResources = createDisposable();
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', sendPresence);
    window.addEventListener('blur', sendPresence);
    document.addEventListener('visibilitychange', sendPresence);
    presenceIntervalId = window.setInterval(sendPresence, AI_BRIDGE_PRESENCE_INTERVAL_MS);
    initialConnectionTimeoutId = window.setTimeout(() => {
      if (connectionState !== 'unknown') return;
      void fetch('/@vite/client', { cache: 'no-store', method: 'HEAD' })
        .then((response) => {
          if (connectionState !== 'unknown') return;
          if (response.ok) handleConnect();
          else connectionState = 'disconnected';
        })
        .catch(() => {
          if (connectionState === 'unknown') connectionState = 'disconnected';
        });
    }, AI_BRIDGE_INITIAL_CONNECTION_GRACE_MS);
  }

  hot.dispose(() => {
    hot.off('vite:ws:connect', handleConnect);
    hot.off('vite:ws:disconnect', handleDisconnect);
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', sendPresence);
      window.removeEventListener('blur', sendPresence);
      document.removeEventListener('visibilitychange', sendPresence);
      if (presenceIntervalId !== null) {
        window.clearInterval(presenceIntervalId);
      }
      if (initialConnectionTimeoutId !== null) {
        window.clearTimeout(initialConnectionTimeoutId);
      }
    }
    disposeBridgeResources();
  });

  return sendPresence;
}
