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
      event.preventDefault();
    };
    // Capture + non-passive so we can preventDefault before the browser zooms.
    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
  }, []);
}
