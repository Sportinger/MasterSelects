import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { IconArrowRight, IconLock, IconMail } from '@tabler/icons-react';
import { cloudApi, type CreditClaimRedeemResponse, type CreditClaimStatusResponse } from '../services/cloudApi';
import './CreditClaimPage.css';

type LoadState = 'error' | 'loading' | 'ready';

function getClaimCode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('code')?.trim() || params.get('token')?.trim() || '';
}

function getRedeemCode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('redeem')?.trim() || '';
}

function formatDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getStatusLabel(status: CreditClaimStatusResponse['claim']['status']): string {
  switch (status) {
    case 'available':
      return 'Ready to claim';
    case 'claimed':
      return 'Already claimed';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
    case 'invalid':
      return 'Unavailable';
    default:
      return 'Unavailable';
  }
}

export function CreditClaimPage() {
  const code = useMemo(getClaimCode, []);
  const redeemCode = useMemo(getRedeemCode, []);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [status, setStatus] = useState<CreditClaimStatusResponse | null>(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [redeemed, setRedeemed] = useState<CreditClaimRedeemResponse | null>(null);
  const [claimedEmail, setClaimedEmail] = useState('');

  const loadClaim = useCallback(async () => {
    if (!code) {
      setError('This credit claim link is missing its code.');
      setLoadState('error');
      return;
    }

    setLoadState('loading');
    setError(null);

    try {
      const nextStatus = await cloudApi.credits.claimStatus(code);
      setStatus(nextStatus);
      if (nextStatus.session.email) {
        setEmail(nextStatus.session.email);
      }
      setLoadState('ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This credit claim could not be loaded.');
      setLoadState('error');
    }
  }, [code]);

  useEffect(() => {
    void loadClaim();
  }, [loadClaim]);

  const claim = status?.claim ?? null;
  const authenticated = Boolean(status?.session.authenticated);
  const expiresLabel = formatDate(claim?.expiresAt ?? null);
  const claimedLabel = formatDate(claim?.claimedAt ?? null);
  const canSubmit = Boolean(
    !redeemed
    && claim
    && claim.status === 'available'
    && email.trim()
    && !submitting
    && (!claim.freeOffer || redeemCode),
  );
  const buttonLabel = claim?.freeOffer
    ? authenticated ? 'Open account to redeem' : 'Sign in to redeem'
    : 'Claim Credits';
  const headline = claim ? claim.freeOffer ? 'FREE FOR YOU' : `Claim ${claim.amount.toLocaleString()} Credits` : 'Credit Claim';
  const claimedRecipient = claimedEmail || status?.session.email || email.trim();

  const handleBackgroundClick = useCallback(() => {
    if (redeemed) {
      window.location.assign('/');
    }
  }, [redeemed]);

  const stopPanelClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!claim || !canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (claim.freeOffer) {
        if (!redeemCode) {
          setError('This gift link is missing its redeem code.');
          return;
        }

        const redirectTo = `/?redeem=${encodeURIComponent(redeemCode)}`;
        if (authenticated) {
          window.location.assign(redirectTo);
          return;
        }

        const login = await cloudApi.auth.login({
          email: email.trim(),
          provider: 'magic_link',
          redirectTo,
        });

        if (login.authorizationUrl) {
          window.location.href = login.authorizationUrl;
          return;
        }

        if (login.verificationUrl && login.delivery === 'debug_link') {
          window.location.assign(login.verificationUrl);
          return;
        }

        setMessage(login.message ?? 'Check your email to finish signing in, then redeem your gift in Account.');
        return;
      }

      if (!authenticated) {
        const login = await cloudApi.auth.login({
          email: email.trim(),
          provider: 'magic_link',
          redirectTo: `${window.location.pathname}${window.location.search}`,
        });

        if (login.authorizationUrl) {
          window.location.href = login.authorizationUrl;
          return;
        }

        if (login.verificationUrl) {
          if (login.delivery === 'debug_link') {
            window.location.assign(login.verificationUrl);
            return;
          }

          setMessage(login.message ?? 'Check your email to verify this credit claim.');
          return;
        }

        setMessage(login.message ?? 'Check your email to verify this credit claim.');
        return;
      }

      const result = await cloudApi.credits.redeemClaim({
        code,
        email: email.trim(),
      });

      setRedeemed(result);
      setClaimedEmail(status?.session.email ?? email.trim());
      setMessage(result.message ?? `${result.amount} credits have been added.`);
      await loadClaim();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The claim could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      className={`credit-claim-page${redeemed ? ' credit-claim-page-claimed' : ''}`}
      onClick={handleBackgroundClick}
    >
      <div className="credit-claim-live-background" aria-hidden="true">
        <iframe
          className="credit-claim-live-frame"
          src="/?entry=editor&claimBackground=1"
          tabIndex={-1}
          title=""
        />
      </div>
      <div className="credit-claim-background-scrim" aria-hidden="true" />
      <section className="credit-claim-shell" aria-labelledby="credit-claim-title">
        <div className="credit-claim-assets" aria-hidden="true">
          <img className="credit-claim-burst credit-claim-burst-left" src="/credit-claims/coin-burst-left.png" alt="" />
          <img className="credit-claim-burst credit-claim-burst-right" src="/credit-claims/coin-burst-right.png" alt="" />
          <img className="credit-claim-ribbon credit-claim-ribbon-left" src="/credit-claims/gold-ribbon.png" alt="" />
          <img className="credit-claim-ribbon credit-claim-ribbon-right" src="/credit-claims/gold-ribbon.png" alt="" />
          <img className="credit-claim-float-coin credit-claim-float-coin-silver" src="/credit-claims/ms-coin-silver.png" alt="" />
        </div>

        {loadState === 'loading' ? (
          <div className="credit-claim-panel" onClick={stopPanelClick}>
            <p className="credit-claim-muted">Loading credit claim...</p>
          </div>
        ) : loadState === 'error' ? (
          <div className="credit-claim-panel" onClick={stopPanelClick}>
            <img className="credit-claim-panel-coin" src="/credit-claims/ms-coin-gold.png" alt="" aria-hidden="true" />
            <h1 id="credit-claim-title">Credit Claim</h1>
            <p className="credit-claim-error">{error}</p>
          </div>
        ) : claim ? (
          <div
            className={`credit-claim-panel${redeemed ? ' credit-claim-panel-claimed' : ''}`}
            onClick={stopPanelClick}
          >
            <img className="credit-claim-panel-coin" src="/credit-claims/ms-coin-gold.png" alt="" aria-hidden="true" />
            {redeemed ? (
              <div className="credit-claim-claimed">
                <span className="credit-claim-status credit-claim-status-available">Claim complete</span>
                <h1 id="credit-claim-title">{redeemed.amount.toLocaleString()} Credits Claimed</h1>
                {claimedRecipient && <p className="credit-claim-claimed-email">to {claimedRecipient}</p>}
                <div className="credit-claim-amount">
                  <strong>{redeemed.creditBalance.toLocaleString()}</strong>
                  <span>current balance</span>
                </div>
              </div>
            ) : (
              <>
                <div className="credit-claim-heading">
                  <div>
                    <span className={`credit-claim-status credit-claim-status-${claim.status}`}>
                      {claim.freeOffer ? 'Personal gift' : getStatusLabel(claim.status)}
                    </span>
                    <h1 id="credit-claim-title">{headline}</h1>
                  </div>
                </div>

                <div className="credit-claim-amount">
                  <strong>{claim.amount.toLocaleString()}</strong>
                  <span>credits</span>
                </div>

                {claim.freeOffer && (
                  <>
                    <p className="credit-claim-free-expiry">ONE HOUR</p>
                    <div className="credit-claim-gift-code">
                      <span>Your six-digit gift code</span>
                      <strong>{redeemCode}</strong>
                    </div>
                  </>
                )}

                {claim.description && <p className="credit-claim-description">{claim.description}</p>}

                <div className="credit-claim-meta">
                  <span>
                    <IconLock size={15} stroke={1.8} />
                    {claim.emailLocked ? 'Locked to recipient email' : 'First verified claimant'}
                  </span>
                  {expiresLabel && <span>Expires {expiresLabel}</span>}
                  {claimedLabel && <span>Claimed {claimedLabel}</span>}
                </div>

                <form className="credit-claim-form" onSubmit={handleSubmit}>
                  <label htmlFor="claim-email">Email</label>
                  <div className="credit-claim-email-row">
                    <IconMail size={18} stroke={1.8} aria-hidden="true" />
                    <input
                      autoComplete="email"
                      disabled={submitting || claim.status !== 'available'}
                      id="claim-email"
                      inputMode="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      type="email"
                      value={email}
                    />
                  </div>

                  <button className="credit-claim-button" disabled={!canSubmit} type="submit">
                    <IconArrowRight size={18} stroke={1.9} />
                    <span>{submitting ? 'Working...' : buttonLabel}</span>
                  </button>
                </form>

                {message && <p className="credit-claim-success">{message}</p>}
                {error && <p className="credit-claim-error">{error}</p>}
              </>
            )}
          </div>
        ) : null}
        <img
          className="credit-claim-foreground-ribbon"
          src="/credit-claims/gold-ribbon.png"
          alt=""
          aria-hidden="true"
        />
      </section>
    </main>
  );
}
