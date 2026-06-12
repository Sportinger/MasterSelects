import { useEffect } from 'react';

/**
 * Browser page-zoom guard (#209). The browser's native Ctrl+scroll zoom is
 * blocked everywhere so it can't fire accidentally over the app, EXCEPT inside
 * a dedicated zoom area (marked with `data-browser-zoom-area`) in the Appearance
 * settings — there Ctrl+scroll is allowed through so the user can deliberately
 * scale the whole interface using real browser zoom.
 */
export function usePageZoom(): void {
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-browser-zoom-area]')) return; // allow native zoom here
      // The timeline owns Ctrl+wheel as its horizontal zoom over the scrollable
      // lanes and blocks the page zoom itself (it calls preventDefault in its own
      // handler). If we preventDefault here first, its handler bails on
      // defaultPrevented and the zoom never runs — which on Linux left users with
      // no working zoom at all, since Alt+wheel is grabbed by the window manager.
      // Mirror the timeline's eligibility (everything but the track headers).
      if (target?.closest?.('.timeline-body') && !target.closest?.('.track-headers')) return;
      event.preventDefault();
    };
    // Capture + non-passive so we can preventDefault before the browser zooms.
    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
  }, []);
}
