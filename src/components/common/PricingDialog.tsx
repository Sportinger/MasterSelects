import { useCallback, useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import './authBillingDialogs.css';

interface PricingDialogProps {
  onClose: () => void;
}

const plans = [
  { id: 'free', credits: 25, description: 'Hosted AI text chat trial', featured: false, price: '0 EUR' },
  { id: 'starter', credits: 4500, description: 'Hosted AI text chat for light usage', featured: false, price: '4,90 EUR/mo' },
  { id: 'pro', credits: 13500, description: 'More text credits plus priority queue', featured: true, price: '14,90 EUR/mo' },
  { id: 'studio', credits: 27000, description: 'Highest text volume with priority access', featured: false, price: '29,90 EUR/mo' },
] as const;

export function PricingDialog({ onClose }: PricingDialogProps) {
  const { error, isLoading, startCheckout } = useAccountStore();
  const [isClosing, setIsClosing] = useState(false);

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

  return (
    <div className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleBackdropClick}>
      <div className="welcome-overlay auth-dialog auth-dialog-wide">
        {/* Header */}
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

        {/* Content */}
        <div className="auth-dialog-content">
          <div className="auth-dialog-intro">
            <h3 className="auth-dialog-subtitle">Choose a plan</h3>
            <p className="auth-dialog-description">
              Current launch phase includes hosted AI text chat only.
              <br />
              Video generation is not part of these plans yet.
            </p>
          </div>

          <div className="pricing-plans-grid">
            {plans.map((plan) => (
              <article key={plan.id} className={`pricing-plan-card ${plan.featured ? 'pricing-plan-featured' : ''}`}>
                <div className="pricing-plan-top">
                  <h3 className="pricing-plan-name">{plan.id.charAt(0).toUpperCase() + plan.id.slice(1)}</h3>
                  <span className="pricing-plan-price">{plan.price}</span>
                </div>
                <div className="pricing-plan-credits">
                  <span className="pricing-plan-description">{plan.description}</span>
                  {' · '}
                  {plan.credits} credits/mo
                </div>
                <button
                  className={`pricing-plan-cta ${plan.id === 'free' ? 'pricing-plan-cta-muted' : ''}`}
                  disabled={isLoading || plan.id === 'free'}
                  onClick={() => startCheckout(plan.id)}
                  type="button"
                >
                  {plan.id === 'free' ? 'Current plan' : `Select ${plan.id}`}
                </button>
              </article>
            ))}
          </div>

          {error && <div className="auth-dialog-notice auth-dialog-notice-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
