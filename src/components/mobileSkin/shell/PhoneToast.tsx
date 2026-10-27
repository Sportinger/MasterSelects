import { useEffect } from 'react';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';

const TOAST_MS = 4000;

export function PhoneToast() {
  const toast = usePhoneUiStore((state) => state.toast);
  const dismissToast = usePhoneUiStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(dismissToast, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;
  return (
    <div
      key={toast.id}
      className={`phone-toast phone-toast--${toast.tone}`}
      role="status"
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      data-testid={PHONE_TEST_IDS.toast}
    >
      {toast.message}
    </div>
  );
}
