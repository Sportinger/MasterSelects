import { useEffect, useId, useRef } from 'react';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

/** Small sheet explaining why a greyed-out action does not work yet. Tap outside to dismiss. */
export function PhoneUnavailableNotice() {
  const notice = usePhoneUiStore((state) => state.unavailableNotice);
  const dismiss = usePhoneUiStore((state) => state.dismissUnavailable);
  const okRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const open = notice !== null;

  // Focus moves to OK and returns to the greyed control that opened the notice.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    okRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  // Escape closes only the notice (capture phase), not a sheet underneath it.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, dismiss]);

  if (!notice) return null;
  return (
    <div className="phone-notice-backdrop" onPointerDown={dismiss}>
      <div
        className="phone-notice"
        role="alertdialog"
        aria-modal="true"
        aria-label={`${notice.label} is not available yet`}
        aria-describedby={reasonId}
        data-testid={PHONE_TEST_IDS.unavailableNotice}
        data-action-id={notice.actionId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="phone-notice__title">{notice.label}</div>
        <p id={reasonId} className="phone-notice__reason">{notice.reason}</p>
        <button ref={okRef} type="button" className="phone-button phone-button--primary" onClick={dismiss}>
          OK
        </button>
      </div>
    </div>
  );
}
