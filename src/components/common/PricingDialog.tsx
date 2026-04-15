import { useCallback, useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import './authBillingDialogs.css';

interface PricingDialogProps {
  onClose: () => void;
}

const plans = [
  {
    id: 'free',
    badge: 'Entry',
    credits: 25,
    description: 'A lightweight way to try the hosted workflow before subscribing.',
    featured: false,
    features: [
      '25 credits every month',
      'Good for chat and small image runs',
      'No payment setup required',
    ],
    priceAmount: '0',
    priceSuffix: 'EUR',
  },
  {
    id: 'starter',
    badge: 'Creator',
    credits: 4500,
    description: 'A practical monthly plan for image runs and short video work.',
    featured: false,
    features: [
      '4.5K monthly credits',
      'Built for images and short hosted videos',
      'A strong default for regular use',
    ],
    priceAmount: '4,90',
    priceSuffix: 'EUR / mo',
  },
  {
    id: 'pro',
    badge: 'Popular',
    credits: 13500,
    description: 'More headroom plus priority treatment when the hosted queue is busy.',
    featured: true,
    features: [
      '13.5K monthly credits',
      'Priority queue access',
      'Best fit for frequent generation sessions',
    ],
    priceAmount: '14,90',
    priceSuffix: 'EUR / mo',
  },
  {
    id: 'studio',
    badge: 'Production',
    credits: 27000,
    description: 'The largest monthly pool for teams or heavy production usage.',
    featured: false,
    features: [
      '27K monthly credits',
      'Highest credit volume',
      'Best for sustained production workloads',
    ],
    priceAmount: '29,90',
    priceSuffix: 'EUR / mo',
  },
] as const;

function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPlanLabel(planId: string): string {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
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

export function PricingDialog({ onClose }: PricingDialogProps) {
  const { billingSummary, error, isLoading, startCheckout } = useAccountStore();
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
  const currentPeriodEndLabel = formatBillingDate(billingSummary?.subscription?.currentPeriodEnd);
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
  const canSubmitSelection = !(isLoading || selectedPlanIsCurrent);
  const selectionNote = selectedPlanIsCurrent
    ? cancelScheduled && currentPeriodEndLabel
      ? `This subscription is set to end on ${currentPeriodEndLabel}.`
      : 'You are viewing your active subscription.'
    : isDowngradeSelection
      ? 'Stripe will confirm the downgrade and keep your current plan active until the billing period ends.'
      : isUpgradeSelection
        ? 'Stripe will confirm the upgrade and charge the prorated difference immediately.'
      : hasManagedSubscription
        ? 'Stripe billing management opens so you can change this subscription.'
        : 'You will continue to checkout for this plan.';
  const submitLabel = selectedPlanIsCurrent
    ? cancelScheduled
      ? 'Canceled plan'
      : 'Current plan'
    : isDowngradeSelection && selectedPlan.id === 'free'
      ? 'Downgrade to Free'
    : isDowngradeSelection
      ? `Downgrade to ${formatPlanLabel(selectedPlan.id)}`
      : isUpgradeSelection
        ? `Upgrade to ${formatPlanLabel(selectedPlan.id)}`
        : hasManagedSubscription
          ? `Change to ${formatPlanLabel(selectedPlan.id)}`
          : `Continue with ${formatPlanLabel(selectedPlan.id)}`;

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
          <div className="pricing-dialog-intro">
            <div className="auth-dialog-intro">
              <h3 className="auth-dialog-subtitle">Choose a plan</h3>
              <p className="auth-dialog-description">
                Hosted AI credits cover chat, image generation, and video generation.
                <br />
                Video spends more credits than chat or images.
              </p>
            </div>
            <div className="pricing-dialog-current-plan">
              <span className="pricing-dialog-current-label">Current subscription</span>
              <strong className="pricing-dialog-current-value">
                {billingSummary?.plan.label ?? 'Free'}
              </strong>
              {cancelScheduled && currentPeriodEndLabel && (
                <span className="pricing-dialog-current-note">Canceled · ends on {currentPeriodEndLabel}</span>
              )}
            </div>
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
                    <h3 className="pricing-plan-name">{formatPlanLabel(plan.id)}</h3>
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

          <div className="pricing-dialog-footer">
            <div className="pricing-dialog-selection">
              <span className="pricing-dialog-selection-label">Selected plan</span>
              <strong className="pricing-dialog-selection-value">{formatPlanLabel(selectedPlan.id)}</strong>
              <span className="pricing-dialog-selection-note">
                {selectionNote}
              </span>
            </div>
            <button
              className="auth-dialog-submit pricing-dialog-submit"
              disabled={!canSubmitSelection}
              onClick={handleContinue}
              type="button"
            >
              {submitLabel}
            </button>
          </div>

          {error && <div className="auth-dialog-notice auth-dialog-notice-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
