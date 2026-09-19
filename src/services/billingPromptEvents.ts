export const BILLING_UPGRADE_REQUIRED_EVENT = 'masterselects:billing-upgrade-required';

export function notifyBillingUpgradeRequired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BILLING_UPGRADE_REQUIRED_EVENT));
}

export function responseRequiresBillingUpgrade(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const response = value as {
    error?: string | { code?: string };
    next?: string;
    status?: string;
  };
  const code = typeof response.error === 'object' ? response.error?.code : response.error;
  return response.next === 'pricing'
    || response.status === 'requires_billing'
    || code === 'insufficient_credits';
}
