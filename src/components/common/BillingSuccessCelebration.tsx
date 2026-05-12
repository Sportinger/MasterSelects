import { useEffect, type CSSProperties } from 'react';
import './authBillingDialogs.css';

interface BillingSuccessCelebrationProps {
  creditBalance: number;
  onClose: () => void;
  planId?: string | null;
}

const CONFETTI_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171'];

const CONFETTI_PIECES = Array.from({ length: 44 }, (_, index) => ({
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  delay: (index % 11) * 0.08,
  duration: 2.5 + (index % 7) * 0.18,
  rotate: ((index * 47) % 180) - 90,
  x: 4 + ((index * 23) % 92),
}));

function formatCredits(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPlan(planId: string | null | undefined): string | null {
  if (!planId) return null;
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

export function BillingSuccessCelebration({ creditBalance, onClose, planId }: BillingSuccessCelebrationProps) {
  const planLabel = formatPlan(planId);

  useEffect(() => {
    const timeout = window.setTimeout(onClose, 9000);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="billing-success-celebration" role="status" aria-live="polite">
      <div className="billing-success-confetti" aria-hidden="true">
        {CONFETTI_PIECES.map((piece, index) => (
          <span
            key={`${piece.x}-${index}`}
            className="billing-success-confetti-piece"
            style={{
              '--billing-confetti-color': piece.color,
              '--billing-confetti-delay': `${piece.delay}s`,
              '--billing-confetti-duration': `${piece.duration}s`,
              '--billing-confetti-rotate': `${piece.rotate}deg`,
              '--billing-confetti-x': `${piece.x}%`,
            } as CSSProperties}
          />
        ))}
      </div>

      <section className="billing-success-card" aria-label="Billing success">
        <button
          type="button"
          className="billing-success-close"
          aria-label="Close billing success message"
          onClick={onClose}
        >
          x
        </button>
        <div className="billing-success-icon" aria-hidden="true">AI</div>
        <div className="billing-success-copy">
          <span className="billing-success-kicker">Payment confirmed</span>
          <h2>Danke sch&ouml;n!</h2>
          <p>
            Your AI credits are ready. Thanks for supporting MasterSelects.
          </p>
        </div>
        <div className="billing-success-balance">
          <span>Available credits</span>
          <strong>{formatCredits(creditBalance)}</strong>
        </div>
        {planLabel && (
          <div className="billing-success-plan">
            {planLabel} plan activated
          </div>
        )}
        <button type="button" className="auth-dialog-submit billing-success-action" onClick={onClose}>
          Continue
        </button>
      </section>
    </div>
  );
}
