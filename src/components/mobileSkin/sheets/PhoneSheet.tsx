// Frame of every bottom sheet: backdrop, header (Cancel, title, Done) and a scrolling body.
// Cancel and Escape and a backdrop tap all call onCancel; Done calls onDone. The sheet owns focus:
// it moves in on open and returns to the opener on close. The preview above stays visible.

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { PHONE_TEST_IDS, type PhoneSheetProps } from '../contracts';
import './PhoneSheet.css';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PhoneSheet({
  title,
  height = 'half',
  onCancel,
  onDone,
  doneLabel = 'Done',
  doneDisabled = false,
  cancelLabel = 'Cancel',
  children,
}: PhoneSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const titleId = useId();

  // Focus moves into the sheet on open (unless a child already took it, e.g. an input) and back on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  // Keep Tab inside the modal sheet.
  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="phone-sheet-backdrop" onPointerDown={onCancel}>
      <div
        ref={panelRef}
        className="phone-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-height={height}
        data-testid={PHONE_TEST_IDS.sheet}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onPanelKeyDown}
      >
        <header className="phone-sheet__header">
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
        <div className="phone-sheet__body">{children}</div>
      </div>
    </div>
  );
}
