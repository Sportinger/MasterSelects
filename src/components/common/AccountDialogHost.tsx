import { useCallback, useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import { BILLING_UPGRADE_REQUIRED_EVENT } from '../../services/billingPromptEvents';
import { AccountDialog } from './AccountDialog';
import { AuthDialog } from './AuthDialog';
import { BillingSuccessCelebration } from './BillingSuccessCelebration';
import { PricingDialog } from './PricingDialog';
import './authBillingDialogs.css';

interface BillingSuccessState {
  planId: string | null;
  token: number;
}

export function AccountDialogHost() {
  const accountDialog = useAccountStore((state) => state.dialog);
  const accountCreditBalance = useAccountStore((state) => state.creditBalance);
  const closeAccountDialog = useAccountStore((state) => state.closeDialog);
  const isAccountInitialized = useAccountStore((state) => state.isInitialized);
  const loadAccountState = useAccountStore((state) => state.loadAccountState);
  const openAccountDialog = useAccountStore((state) => state.openAccountDialog);
  const openPricingDialog = useAccountStore((state) => state.openPricingDialog);
  const [redeemCode, setRedeemCode] = useState(() => (
    new URLSearchParams(window.location.search).get('redeem')?.trim() ?? ''
  ));
  const [billingSuccess, setBillingSuccess] = useState<BillingSuccessState | null>(null);

  const closeBillingSuccess = useCallback(() => {
    setBillingSuccess(null);
  }, []);

  const clearRedeemCode = useCallback(() => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete('offer');
    currentUrl.searchParams.delete('offerPreview');
    currentUrl.searchParams.delete('redeem');
    window.history.replaceState(
      {},
      document.title,
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
    setRedeemCode('');
  }, []);

  useEffect(() => {
    void loadAccountState();
  }, [loadAccountState]);

  useEffect(() => {
    const showUpgrade = () => openPricingDialog();
    window.addEventListener(BILLING_UPGRADE_REQUIRED_EVENT, showUpgrade);
    return () => window.removeEventListener(BILLING_UPGRADE_REQUIRED_EVENT, showUpgrade);
  }, [openPricingDialog]);

  useEffect(() => {
    if (!isAccountInitialized) return;

    const currentUrl = new URL(window.location.href);
    const authStatus = currentUrl.searchParams.get('auth');
    const billingStatus = currentUrl.searchParams.get('billing');
    const billingPlanId = currentUrl.searchParams.get('plan');
    const showBillingSuccessPreview = currentUrl.searchParams.get('showBillingSuccess') === '1';

    if (authStatus !== 'success' && billingStatus !== 'success' && !showBillingSuccessPreview) {
      return;
    }

    const finalize = async () => {
      await loadAccountState();
      if (!showBillingSuccessPreview) {
        openAccountDialog();
      }
      if (billingStatus === 'success' || showBillingSuccessPreview) {
        setBillingSuccess({
          planId: billingPlanId,
          token: Date.now(),
        });
      }

      currentUrl.searchParams.delete('auth');
      currentUrl.searchParams.delete('billing');
      currentUrl.searchParams.delete('plan');
      currentUrl.searchParams.delete('showBillingSuccess');
      window.history.replaceState(
        {},
        document.title,
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    };

    void finalize();
  }, [isAccountInitialized, loadAccountState, openAccountDialog]);

  if (!accountDialog && !billingSuccess) return null;

  return (
    <div className="account-dialog-host">
      {accountDialog === 'auth' && <AuthDialog onClose={closeAccountDialog} />}
      {accountDialog === 'pricing' && <PricingDialog onClose={closeAccountDialog} />}
      {accountDialog === 'account' && (
        <AccountDialog
          initialRedeemCode={redeemCode}
          onClose={closeAccountDialog}
          onRedeemed={clearRedeemCode}
        />
      )}
      {billingSuccess && (
        <BillingSuccessCelebration
          creditBalance={accountCreditBalance}
          key={billingSuccess.token}
          onClose={closeBillingSuccess}
          planId={billingSuccess.planId}
        />
      )}
    </div>
  );
}
