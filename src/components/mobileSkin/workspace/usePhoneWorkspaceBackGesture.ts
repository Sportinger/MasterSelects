// The browser's back gesture (Android back, iOS edge swipe, the back button) closes the open landscape
// editor instead of leaving /m: opening the editor adds one history entry on the same URL, popping it
// closes the editor. The Back button in the bar goes through the same entry, so history never keeps a
// stale editor entry behind.

import { useCallback, useEffect, useRef } from 'react';

const MARKER = 'phoneWorkspace';

function markedState(id: string): Record<string, unknown> {
  const current = window.history.state;
  const base = current && typeof current === 'object' ? current as Record<string, unknown> : {};
  return { ...base, [MARKER]: id };
}

function isMarked(state: unknown, id: string): boolean {
  return !!state && typeof state === 'object' && (state as Record<string, unknown>)[MARKER] === id;
}

/** Returns the close action for the Back button. */
export function usePhoneWorkspaceBackGesture(id: string, close: () => void): () => void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      if (!isMarked(window.history.state, id)) {
        window.history.pushState(markedState(id), '', window.location.href);
      }
    } catch (error) {
      console.warn('[PhoneWorkspace] The back gesture cannot close this editor (history unavailable).', error);
    }
    const onPopState = (event: PopStateEvent) => {
      if (!isMarked(event.state, id)) closeRef.current();
    };
    window.addEventListener('popstate', onPopState);
    // No history.back() on unmount: a StrictMode remount would then see its own entry popped.
    return () => window.removeEventListener('popstate', onPopState);
  }, [id]);
  return useCallback(() => {
    if (isMarked(window.history.state, id)) {
      // popstate closes the editor; close at once too, so a blocked history never keeps it open.
      window.history.back();
    }
    closeRef.current();
  }, [id]);
}
