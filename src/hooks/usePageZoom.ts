import { useEffect } from 'react';

/**
 * Browser page-zoom guard (#209). The browser's native Ctrl+scroll zoom is
 * blocked across the app so it can't fire accidentally. Pinch belongs to the
 * editor's panel/timeline/preview gesture handlers, never to the browser page.
 */
export function usePageZoom(): void {
  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      // Appearance settings deliberately exposes one small, explicit surface
      // where the browser's native page zoom remains available.
      if (target?.closest?.('[data-browser-zoom-area]')) return;
      // The timeline owns Ctrl+wheel as its horizontal zoom over the scrollable
      // lanes and blocks the page zoom itself (it calls preventDefault in its own
      // handler). If we preventDefault here first, its handler bails on
      // defaultPrevented and the zoom never runs — which on Linux left users with
      // no working zoom at all, since Alt+wheel is grabbed by the window manager.
      // Mirror the timeline's eligibility (everything but the track headers).
      if (target?.closest?.('.timeline-body') && !target.closest?.('.track-headers')) return;
      event.preventDefault();
    };

    const preventBrowserGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventMultiTouchPageZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };

    // Capture + non-passive so Chromium's synthesized Ctrl+wheel and Safari's
    // gesture/touch streams are stopped before they can scale the viewport.
    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('gesturestart', preventBrowserGesture, { passive: false, capture: true });
    window.addEventListener('gesturechange', preventBrowserGesture, { passive: false, capture: true });
    window.addEventListener('touchmove', preventMultiTouchPageZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener('wheel', handleWheel, true);
      window.removeEventListener('gesturestart', preventBrowserGesture, true);
      window.removeEventListener('gesturechange', preventBrowserGesture, true);
      window.removeEventListener('touchmove', preventMultiTouchPageZoom, true);
    };
  }, []);
}
