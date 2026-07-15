import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import { cloudApi } from '../../services/cloudApi';
import { BILLING_PLANS, formatBillingPlanLabel } from '../../services/billingPlans';
import { CLOUD_AI_PRICE_ROWS, CLOUD_EUR_PER_CREDIT, CLOUD_PRICE_BASELINE_PLAN } from '../../services/cloudAiPricing';
import './authBillingDialogs.css';
import './AccountRedeem.css';

interface AccountDialogProps {
  initialRedeemCode?: string;
  onClose: () => void;
  onRedeemed?: () => void;
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatEuro(value: number): string {
  const fractionDigits = value < 0.1 ? 3 : 2;
  return new Intl.NumberFormat('de-DE', {
    currency: 'EUR',
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: 'currency',
  }).format(value);
}

function formatSubscriptionStatus(status: string | null | undefined): string {
  if (!status) {
    return 'No active subscription';
  }

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatBillingDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function AccountDialog({ initialRedeemCode = '', onClose, onRedeemed }: AccountDialogProps) {
  const {
    applyHostedCreditBalance,
    billingSummary,
    error,
    isLoading,
    loadAccountState,
    logout,
    openBillingPortal,
    openPricingDialog,
  } = useAccountStore();
  const [isClosing, setIsClosing] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [redeemCode, setRedeemCode] = useState(initialRedeemCode);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);

  useEffect(() => {
    setRedeemCode(initialRedeemCode);
  }, [initialRedeemCode]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose, isClosing]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleBackdropClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  const summary = billingSummary;
  const displayName = summary?.user?.displayName || summary?.user?.email || 'Guest';
  const email = summary?.user?.email ?? '';
  const hasBillingAccount = Boolean(summary?.stripeCustomerId);
  const currentPlanLabel = summary?.plan.label || 'Free';
  const creditBalance = summary?.creditBalance ?? 0;
  const hostedAiLabel = summary?.hostedAIEnabled ? 'Enabled' : 'Disabled';
  const usageRows = (summary?.usage.byFeature ?? []).slice(0, 5);
  const subscriptionEndsAt = formatBillingDate(summary?.subscription?.currentPeriodEnd);
  const subscriptionStatusLabel = summary?.subscription?.cancelAtPeriodEnd
    ? 'Canceled'
    : formatSubscriptionStatus(summary?.subscription?.status);
  const subscriptionDetailLabel = summary?.subscription?.cancelAtPeriodEnd && subscriptionEndsAt
    ? `Canceled · ends on ${subscriptionEndsAt}`
    : subscriptionStatusLabel;
  const canRedeem = /^\d{6}$/.test(redeemCode.trim()) && Boolean(email) && !isRedeeming && !isLoading;

  const handleRedeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRedeem) return;

    setIsRedeeming(true);
    setRedeemError(null);
    setRedeemNotice(null);

    try {
      const result = await cloudApi.credits.redeemClaim({
        code: redeemCode.trim(),
        email,
        redeemCode: true,
      });
      applyHostedCreditBalance(result.creditBalance);
      await loadAccountState();
      setRedeemNotice(`${formatCredits(result.amount)} credits added to your account.`);
      setRedeemCode('');
      onRedeemed?.();
    } catch (caught) {
      setRedeemError(caught instanceof Error ? caught.message : 'The gift code could not be redeemed.');
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleBackdropClick}>
      <div className="welcome-overlay auth-dialog auth-dialog-wide">
        <div className="auth-dialog-header">
          <div className="auth-dialog-header-left">
            <div className="changelog-heading">
              <span className="changelog-brand" aria-label="MasterSelects">
                <span className="changelog-brand-master">Master</span>
                <span className="changelog-brand-selects">Selects</span>
              </span>
              <h2 className="changelog-header-title">Account</h2>
            </div>
          </div>
          <div className="auth-dialog-header-right">
            <button className="changelog-header-button" onClick={handleClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="auth-dialog-content account-dialog-content">
          <div className="account-hero">
            <div className="auth-dialog-intro account-hero-copy">
              <span className="account-hero-kicker">Workspace account</span>
              <h3 className="auth-dialog-subtitle">{displayName}</h3>
              {email && (
                <p className="account-hero-meta">{email}</p>
              )}
            </div>
            <div className="account-hero-badges">
              <span className="account-hero-badge">{currentPlanLabel}</span>
              <span className="account-hero-badge account-hero-badge-accent">
                {formatCredits(creditBalance)} credits
              </span>
            </div>
          </div>

          <div className="account-panel-heading">
            <span className="account-panel-label">Account overview</span>
          </div>

          <div className="account-metrics-grid">
            <div className="account-metric-card account-metric-card-plan">
              <span className="account-metric-label">Plan</span>
              <strong className="account-metric-value">{currentPlanLabel}</strong>
              <span className="account-metric-detail">{subscriptionDetailLabel}</span>
            </div>
            <div className="account-metric-card account-metric-card-credits">
              <span className="account-metric-label">Credits</span>
              <strong className="account-metric-value">{formatCredits(creditBalance)}</strong>
              <span className="account-metric-detail">Available right now</span>
            </div>
            <div className="account-metric-card account-metric-card-hosted">
              <span className="account-metric-label">Hosted AI</span>
              <strong className="account-metric-value">{hostedAiLabel}</strong>
              <span className="account-metric-detail">
                {summary?.hostedAIEnabled ? 'Cloud generation is ready' : 'Billing required for hosted generation'}
              </span>
            </div>
          </div>

          <form className="account-redeem-card" onSubmit={handleRedeem}>
            <div>
              <span className="account-metric-label">Redeem gift code</span>
              <p>Sign in first, then enter your personal six-digit code.</p>
            </div>
            <div className="account-redeem-controls">
              <input
                aria-label="Six-digit gift code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setRedeemCode(event.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                value={redeemCode}
              />
              <button className="auth-dialog-submit" disabled={!canRedeem} type="submit">
                {isRedeeming ? 'Redeeming...' : 'Redeem'}
              </button>
            </div>
            {redeemNotice && <span className="account-redeem-notice">{redeemNotice}</span>}
            {redeemError && <span className="account-redeem-error">{redeemError}</span>}
          </form>

          {showPrices && (
            <div className="account-usage-card account-prices-card">
              <div className="account-usage-header">
                <div>
                  <div className="account-metric-label">Cloud AI prices</div>
                  <span className="account-price-rate">
                    Euro estimates use {formatBillingPlanLabel(CLOUD_PRICE_BASELINE_PLAN.id)}:
                    {' '}
                    {formatEuro(CLOUD_PRICE_BASELINE_PLAN.priceEurMonthly)} / {formatCredits(CLOUD_PRICE_BASELINE_PLAN.credits)} credits
                  </span>
                </div>
                <span className="account-usage-summary">
                  {formatEuro(CLOUD_EUR_PER_CREDIT)} / credit
                </span>
              </div>

              <div className="account-price-list">
                {CLOUD_AI_PRICE_ROWS.map((row) => (
                  <div key={`${row.category}-${row.name}-${row.note}`} className="account-price-entry">
                    <div className="account-price-main">
                      <span className="account-price-category">{row.category}</span>
                      <strong className="account-price-name">{row.name}</strong>
                      <span className="account-price-note">{row.note}</span>
                    </div>
                    <div className="account-price-values">
                      <strong>{formatCredits(row.credits)} cr / {row.unit}</strong>
                      <span>{formatEuro(row.credits * CLOUD_EUR_PER_CREDIT)} / {row.unit}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="account-plan-price-grid">
                {BILLING_PLANS.map((plan) => (
                  <div key={plan.id} className="account-plan-price-card">
                    <span>{formatBillingPlanLabel(plan.id)}</span>
                    <strong>{plan.priceAmount} {plan.priceSuffix}</strong>
                    <em>{formatCredits(plan.credits)} credits / month</em>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`account-actions-row ${hasBillingAccount ? '' : 'account-actions-row-single'}`.trim()}>
            <button
              className="auth-dialog-submit"
              disabled={isLoading}
              onClick={() => setShowPrices((current) => !current)}
              type="button"
            >
              {showPrices ? 'Hide prices' : 'Prices'}
            </button>
            <button className="auth-dialog-action-secondary" disabled={isLoading} onClick={openPricingDialog} type="button">
              Change plan
            </button>
            {hasBillingAccount && (
              <button className="auth-dialog-action-secondary" disabled={isLoading} onClick={() => openBillingPortal()} type="button">
                Manage billing
              </button>
            )}
          </div>

          <div className="account-signout-row">
            <button className="auth-dialog-action-ghost" disabled={isLoading} onClick={() => logout()} type="button">
              Sign out
            </button>
          </div>

          <details className="account-usage-card account-usage-disclosure">
            <summary>
              <span className="account-metric-label">Recent usage</span>
              {usageRows.length > 0 && (
                <span className="account-usage-summary">
                  {summary?.usage.completedCount ?? 0} complete, {formatCredits(summary?.usage.creditCost ?? 0)} credits
                </span>
              )}
            </summary>
            <div className="account-usage-list">
              {usageRows.map((entry) => (
                <div key={entry.feature} className="account-usage-entry">
                  <div className="account-usage-feature">
                    <span className="account-usage-name">{entry.feature}</span>
                    <span className="account-usage-detail">
                      {entry.completedCount} complete, {formatCredits(entry.creditCost)} credits
                    </span>
                  </div>
                  <span className="account-usage-count">
                    {entry.pendingCount > 0 ? `${entry.pendingCount} pending` : 'Done'}
                  </span>
                </div>
              ))}
              {!usageRows.length && (
                <div className="account-usage-empty">
                  <strong className="account-usage-empty-title">No hosted activity yet.</strong>
                  <span className="account-usage-empty-detail">
                    Image, chat, and video generations will appear here once you run them.
                  </span>
                </div>
              )}
            </div>
          </details>

          {error && <div className="auth-dialog-notice auth-dialog-notice-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
