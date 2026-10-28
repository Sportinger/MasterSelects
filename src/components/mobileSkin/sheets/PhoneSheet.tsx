// Frame of every bottom sheet: backdrop, grab handle, header (Cancel, title, Done) and a scrolling body.
// Cancel, Escape, a tap on the top bar area and a drag of the handle down past the smallest detent call
// onCancel; Done calls onDone. A touch on the preview never closes a sheet (that would throw its edits
// away). The sheet sizes to its content up to the cap from PHONE_SHEET_SIZES (phoneSheetSizing.ts);
// the transport stays docked above it and the preview takes the room above that.
// The sheet owns focus: it moves in on open and returns to the opener on close. Tab and Shift+Tab cycle
// through the docked transport (Play, Keyframe, Undo, Redo, Fullscreen) and the sheet, the same controls
// a finger can reach; the strips the sheet covers are inert meanwhile (PhoneShell). Over the home screen
// no transport is docked and the sheet is a plain modal dialog.

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { PHONE_TEST_IDS, type PhoneSheetProps } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { usePhoneSheetId } from './phoneSheetContext';
import { PHONE_SHEET_DETENT_LABELS, PHONE_SHEET_FRAME_TEST_IDS, phoneSheetSizeFor, type PhoneSheetSize } from './phoneSheetSizing';
import { usePhoneSheetDetent } from './usePhoneSheetDetent';
import './PhoneSheet.css';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusablesIn = (root: HTMLElement | null | undefined): HTMLElement[] =>
  root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => !item.closest('[inert], [hidden], [aria-hidden="true"]')) : [];

/** The transport docked above the sheet, or null while the home screen covers the strips. */
function dockedPhoneTransport(panel: HTMLElement | null): HTMLElement | null {
  const shell = panel?.closest('.phone-shell');
  if (!shell || shell.querySelector('.phone-home')) return null;
  return shell.querySelector<HTMLElement>(`[data-testid="${PHONE_TEST_IDS.transport}"]`);
}

/**
 * The element that had focus when a sheet was asked for. A sheet opened from the top bar or the tool
 * bar makes its opener inert in the same commit, which can drop its focus before the sheet's effect
 * reads it, so it is noted synchronously when the open sheet id changes (before React renders).
 */
let openerAtOpen: HTMLElement | null = null;
const focusedOutsideSheet = (): HTMLElement | null => {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body && !active.closest('.phone-sheet') ? active : null;
};
usePhoneUiStore.subscribe((state) => state.activeSheet, (sheet, previous) => {
  if (sheet !== null && previous === null && typeof document !== 'undefined') openerAtOpen = focusedOutsideSheet();
});

interface PhoneSheetFrameProps extends PhoneSheetProps {
  /**
   * Overrides the PHONE_SHEET_SIZES entry while the sheet shows this content, for a sheet whose
   * content changes kind (Notation: a small empty state, then a full-height score editor).
   */
  size?: PhoneSheetSize;
  /**
   * The placeholder frame while a sheet's code loads. It is not the sheet yet, so it carries its own
   * test id: waiting for the sheet waits for the real one, whose box then stays put.
   */
  loading?: boolean;
}

export function PhoneSheet({
  title,
  height = 'half',
  size: sizeOverride,
  loading = false,
  onCancel,
  onDone,
  doneLabel = 'Done',
  doneDisabled = false,
  cancelLabel = 'Cancel',
  children,
}: PhoneSheetFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sheetId = usePhoneSheetId();
  const size = sizeOverride ?? phoneSheetSizeFor(sheetId, height);
  const sizing = usePhoneSheetDetent(panelRef, bodyRef, sheetId, size, onCancel);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId();

  // Focus moves into the sheet on open (unless a child already took it, e.g. an input) and back on close.
  const [transportDocked, setTransportDocked] = useState(false);
  useLayoutEffect(() => setTransportDocked(dockedPhoneTransport(panelRef.current) !== null), []);

  useEffect(() => {
    const opener = focusedOutsideSheet() ?? openerAtOpen;
    openerAtOpen = null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tab cycles through the docked transport and the sheet (in screen order: transport first).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (!panel) return;
      const transport = dockedPhoneTransport(panel);
      const active = document.activeElement;
      const inside = panel.contains(active) || Boolean(transport?.contains(active));
      // Focus elsewhere on purpose (e.g. a handle on the preview a sheet draws on) keeps its own order.
      if (!inside && active && active !== document.body) return;
      const order = [...focusablesIn(transport), ...focusablesIn(panel)];
      event.preventDefault();
      if (order.length === 0) return;
      const index = order.indexOf(active as HTMLElement);
      if (index < 0) {
        // The panel itself (just opened) or nothing: step to the sheet's first or the order's last control.
        const firstInPanel = order.findIndex((item) => panel.contains(item));
        (event.shiftKey ? order[order.length - 1] : order[Math.max(0, firstInPanel)]).focus();
        return;
      }
      order[(index + (event.shiftKey ? -1 : 1) + order.length) % order.length].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Outside taps close the sheet only above the preview (top bar, composition tabs) or over the home.
  const onBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const shell = event.currentTarget.closest('.phone-shell');
    const preview = shell?.querySelector<HTMLElement>('.phone-shell__preview');
    const overHome = Boolean(shell?.querySelector('.phone-home'));
    if (overHome || !preview || event.clientY < preview.getBoundingClientRect().top) onCancel();
  };

  const sizeLabel = PHONE_SHEET_DETENT_LABELS[sizing.detent];
  return (
    <div className="phone-sheet-backdrop" onPointerDown={onBackdropPointerDown}>
      <div
        ref={panelRef}
        className="phone-sheet"
        role="dialog"
        aria-modal={transportDocked ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-height={size}
        data-detent={sizing.detent}
        data-sheet-id={sheetId ?? undefined}
        aria-busy={loading || undefined}
        data-testid={loading ? PHONE_SHEET_FRAME_TEST_IDS.loading : PHONE_TEST_IDS.sheet}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="phone-sheet__grabber"
          aria-label={`Sheet size: ${sizeLabel}. Tap to resize, or use the up and down arrow keys`}
          aria-keyshortcuts="ArrowUp ArrowDown"
          data-testid={PHONE_SHEET_FRAME_TEST_IDS.grabber}
          data-detent={sizing.detent}
          {...sizing.grabberProps}
        >
          <span className="phone-sheet__grabber-bar" aria-hidden="true" />
        </button>
        <header className="phone-sheet__header" {...sizing.headerDragProps}>
          <button
            type="button"
            className="phone-sheet__action"
            data-testid={PHONE_TEST_IDS.sheetCancel}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <h2 id={titleId} className="phone-sheet__title">{title}</h2>
          {onDone ? (
            <button
              type="button"
              className="phone-sheet__action phone-sheet__action--done"
              aria-disabled={doneDisabled}
              data-testid={PHONE_TEST_IDS.sheetDone}
              onClick={() => {
                if (!doneDisabled) onDone();
              }}
            >
              {doneLabel}
            </button>
          ) : (
            <span className="phone-sheet__action-spacer" aria-hidden="true" />
          )}
        </header>
        <div ref={bodyRef} className="phone-sheet__body">{children}</div>
      </div>
    </div>
  );
}
