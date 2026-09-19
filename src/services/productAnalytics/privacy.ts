const PRODUCT_ANALYTICS_PREFERENCE_KEY = 'ms.productAnalytics.enabled';
const PRODUCT_ANALYTICS_PREFERENCE_EVENT = 'masterselects:product-analytics-preference';

// Keep a choice that could not be persisted for the lifetime of this page.
let unpersistedPreference: boolean | null = import.meta.hot?.data?.unpersistedPreference ?? null;

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.unpersistedPreference = unpersistedPreference; });
}

type NavigatorWithPrivacySignals = Navigator & {
  globalPrivacyControl?: boolean;
  msDoNotTrack?: string;
};

export function hasProductAnalyticsPrivacySignal(): boolean {
  if (typeof navigator === 'undefined') return false;
  const privacyNavigator = navigator as NavigatorWithPrivacySignals;
  const doNotTrack = privacyNavigator.doNotTrack ?? privacyNavigator.msDoNotTrack;
  return privacyNavigator.globalPrivacyControl === true || doNotTrack === '1' || doNotTrack === 'yes';
}
export function getStoredProductAnalyticsPreference(): boolean {
  if (unpersistedPreference !== null) return unpersistedPreference;
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(PRODUCT_ANALYTICS_PREFERENCE_KEY) !== 'false';
  } catch {
    // Storage can become inaccessible during pagehide. An unreadable preference
    // must neither crash navigation nor be interpreted as permission to send.
    return false;
  }
}

export function isProductAnalyticsEnabled(): boolean {
  return getStoredProductAnalyticsPreference() && !hasProductAnalyticsPrivacySignal();
}

export function setStoredProductAnalyticsPreference(enabled: boolean): void {
  unpersistedPreference = enabled;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PRODUCT_ANALYTICS_PREFERENCE_KEY, String(enabled));
      unpersistedPreference = null;
    }
  } catch {
    // Retain the explicit local choice even if a stale persisted value differs.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRODUCT_ANALYTICS_PREFERENCE_EVENT, {
      detail: { enabled },
    }));
  }
}

export function subscribeProductAnalyticsPreference(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
