import { create } from 'zustand';
import { cloudApi, type AuthProvider, type BillingPlanId, type BillingSummaryResponse, type CloudMeResponse } from '../services/cloudApi';
import {
  classifyProductAnalyticsFailure,
  productAnalytics,
  type ProductAnalyticsCheckoutFailureStage,
} from '../services/productAnalytics';
import { navigateToTrustedUrl, requireTrustedNavigationUrl } from '../services/security/trustedNavigation';

export type AccountDialogKind = 'auth' | 'pricing' | 'account' | null;

export interface CheckoutLegalConsent {
  immediatePerformanceRequested: boolean;
  locale: string;
  termsAccepted: boolean;
  termsVersion: string;
  withdrawalPolicyRead: boolean;
  withdrawalVersion: string;
}

export interface AccountState {
  applyHostedCreditBalance: (creditBalance: number) => void;
  billingSummary: BillingSummaryResponse | null;
  creditBalance: number;
  creditMeterReference: number;
  dialog: AccountDialogKind;
  entitlements: Record<string, string>;
  error: string | null;
  hostedAIEnabled: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  notice: string | null;
  session: CloudMeResponse['session'] | null;
  user: CloudMeResponse['user'];
  loadAccountState: () => Promise<void>;
  openAuthDialog: () => void;
  openAccountDialog: () => void;
  openPricingDialog: () => void;
  closeDialog: () => void;
  devLogin: (plan?: string) => Promise<void>;
  login: (input: { email: string; provider: AuthProvider; redirectTo?: string }) => Promise<void>;
  logout: () => Promise<void>;
  startCheckout: (planId: BillingPlanId | string, legalConsent?: CheckoutLegalConsent) => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

function pickCheckoutPlanId(planId: BillingPlanId | string): BillingPlanId | string {
  return planId || 'pro';
}

export function hasHostedAiSession(session: CloudMeResponse['session'] | null | undefined): boolean {
  return session?.authenticated === true || session?.guest === true;
}

/* ── Dev-login mock data (used when backend is not running) ── */

function applyDevMock(set: (partial: Partial<AccountState>) => void): void {
  set({
    billingSummary: null,
    creditBalance: 0,
    creditMeterReference: 0,
    dialog: 'account',
    entitlements: {},
    error: 'Local API backend is not running. Start npm run dev:full to test hosted AI with env keys.',
    hostedAIEnabled: false,
    isInitialized: true,
    isLoading: false,
    session: { authenticated: true, provider: 'dev' },
    user: { email: 'dev@masterselects.local', id: 'dev-user' },
  });
}

export const useAccountStore = create<AccountState>((set, get) => ({
  applyHostedCreditBalance: (creditBalance) => {
    set((state) => ({
      billingSummary: state.billingSummary
        ? {
            ...state.billingSummary,
            creditBalance,
            creditMeterReference: Math.max(state.billingSummary.creditMeterReference, creditBalance),
          }
        : null,
      creditBalance,
      creditMeterReference: Math.max(state.creditMeterReference, creditBalance),
    }));
  },
  billingSummary: null,
  creditBalance: 0,
  creditMeterReference: 0,
  dialog: null,
  entitlements: {},
  error: null,
  hostedAIEnabled: false,
  isInitialized: false,
  isLoading: false,
  notice: null,
  session: null,
  user: null,
  loadAccountState: async () => {
    try {
      const me = await cloudApi.auth.me();
      const billingSummary = await cloudApi.billing.summary();
      set({
        billingSummary,
        creditBalance: billingSummary.creditBalance ?? me.creditBalance ?? 0,
        creditMeterReference: Math.max(
          billingSummary.creditMeterReference ?? me.creditMeterReference ?? 0,
          billingSummary.creditBalance ?? me.creditBalance ?? 0,
        ),
        entitlements: billingSummary.entitlements ?? me.entitlements ?? {},
        hostedAIEnabled: billingSummary.hostedAIEnabled ?? me.hostedAIEnabled ?? false,
        isInitialized: true,
        session: me.session,
        user: me.user,
      });
    } catch (error) {
      set({
        billingSummary: null,
        creditBalance: 0,
        creditMeterReference: 0,
        entitlements: {},
        error: error instanceof Error ? error.message : 'Failed to load account state',
        hostedAIEnabled: false,
        isInitialized: true,
        notice: null,
        session: null,
        user: null,
      });
    }
  },
  openAuthDialog: () => set({ dialog: 'auth', error: null, notice: null }),
  openAccountDialog: () => set({ dialog: 'account', error: null, notice: null }),
  openPricingDialog: () => {
    productAnalytics.track('pricing_viewed');
    set({ dialog: 'pricing', error: null, notice: null });
  },
  closeDialog: () => set({ dialog: null, notice: null }),
  devLogin: async (plan) => {
    const planId = plan ?? 'studio';
    set({ isLoading: true, error: null, notice: null });

    try {
      await cloudApi.auth.devLogin({ plan: planId });
      await get().loadAccountState();
      set({ dialog: 'account' });
    } catch {
      // Backend not running — use frontend-only mock
      applyDevMock(set);
    }
  },
  login: async (input) => {
    set({ isLoading: true, error: null, notice: null });

    try {
      const response = await cloudApi.auth.login({
        ...input,
        redirectTo: input.redirectTo ?? `${window.location.pathname}${window.location.search}`,
      });
      if (response.authorizationUrl) {
        navigateToTrustedUrl(response.authorizationUrl, 'sign-in');
        return;
      }

      if (response.verificationUrl && response.delivery === 'debug_link') {
        navigateToTrustedUrl(response.verificationUrl, 'magic-link verification');
        return;
      }

      if (response.nextStep === 'check_email' || response.delivery === 'email_sent') {
        set({
          notice: response.message || 'Magic link sent. Check your inbox to finish sign-in.',
        });
        return;
      }

      if (response.nextStep === 'session_issued' || response.ok) {
        await get().loadAccountState();
        set({ dialog: 'account' });
        return;
      }

      set({ dialog: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Login failed' });
    } finally {
      set({ isLoading: false });
    }
  },
  logout: async () => {
    set({ isLoading: true, error: null });

    try {
      await cloudApi.auth.logout();
      await get().loadAccountState();
      set({ dialog: null, notice: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Logout failed' });
    } finally {
      set({ isLoading: false });
    }
  },
  startCheckout: async (planId, legalConsent) => {
    set({ isLoading: true, error: null });
    const analyticsPlanId = String(pickCheckoutPlanId(planId));
    let failureStage: ProductAnalyticsCheckoutFailureStage = 'session_create';
    productAnalytics.track('checkout_started', { plan: analyticsPlanId });

    try {
      const response = await cloudApi.billing.checkout({
        legalConsent,
        planId: pickCheckoutPlanId(planId),
        successUrl: `${window.location.origin}/?billing=success&plan=${encodeURIComponent(String(planId))}`,
      });

      failureStage = 'response_validation';
      if (!response.checkoutUrl) {
        throw new Error('Checkout session did not return a URL');
      }
      const checkoutUrl = requireTrustedNavigationUrl(response.checkoutUrl, 'checkout');
      productAnalytics.track('checkout_redirected', { plan: analyticsPlanId });
      void productAnalytics.flush({ keepalive: true });
      failureStage = 'redirect';
      navigateToTrustedUrl(checkoutUrl, 'checkout');
    } catch (error) {
      productAnalytics.track('checkout_failed', {
        failure_code: classifyProductAnalyticsFailure(error),
        failure_stage: failureStage,
        plan: analyticsPlanId,
      });
      set({ error: error instanceof Error ? error.message : 'Checkout failed' });
    } finally {
      set({ isLoading: false });
    }
  },
  openBillingPortal: async () => {
    set({ isLoading: true, error: null });

    try {
      const summary = get().billingSummary;
      if (!summary?.stripeCustomerId) {
        set({ dialog: 'pricing', isLoading: false });
        return;
      }

      const response = await cloudApi.billing.portal({ returnUrl: window.location.origin });
      navigateToTrustedUrl(response.portalUrl, 'billing portal');
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Billing portal failed' });
    } finally {
      set({ isLoading: false });
    }
  },
}));
