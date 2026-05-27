import { useCallback, useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import { BILLING_PLANS as plans, formatBillingPlanLabel } from '../../services/billingPlans';
import { CLOUD_AI_PRICE_ROWS, CLOUD_EUR_PER_CREDIT, CLOUD_PRICE_BASELINE_PLAN } from '../../services/cloudAiPricing';
import './authBillingDialogs.css';

interface PricingDialogProps {
  onClose: () => void;
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

export function PricingDialog({ onClose }: PricingDialogProps) {
  const { billingSummary, error, isLoading, openAuthDialog, session, startCheckout } = useAccountStore();
  const [isClosing, setIsClosing] = useState(false);
  const currentPlanId = billingSummary?.subscription?.planId ?? billingSummary?.plan.id ?? 'free';
  const [selectedPlanId, setSelectedPlanId] = useState(currentPlanId);

  useEffect(() => {
    setSelectedPlanId(currentPlanId);
  }, [currentPlanId]);

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

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const currentPlan = plans.find((plan) => plan.id === currentPlanId) ?? plans[0];
  const selectedPlanIsCurrent = selectedPlan.id === currentPlanId;
  const cancelScheduled = Boolean(billingSummary?.subscription?.cancelAtPeriodEnd);
  const isAuthenticated = Boolean(session?.authenticated);
  const hasManagedSubscription = Boolean(
    billingSummary?.stripeCustomerId
    && billingSummary.subscription
    && billingSummary.subscription.status !== 'canceled',
  );
  const isDowngradeSelection = hasManagedSubscription
    && (selectedPlan.id === 'free' || selectedPlan.credits < currentPlan.credits);
  const isUpgradeSelection = hasManagedSubscription
    && selectedPlan.id !== 'free'
    && selectedPlan.credits > currentPlan.credits;
  const canSubmitSelection = !isLoading && (!isAuthenticated || !selectedPlanIsCurrent);
  const submitLabel = selectedPlanIsCurrent
    ? cancelScheduled
      ? 'Canceled plan'
      : 'Current plan'
    : isDowngradeSelection && selectedPlan.id === 'free'
      ? 'Downgrade to Free'
    : isDowngradeSelection
      ? `Downgrade to ${formatBillingPlanLabel(selectedPlan.id)}`
      : isUpgradeSelection
        ? `Upgrade to ${formatBillingPlanLabel(selectedPlan.id)}`
        : hasManagedSubscription
          ? `Change to ${formatBillingPlanLabel(selectedPlan.id)}`
          : `Continue with ${formatBillingPlanLabel(selectedPlan.id)}`;
  const primaryCtaLabel = isAuthenticated ? submitLabel : 'Sign up';

  const handleSelectPlan = (planId: string) => {
    if (isLoading) {
      return;
    }

    setSelectedPlanId(planId);
  };

  const handleCardKeyDown = (
    event: React.KeyboardEvent<HTMLElement>,
    planId: string,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelectPlan(planId);
    }
  };

  const handleContinue = () => {
    if (!canSubmitSelection) {
      return;
    }

    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }

    void startCheckout(selectedPlan.id);
  };

  return (
    <div className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleBackdropClick}>
      <div className="welcome-overlay auth-dialog auth-dialog-pricing">
        <div className="auth-dialog-header">
          <div className="auth-dialog-header-left">
            <div className="changelog-heading">
              <span className="changelog-brand" aria-label="MasterSelects">
                <span className="changelog-brand-master">Master</span>
                <span className="changelog-brand-selects">Selects</span>
              </span>
              <h2 className="changelog-header-title">Pricing</h2>
            </div>
          </div>
          <div className="auth-dialog-header-right">
            <button className="changelog-header-button" onClick={handleClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="auth-dialog-content pricing-dialog-content">
          <div className="pricing-dialog-top-cta">
            <span className="pricing-dialog-top-selection">
              {formatBillingPlanLabel(selectedPlan.id)} selected
            </span>
            <button
              className="auth-dialog-submit pricing-dialog-signup"
              disabled={!canSubmitSelection}
              onClick={handleContinue}
              type="button"
            >
              {primaryCtaLabel}
            </button>
          </div>

          <div className="pricing-plans-grid">
            {plans.map((plan) => {
              const isCurrentPlan = plan.id === currentPlanId;
              const isSelectedPlan = plan.id === selectedPlanId;

              return (
                <article
                  key={plan.id}
                  aria-pressed={isSelectedPlan}
                  className={[
                    'pricing-plan-card',
                    `pricing-plan-card-${plan.id}`,
                    plan.featured ? 'pricing-plan-featured' : '',
                    isCurrentPlan ? 'pricing-plan-current' : '',
                    isSelectedPlan ? 'pricing-plan-selected' : '',
                    'pricing-plan-selectable',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleSelectPlan(plan.id)}
                  onKeyDown={(event) => handleCardKeyDown(event, plan.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="pricing-plan-badges">
                    <span className="pricing-plan-badge">{plan.badge}</span>
                    {isCurrentPlan && (
                      <span className="pricing-plan-badge pricing-plan-badge-current">
                        {cancelScheduled ? 'Canceled' : 'Current'}
                      </span>
                    )}
                    {isSelectedPlan && !isCurrentPlan && (
                      <span className="pricing-plan-badge pricing-plan-badge-next">New</span>
                    )}
                  </div>

                  <div className="pricing-plan-top">
                    <h3 className="pricing-plan-name">{formatBillingPlanLabel(plan.id)}</h3>
                    <div className="pricing-plan-price-block">
                      <span className="pricing-plan-price">{plan.priceAmount}</span>
                      <span className="pricing-plan-price-note">{plan.priceSuffix}</span>
                    </div>
                  </div>

                  <p className="pricing-plan-description">{plan.description}</p>

                  <div className="pricing-plan-credit-panel">
                    <span className="pricing-plan-credit-value">{formatCredits(plan.credits)}</span>
                    <span className="pricing-plan-credit-label">credits / month</span>
                  </div>

                  <ul className="pricing-plan-feature-list">
                    {plan.features.map((feature) => (
                      <li key={feature} className="pricing-plan-feature">
                        {feature}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>

          <div className="pricing-dialog-footer pricing-dialog-footer-prices">
            <section className="pricing-cloud-prices" aria-label="Cloud AI prices">
              <div className="pricing-cloud-prices-header">
                <div>
                  <span className="pricing-dialog-selection-label">Cloud AI prices</span>
                  <strong className="pricing-dialog-selection-value">Price list</strong>
                  <span className="pricing-dialog-selection-note">
                    Euro estimates use {formatBillingPlanLabel(CLOUD_PRICE_BASELINE_PLAN.id)}:
                    {' '}
                    {formatEuro(CLOUD_PRICE_BASELINE_PLAN.priceEurMonthly)} / {formatCredits(CLOUD_PRICE_BASELINE_PLAN.credits)} credits
                  </span>
                </div>
                <span className="pricing-cloud-credit-rate">
                  {formatEuro(CLOUD_EUR_PER_CREDIT)} / credit
                </span>
              </div>

              <div className="pricing-cloud-price-list">
                {CLOUD_AI_PRICE_ROWS.map((row) => (
                  <div key={`${row.category}-${row.name}-${row.note}`} className="pricing-cloud-price-entry">
                    <div className="pricing-cloud-price-main">
                      <span className="pricing-cloud-price-category">{row.category}</span>
                      <strong className="pricing-cloud-price-name">{row.name}</strong>
                      <span className="pricing-cloud-price-note">{row.note}</span>
                    </div>
                    <div className="pricing-cloud-price-values">
                      <strong>{formatCredits(row.credits)} cr / {row.unit}</strong>
                      <span>{formatEuro(row.credits * CLOUD_EUR_PER_CREDIT)} / {row.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>

          {error && <div className="auth-dialog-notice auth-dialog-notice-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
