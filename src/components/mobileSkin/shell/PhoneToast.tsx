import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

/** Info toasts go after 2.5 s; errors stay a little longer so they can be read. */
const TOAST_MS = { info: 2500, error: 4000 } as const;
/** Gap between the toast and the active tab or the screen edge, in px. */
const GAP_PX = 8;
/** Below this much room beside the active tab the toast takes the whole row (the tab is then the only label). */
const MIN_SIDE_PX = 96;

/**
 * While a sheet is open the toast sits on the composition tab row (PhoneShell.css). It goes beside the
 * active tab, on the side with more room, so it never hides the open composition's name.
 */
function besideActiveTab(toast: HTMLElement): CSSProperties | null {
  const shell = toast.closest('.phone-shell');
  if (!shell?.querySelector('.phone-sheet')) return null;
  const strip = shell.querySelector<HTMLElement>(`[data-testid="${PHONE_TEST_IDS.compositionTabs}"]`);
  const active = strip?.querySelector<HTMLElement>('[data-active="true"]');
  if (!strip || !active) return null;
  const shellBox = shell.getBoundingClientRect();
  const tab = active.getBoundingClientRect();
  const stripBox = strip.getBoundingClientRect();
  // The part of the active tab that is actually on screen.
  const tabLeft = Math.max(tab.left, stripBox.left);
  const tabRight = Math.min(tab.right, stripBox.right);
  if (tabRight <= tabLeft) return null;
  const leftRoom = tabLeft - shellBox.left - 2 * GAP_PX;
  const rightRoom = shellBox.right - tabRight - 2 * GAP_PX;
  if (Math.max(leftRoom, rightRoom) < MIN_SIDE_PX) return null;
  return rightRoom >= leftRoom
    ? { left: tabRight - shellBox.left + GAP_PX, right: 'auto', transform: 'none', maxWidth: rightRoom }
    : { left: 'auto', right: shellBox.right - tabLeft + GAP_PX, transform: 'none', maxWidth: leftRoom };
}

export function PhoneToast() {
  const toast = usePhoneUiStore((state) => state.toast);
  const dismissToast = usePhoneUiStore((state) => state.dismissToast);
  const activeSheet = usePhoneUiStore((state) => state.activeSheet);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(dismissToast, toast.tone === 'error' ? TOAST_MS.error : TOAST_MS.info);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  // Errors may wrap down over the preview (they must be readable), so only info toasts move aside.
  // Measured again a frame later: a sheet opened in the same tap (or its tab scrolled into view) may
  // only be laid out after this commit.
  useLayoutEffect(() => {
    const measure = () => {
      const element = ref.current;
      setPlace(element && toast?.tone !== 'error' ? besideActiveTab(element) : null);
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [toast, activeSheet]);

  if (!toast) return null;
  return (
    <div
      ref={ref}
      key={toast.id}
      className={`phone-toast phone-toast--${toast.tone}`}
      style={place ?? undefined}
      data-placement={place ? 'beside-tab' : 'row'}
      role="status"
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      data-testid={PHONE_TEST_IDS.toast}
    >
      {toast.message}
    </div>
  );
}
