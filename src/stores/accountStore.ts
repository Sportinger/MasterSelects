import { create } from 'zustand';
import { cloudApi, type AuthProvider, type BillingPlanId, type BillingSummaryResponse, type CloudMeResponse } from '../services/cloudApi';

export type AccountDialogKind = 'auth' | 'pricing' | 'account' | null;

export interface AccountState {
  billingSummary: BillingSummaryResponse | null;
  creditBalance: number;
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
  startCheckout: (planId: BillingPlanId | string) => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

function pickCheckoutPlanId(planId: BillingPlanId | string): BillingPlanId | string {
  return planId || 'pro';
}

/* ── Dev-login mock data (used when backend is not running) ── */

const DEV_PLAN_MOCKS: Record<string, { credits: number; entitlements: Record<string, string>; label: string }> = {
  free:    { credits: 25,   label: 'Free',    entitlements: { hosted_ai_chat: 'true' } },
  starter: { credits: 250,  label: 'Starter', entitlements: { hosted_ai_chat: 'true' } },
  pro:     { credits: 1000, label: 'Pro',     entitlements: { hosted_ai_chat: 'true', kling_generation: 'true', priority_queue: 'true' } },
  studio:  { credits: 5000, label: 'Studio',  entitlements: { hosted_ai_chat: 'true', kling_generation: 'true', priority_queue: 'true', api_access: 'true' } },
};

function applyDevMock(set: (partial: Partial<AccountState>) => void, planId: string): void {
  const mock = DEV_PLAN_MOCKS[planId] ?? DEV_PLAN_MOCKS.studio;
  set({
    billingSummary: null,
    creditBalance: mock.credits,
    dialog: 'account',
    entitlements: mock.entitlements,
    error: null,
    hostedAIEnabled: true,
    isInitialized: true,
    isLoading: false,
    session: { authenticated: true, provider: 'dev' },
    user: { email: 'dev@masterselects.local', id: 'dev-user' },
  });
}

export const useAccountStore = create<AccountState>((set, get) => ({
  billingSummary: null,
  creditBalance: 0,
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
      const [me, billingSummary] = await Promise.all([cloudApi.auth.me(), cloudApi.billing.summary()]);
      set({
        billingSummary,
        creditBalance: billingSummary.creditBalance ?? me.creditBalance ?? 0,
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
  openPricingDialog: () => set({ dialog: 'pricing', error: null, notice: null }),
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
      applyDevMock(set, planId);
    }
  },
  login: async (input) => {
    set({ isLoading: true, error: null, notice: null });

    try {
      const response = await cloudApi.auth.login(input);
      if (response.authorizationUrl) {
        window.location.assign(response.authorizationUrl);
        return;
      }

      if (response.verificationUrl) {
        if (response.delivery === 'debug_link') {
          window.location.assign(response.verificationUrl);
          return;
        }

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
      set({
        billingSummary: null,
        creditBalance: 0,
        dialog: null,
        entitlements: {},
        hostedAIEnabled: false,
        notice: null,
        session: null,
        user: null,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Logout failed' });
    } finally {
      set({ isLoading: false });
    }
  },
  startCheckout: async (planId) => {
    set({ isLoading: true, error: null });

    try {
      const summary = get().billingSummary;
      if (summary?.stripeCustomerId && summary.subscription && summary.subscription.status !== 'canceled') {
        const portal = await cloudApi.billing.portal({ returnUrl: window.location.origin });
        window.location.assign(portal.portalUrl);
        return;
      }

      const response = await cloudApi.billing.checkout({
        planId: pickCheckoutPlanId(planId),
        successUrl: `${window.location.origin}/?billing=success&plan=${encodeURIComponent(String(planId))}`,
      });

      if (response.checkoutUrl) {
        window.location.assign(response.checkoutUrl);
      } else {
        throw new Error('Checkout session did not return a URL');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Checkout failed' });
    } finally {
      set({ isLoading: false });
    }
  },
  openBillingPortal: async () => {
    set({ isLoading: true, error: null });

    try {
      const response = await cloudApi.billing.portal({ returnUrl: window.location.origin });
      window.location.assign(response.portalUrl);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Billing portal failed' });
    } finally {
      set({ isLoading: false });
    }
  },
}));
