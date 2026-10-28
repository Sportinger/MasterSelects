import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { phoneToastDuration, phoneToastFit } from './phoneToastLayout';

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

/** Row width of the toast (PhoneShell.css: max-width min(92%, 420px)). */
const rowRoomOf = (shell: Element) => Math.min(shell.getBoundingClientRect().width * 0.92, 420);

interface ToastLayout {
  place: CSSProperties | null;
  wrap: boolean;
}

export function PhoneToast() {
  const toast = usePhoneUiStore((state) => state.toast);
  const dismissToast = usePhoneUiStore((state) => state.dismissToast);
  const activeSheet = usePhoneUiStore((state) => state.activeSheet);
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<ToastLayout>({ place: null, wrap: false });

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(dismissToast, phoneToastDuration(toast));
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  // Errors may wrap down over the preview (they must be readable), so only info toasts move aside, and
  // only when they fit there on one line; otherwise they take the row and wrap too.
  // Measured again a frame later: a sheet opened in the same tap (or its tab scrolled into view) may
  // only be laid out after this commit.
  useLayoutEffect(() => {
    const measure = () => {
      const element = ref.current;
      const shell = element?.closest('.phone-shell');
      if (!element || !shell || !toast || toast.tone === 'error' || !shell.querySelector('.phone-sheet')) {
        setLayout({ place: null, wrap: false });
        return;
      }
      const previous = element.style.whiteSpace;
      element.style.whiteSpace = 'nowrap';
      const natural = element.scrollWidth + 2; // + the 1 px border on each side
      element.style.whiteSpace = previous;
      const beside = besideActiveTab(element);
      const fit = phoneToastFit(natural, beside ? Number(beside.maxWidth) : null, rowRoomOf(shell));
      setLayout({ place: fit.placement === 'beside-tab' ? beside : null, wrap: fit.wrap });
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
      style={layout.place ?? undefined}
      data-placement={layout.place ? 'beside-tab' : 'row'}
      data-wrap={layout.wrap ? 'true' : undefined}
      role="status"
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      data-testid={PHONE_TEST_IDS.toast}
    >
      {toast.message}
    </div>
  );
}
