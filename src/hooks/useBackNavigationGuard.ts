import { useEffect } from 'react';

/**
 * Trap browser "back" navigation so it never leaves the app / loses the open
 * project (#200). A sentinel history entry is pushed on mount; whenever the
 * user triggers Back (button, Alt+Left, or trackpad swipe) we immediately
 * re-push it, which keeps the page in place instead of navigating away.
 *
 * The app uses only history.replaceState() for its own URL cleanup, so there
 * is no in-app router navigation for this to interfere with.
 */
export function useBackNavigationGuard(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Seed an extra entry so the first Back press pops into our handler
    // rather than leaving the document.
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      // Re-arm the trap: push the current location back on, cancelling the
      // attempt to leave.
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
}
