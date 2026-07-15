import { useEffect, useRef, useState } from 'react';
import {
  IconArrowRight,
  IconCheck,
  IconClock,
  IconCopy,
  IconGift,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { cloudApi, type WebsiteFreeCreditOfferResponse } from '../../services/cloudApi';
import './FreeOfferNotice.css';

interface FreeOfferNoticeProps {
  authenticated: boolean;
  disabled?: boolean;
  preview: boolean;
  ready: boolean;
  onOpenAccount: (redeemCode: string) => void;
  onOpenAuth: (redeemCode: string) => void;
}

export function FreeOfferNotice({
  authenticated,
  disabled = false,
  preview,
  ready,
  onOpenAccount,
  onOpenAuth,
}: FreeOfferNoticeProps) {
  const requested = useRef(false);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [offer, setOffer] = useState<NonNullable<WebsiteFreeCreditOfferResponse['offer']> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(false);
  const expiresAt = offer?.expiresAt ? Date.parse(offer.expiresAt) : Number.NaN;
  const secondsRemaining = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - now) / 1_000)) : 0;
  const canShow = Boolean(offer && secondsRemaining > 0);

  useEffect(() => {
    if (!ready || disabled || dismissed || requested.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      requested.current = true;
      if (preview) {
        setOffer({ amount: 3_000, expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(), redeemCode: '123456' });
        setVisible(true);
        return;
      }

      void cloudApi.credits.claimWebsiteOffer()
        .then((response) => {
          if (response.offer) {
            setOffer(response.offer);
            setVisible(true);
          }
        })
        .catch(() => undefined);
    }, 10_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [disabled, dismissed, preview, ready]);

  useEffect(() => {
    if (!visible || !Number.isFinite(expiresAt)) {
      return;
    }

    const tick = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= expiresAt) {
        setVisible(false);
      }
    };
    const timer = window.setInterval(tick, 1_000);
    tick();
    return () => window.clearInterval(timer);
  }, [expiresAt, visible]);

  if (!ready || disabled || !canShow || !visible || dismissed || !offer) {
    return null;
  }

  const countdown = `${String(Math.floor(secondsRemaining / 60)).padStart(2, '0')}:${String(secondsRemaining % 60).padStart(2, '0')}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(offer.redeemCode);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = offer.redeemCode;
      textarea.style.opacity = '0';
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <aside className="free-offer-notice" aria-label="Free credit gift" role="dialog">
      <div className="free-offer-notice-shine" aria-hidden="true" />
      <button
        aria-label="Dismiss gift"
        className="free-offer-notice-close"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <IconX aria-hidden="true" size={17} />
      </button>
      <div className="free-offer-notice-gift" aria-hidden="true">
        <IconGift size={31} stroke={1.8} />
      </div>
      <div className="free-offer-notice-body">
        <div className="free-offer-notice-eyebrow">
          <span className="free-offer-notice-kicker">
            <IconSparkles aria-hidden="true" size={13} />
            FREE FOR YOU
          </span>
          <span className="free-offer-notice-timer">
            <IconClock aria-hidden="true" size={13} />
            <span>OFFER EXPIRES IN</span>
            <strong>{countdown}</strong>
          </span>
        </div>
        <div className="free-offer-notice-credits">
          <strong>{offer.amount.toLocaleString()}</strong>
          <span>CREDITS</span>
        </div>
        <div className="free-offer-notice-code-shell">
          <span>GIFT CODE</span>
          <code>{offer.redeemCode}</code>
          <button className="free-offer-notice-copy-button" onClick={() => void handleCopy()} type="button">
            {copied ? <IconCheck aria-hidden="true" size={14} /> : <IconCopy aria-hidden="true" size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {!authenticated && <p>Create an account or sign in to claim your gift.</p>}
      </div>
      <button
        className="free-offer-notice-action"
        onClick={() => (authenticated ? onOpenAccount : onOpenAuth)(offer.redeemCode)}
        type="button"
      >
        <span>{authenticated ? 'Claim gift' : 'Unlock gift'}</span>
        <IconArrowRight aria-hidden="true" size={18} />
      </button>
    </aside>
  );
}
