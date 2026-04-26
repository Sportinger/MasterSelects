import { useCallback, useEffect, useState } from 'react';
import { useAccountStore } from '../../stores/accountStore';
import type { BillingPlanId } from '../../services/cloudApi';
import './authBillingDialogs.css';

const DEV_PLANS: { id: BillingPlanId; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'starter', label: 'Starter' },
  { id: 'pro', label: 'Pro' },
  { id: 'studio', label: 'Studio' },
];

function isLocalDev(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, port } = window.location;
  return (hostname === 'localhost' || hostname === '127.0.0.1') && port === '5173';
}

interface AuthDialogProps {
  onClose: () => void;
}

export function AuthDialog({ onClose }: AuthDialogProps) {
  const [email, setEmail] = useState('');
  const [provider, setProvider] = useState<'magic_link' | 'google'>('magic_link');
  const [isClosing, setIsClosing] = useState(false);
  const { devLogin, error, isLoading, login, notice } = useAccountStore();

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [isClosing, onClose]);

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await login({ email, provider });
  };

  return (
    <div className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleBackdropClick}>
      <div className="welcome-overlay auth-dialog">
        {/* Header — same layout as changelog */}
        <div className="auth-dialog-header">
          <div className="auth-dialog-header-left">
            <div className="changelog-heading">
              <span className="changelog-brand" aria-label="MasterSelects">
                <span className="changelog-brand-master">Master</span>
                <span className="changelog-brand-selects">Selects</span>
              </span>
              <h2 className="changelog-header-title">Cloud</h2>
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
            <h3 className="auth-dialog-subtitle">Sign in</h3>
            <p className="auth-dialog-description">
              Access hosted AI features through MasterSelects Cloud.<br />
              Local editing stays unchanged.
            </p>
          </div>

          <form className="auth-dialog-form" onSubmit={handleSubmit}>
            <label className="auth-dialog-field">
              <span className="auth-dialog-label">Email {provider === 'google' ? '(optional)' : ''}</span>
              <input
                autoComplete="email"
                autoFocus
                className="auth-dialog-input"
                placeholder="you@example.com"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <div className="auth-dialog-field">
              <span className="auth-dialog-label">Provider</span>
              <div className="auth-dialog-provider-row">
                <button
                  className={`auth-dialog-provider ${provider === 'magic_link' ? 'active' : ''}`}
                  onClick={() => setProvider('magic_link')}
                  type="button"
                >
                  Email link
                </button>
                <button
                  className={`auth-dialog-provider ${provider === 'google' ? 'active' : ''}`}
                  onClick={() => setProvider('google')}
                  type="button"
                >
                  Google
                </button>
              </div>
            </div>

            <button
              className="auth-dialog-submit"
              disabled={isLoading || (provider === 'magic_link' && !email.trim())}
              type="submit"
            >
              {isLoading ? 'Signing in...' : provider === 'google' ? 'Continue with Google' : 'Send magic link'}
            </button>
          </form>

          {notice && <div className="auth-dialog-notice auth-dialog-notice-success">{notice}</div>}
          {error && <div className="auth-dialog-notice auth-dialog-notice-error">{error}</div>}

          {isLocalDev() && (
            <div className="auth-dialog-dev-section">
              <span className="auth-dialog-label">Dev Quick Login</span>
              <div className="auth-dialog-dev-plans">
                {DEV_PLANS.map((plan) => (
                  <button
                    key={plan.id}
                    className="auth-dialog-dev-plan-btn"
                    disabled={isLoading}
                    type="button"
                    onClick={() => devLogin(plan.id)}
                  >
                    {plan.label}
                  </button>
                ))}
              </div>
              <span className="auth-dialog-dev-hint">
                Localhost only — creates a dev session with the selected plan.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
