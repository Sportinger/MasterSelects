import { useEffect, useRef } from 'react';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

/** Small sheet explaining why a greyed-out action does not work yet. Tap outside to dismiss. */
export function PhoneUnavailableNotice() {
  const notice = usePhoneUiStore((state) => state.unavailableNotice);
  const dismiss = usePhoneUiStore((state) => state.dismissUnavailable);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!notice) return undefined;
    okRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div className="phone-notice-backdrop" onPointerDown={dismiss}>
      <div
        className="phone-notice"
        role="alertdialog"
        aria-modal="true"
        aria-label={`${notice.label} is not available yet`}
        data-testid={PHONE_TEST_IDS.unavailableNotice}
        data-action-id={notice.actionId}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="phone-notice__title">{notice.label}</div>
        <p className="phone-notice__reason">{notice.reason}</p>
        <button ref={okRef} type="button" className="phone-button phone-button--primary" onClick={dismiss}>
          OK
        </button>
      </div>
    </div>
  );
}
