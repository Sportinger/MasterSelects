// Fullscreen preview behaviour: the preview region takes the whole screen (CSS), asks the browser for
// real fullscreen and a landscape lock for landscape compositions where it can, and leaves again on
// tap, Escape or the system back gesture (which ends browser fullscreen). Browser refusals are fine:
// the CSS layout alone still fills the viewport; they are logged, never thrown.

import { useEffect, useRef, type RefObject } from 'react';

import { Logger } from '../../../services/logger';
import { usePhonePreviewModeStore } from './phonePreviewMode';

const log = Logger.create('PhoneFullscreen');

interface OrientationWithLock {
  lock?: (orientation: 'landscape' | 'portrait') => Promise<void>;
  unlock?: () => void;
}

function orientation(): OrientationWithLock | null {
  return typeof screen !== 'undefined' && screen.orientation ? screen.orientation as unknown as OrientationWithLock : null;
}

export function usePhoneFullscreen(regionRef: RefObject<HTMLElement | null>, landscape: boolean): boolean {
  const fullscreen = usePhonePreviewModeStore((state) => state.fullscreen);
  const nativeRef = useRef(false);

  useEffect(() => {
    const region = regionRef.current;
    if (!fullscreen || !region) return undefined;
    let cancelled = false;
    if (typeof region.requestFullscreen === 'function' && !document.fullscreenElement) {
      region.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (cancelled) { void document.exitFullscreen?.().catch(() => undefined); return; }
        nativeRef.current = true;
        if (landscape) orientation()?.lock?.('landscape').catch((error: unknown) => log.debug('Landscape lock refused', error));
      }).catch((error: unknown) => log.debug('Browser fullscreen refused; the preview fills the page instead', error));
    }
    const onChange = () => {
      // The system back gesture or Escape ended browser fullscreen: leave the fullscreen preview too.
      if (nativeRef.current && !document.fullscreenElement) {
        nativeRef.current = false;
        usePhonePreviewModeStore.getState().exitFullscreen();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      usePhonePreviewModeStore.getState().exitFullscreen();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
      if (nativeRef.current || document.fullscreenElement === region) {
        nativeRef.current = false;
        try { orientation()?.unlock?.(); } catch (error) { log.debug('Orientation unlock failed', error); }
        if (document.fullscreenElement) void document.exitFullscreen().catch((error: unknown) => log.debug('Leaving browser fullscreen failed', error));
      }
    };
  }, [fullscreen, landscape, regionRef]);

  // Leaving the editor (the preview unmounts) never leaves the mode switched on.
  useEffect(() => () => usePhonePreviewModeStore.getState().exitFullscreen(), []);

  return fullscreen;
}
