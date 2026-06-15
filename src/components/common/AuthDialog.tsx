import { useCallback, useEffect, useState } from 'react';
import { IconArrowRight, IconMail, IconSparkles, IconX } from '@tabler/icons-react';
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

function GoogleLogo() {
  return (
    <svg className="auth-dialog-google-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.52z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.9a6 6 0 0 1 0-3.8V7.51H3.06a10 10 0 0 0 0 8.98l3.35-2.59z"
      />
      <path
        fill="#EA4335"
        d="M12 5.98c1.47 0 2.8.5 3.84 1.5l2.85-2.85A9.57 9.57 0 0 0 12 2a10 10 0 0 0-8.94 5.51l3.35 2.59C7.2 7.74 9.4 5.98 12 5.98z"
      />
    </svg>
  );
}

export function AuthDialog({ onClose }: AuthDialogProps) {
  const [email, setEmail] = useState('');
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
    await login({ email, provider: 'magic_link' });
  };

  const handleGoogleSignIn = async () => {
    await login({ email, provider: 'google' });
  };

  return (
    <div className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`} onClick={handleBackdropClick}>
      <div className="welcome-overlay auth-dialog auth-dialog-signin">
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
            <button
              aria-label="Close"
              className="changelog-header-button auth-dialog-close-button"
              onClick={handleClose}
              title="Close"
              type="button"
            >
              <IconX size={16} stroke={2.1} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="auth-dialog-content">
          <div className="auth-dialog-intro">
            <span className="auth-dialog-kicker">
              <IconSparkles size={14} stroke={2} aria-hidden="true" />
              Cloud access
            </span>
            <h3 className="auth-dialog-subtitle">Sign in or create account</h3>
            <p className="auth-dialog-description">
              Passwordless access for AI generation capabilities. Everything else is FREE. New here? We create your account automatically.
            </p>
          </div>

          <form className="auth-dialog-form" onSubmit={handleSubmit}>
            <div className="auth-dialog-email-line">
              <label className="auth-dialog-field">
                <span className="auth-dialog-label">Email</span>
                <span className="auth-dialog-input-shell">
                  <IconMail size={18} stroke={1.9} aria-hidden="true" />
                  <input
                    autoComplete="email"
                    autoFocus
                    className="auth-dialog-input"
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </span>
              </label>

              <button
                className="auth-dialog-submit"
                disabled={isLoading || !email.trim()}
                type="submit"
              >
                <span>{isLoading ? 'Sending...' : 'Send link'}</span>
                {!isLoading && <IconArrowRight size={18} stroke={2.1} aria-hidden="true" />}
              </button>
            </div>
          </form>

          <button
            className="auth-dialog-google-button"
            disabled={isLoading}
            onClick={handleGoogleSignIn}
            type="button"
          >
            <GoogleLogo />
            <span>{isLoading ? 'Opening Google...' : 'Continue with Google'}</span>
          </button>

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
