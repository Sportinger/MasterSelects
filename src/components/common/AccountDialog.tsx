import { useCallback, useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import './authBillingDialogs.css';

interface AccountDialogProps {
  onClose: () => void;
}

export function AccountDialog({ onClose }: AccountDialogProps) {
  const { billingSummary, error, isLoading, logout, openBillingPortal, openPricingDialog } = useAccountStore();
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

  const summary = billingSummary;
  const displayName = summary?.user?.displayName || summary?.user?.email || 'Guest';

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
              <h2 className="changelog-header-title">Account</h2>
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
            <h3 className="auth-dialog-subtitle">{displayName}</h3>
          </div>

          <div className="account-metrics-grid">
            <div className="account-metric-card">
              <span className="account-metric-label">Plan</span>
              <strong className="account-metric-value">{summary?.plan.label || 'Free'}</strong>
            </div>
            <div className="account-metric-card">
              <span className="account-metric-label">Credits</span>
              <strong className="account-metric-value">{summary?.creditBalance ?? 0}</strong>
            </div>
            <div className="account-metric-card">
              <span className="account-metric-label">Hosted AI</span>
              <strong className="account-metric-value">{summary?.hostedAIEnabled ? 'Enabled' : 'Disabled'}</strong>
            </div>
          </div>

          <div className="account-usage-card">
            <div className="account-metric-label">Recent usage</div>
            <div className="account-usage-list">
              {(summary?.usage.byFeature ?? []).slice(0, 5).map((entry) => (
                <div key={entry.feature} className="account-usage-entry">
                  <span>{entry.feature}</span>
                  <span className="account-usage-detail">{entry.completedCount} complete, {entry.creditCost} credits</span>
                </div>
              ))}
              {!summary?.usage.byFeature?.length && (
                <div className="account-usage-empty">No usage yet.</div>
              )}
            </div>
          </div>

          <div className="account-actions-row">
            <button className="auth-dialog-submit" disabled={isLoading} onClick={() => openBillingPortal()} type="button">
              Manage billing
            </button>
            <button className="auth-dialog-action-secondary" disabled={isLoading} onClick={() => openPricingDialog()} type="button">
              Upgrade plan
            </button>
            <button className="auth-dialog-action-ghost" disabled={isLoading} onClick={() => logout()} type="button">
              Sign out
            </button>
          </div>

          {error && <div className="auth-dialog-notice auth-dialog-notice-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
