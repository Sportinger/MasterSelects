import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { syncCreditRuntimeUser } from '../../services/credits/creditBalanceCoordinator';
import { useAccountStore } from '../../stores/accountStore';
import { useCreditActivityStore } from '../../stores/creditActivityStore';
import { creditSettlementDuration, useCreditBurnAnimation } from './useCreditBurnAnimation';
import './CreditBurnMeter.css';

const creditFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

interface OdometerValueProps {
  active: boolean;
  direction: 'down' | 'up';
  fromValue: number;
  value: number;
}

function OdometerValue({ active, direction, fromValue, value }: OdometerValueProps) {
  const nextText = creditFormatter.format(value);
  const previousText = creditFormatter.format(fromValue);
  const width = Math.max(nextText.length, previousText.length);
  const nextCharacters = nextText.padStart(width, '\u00a0').split('');
  const previousCharacters = previousText.padStart(width, '\u00a0').split('');

  return (
    <span className={`credit-odometer is-${direction}`} aria-hidden="true">
      {nextCharacters.map((character, index) => {
        const previous = previousCharacters[index];
        const isDigit = /\p{Number}/u.test(character);
        const previousGlyph = /\p{Number}/u.test(previous) ? previous : '\u00a0';
        const changed = active && isDigit && character !== previous;
        return (
          <span className={`credit-odometer-column${changed ? ' is-changing' : ''}`} key={`${index}:${character}`}>
            <span className="credit-odometer-current">{character}</span>
            {changed && (
              <>
                <span className="credit-odometer-previous">{previousGlyph}</span>
                <span className="credit-odometer-trail">{previousGlyph}</span>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

interface ParticleVector {
  x: number;
  y: number;
}

function boundedVector(origin: DOMRect, target: DOMRect | null): ParticleVector {
  if (!target || target.width <= 0 || target.height <= 0) {
    return { x: -48, y: 112 };
  }
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  const isOffscreen = target.right <= 0
    || target.bottom <= 0
    || target.left >= window.innerWidth
    || target.top >= window.innerHeight;
  const distance = Math.hypot(
    targetCenterX - (origin.left + origin.width * 0.65),
    targetCenterY - (origin.top + origin.height / 2),
  );
  if (isOffscreen || distance > 620) {
    return { x: -48, y: 112 };
  }
  const x = targetCenterX - (origin.left + origin.width * 0.65);
  const y = targetCenterY - (origin.top + origin.height / 2);
  return {
    x: Math.max(-520, Math.min(520, x)),
    y: Math.max(-120, Math.min(160, y)),
  };
}

export function CreditBurnMeter() {
  const {
    creditBalance,
    creditMeterReference,
    openAccountDialog,
    userId,
  } = useAccountStore(useShallow((state) => ({
    creditBalance: state.creditBalance,
    creditMeterReference: state.creditMeterReference,
    openAccountDialog: state.openAccountDialog,
    userId: state.user?.id ?? null,
  })));
  const {
    activities,
    clearTerminalSummary,
    sessionConfirmedCredits,
    terminalSummary,
  } = useCreditActivityStore(useShallow((state) => ({
    activities: state.activities,
    clearTerminalSummary: state.clearTerminalSummary,
    sessionConfirmedCredits: state.sessionConfirmedCredits,
    terminalSummary: state.terminalSummary,
  })));
  const { activeSettlement, announcement } = useCreditBurnAnimation();
  const meterRef = useRef<HTMLButtonElement>(null);
  const [particleVector, setParticleVector] = useState<ParticleVector>({ x: -42, y: 38 });
  const activeCount = Object.keys(activities).length;
  const isActive = activeCount > 0;
  const effectiveReference = Math.max(creditMeterReference, creditBalance, 0);
  const reserveRatio = effectiveReference > 0
    ? Math.max(0, Math.min(1, creditBalance / effectiveReference))
    : 0;
  const level = reserveRatio <= 0.1 ? 'critical' : reserveRatio <= 0.25 ? 'low' : 'normal';
  const terminalVisible = !isActive && terminalSummary !== null;
  const shownSpend = isActive ? sessionConfirmedCredits : terminalSummary?.credits ?? 0;
  const positiveCue = activeSettlement && activeSettlement.kind !== 'debit';
  const statusLabel = isActive
    ? activeCount > 1 ? `${activeCount} ACTIVE` : 'AI ACTIVE'
    : 'CREDITS';
  const runLabel = positiveCue
    ? `+${creditFormatter.format(activeSettlement.credits)} ${activeSettlement.kind === 'refund' ? 'REFUND' : 'CREDITS'}`
    : isActive
      ? `RUN −${creditFormatter.format(shownSpend)}`
      : terminalVisible
        ? `LAST −${creditFormatter.format(shownSpend)}`
        : 'RUN —';
  const formattedBalance = creditFormatter.format(creditBalance);
  const ariaLabel = `${formattedBalance} credits available.${isActive
    ? ` ${creditFormatter.format(shownSpend)} credits used by ${activeCount} active AI ${activeCount === 1 ? 'operation' : 'operations'}.`
    : ''}`;
  const title = `${formattedBalance} credits available · current refill/high-water level ${creditFormatter.format(effectiveReference)}`;

  useEffect(() => {
    syncCreditRuntimeUser(userId);
  }, [userId]);

  useEffect(() => {
    if (!terminalSummary) return undefined;
    const remaining = Math.max(0, terminalSummary.endedAt + 1_500 - Date.now());
    const timer = window.setTimeout(clearTerminalSummary, remaining);
    return () => window.clearTimeout(timer);
  }, [clearTerminalSummary, terminalSummary]);

  useLayoutEffect(() => {
    if (!activeSettlement || !meterRef.current) return;
    const target = activeSettlement.targetId
      ? document.getElementById(activeSettlement.targetId)
      : null;
    setParticleVector(boundedVector(
      meterRef.current.getBoundingClientRect(),
      target?.getBoundingClientRect() ?? null,
    ));
  }, [activeSettlement]);

  const particles = useMemo(() => Array.from({ length: 7 }, (_, index) => index), []);
  const direction = activeSettlement?.kind === 'debit' ? 'down' : 'up';
  const fromBalance = activeSettlement?.fromBalance ?? creditBalance;

  return (
    <>
      <button
        aria-label={ariaLabel}
        className={`credit-burn-meter${isActive ? ' is-active' : ''}${activeSettlement ? ` is-settling is-${activeSettlement.kind}` : ''}`}
        data-credit-level={level}
        onClick={openAccountDialog}
        ref={meterRef}
        style={{
          '--credit-settlement-duration': `${creditSettlementDuration(activeSettlement?.credits ?? 1)}ms`,
        } as CSSProperties}
        title={title}
        type="button"
      >
        <span
          className="credit-burn-status"
          data-short-status={isActive ? (activeCount > 1 ? `${activeCount}×` : 'AI') : 'CR'}
        >
          {statusLabel}
        </span>
        <span className="credit-burn-value">
          <OdometerValue
            active={Boolean(activeSettlement)}
            direction={direction}
            fromValue={fromBalance}
            value={creditBalance}
          />
          <span className="credit-burn-readable">{formattedBalance}</span>
        </span>
        <span className={`credit-burn-run${positiveCue ? ' is-positive' : ''}${!isActive && !terminalVisible && !positiveCue ? ' is-idle' : ''}`}>
          {runLabel}
        </span>
        <span className="credit-burn-track" aria-hidden="true">
          <span className="credit-burn-fill" style={{ transform: `scaleX(${reserveRatio})` }} />
          <span className="credit-burn-edge" />
        </span>
        {activeSettlement && activeSettlement.kind === 'debit' && (
          <span className="credit-drain-layer" aria-hidden="true">
            <span
              className="credit-drain-amount"
              data-credit-amount={`−${creditFormatter.format(activeSettlement.credits)}`}
              style={{
                '--credit-particle-x': `${Math.max(-64, Math.min(64, particleVector.x * 0.14))}px`,
                '--credit-particle-y': `${Math.max(82, Math.min(126, Math.abs(particleVector.y) * 0.2 + 68))}px`,
              } as CSSProperties}
            >
              −{creditFormatter.format(activeSettlement.credits)}
            </span>
            {particles.map((particle) => {
              const spread = (particle - 3) * 7;
              const progress = 0.76 + particle * 0.025;
              return (
                <span
                  className="credit-drain-particle"
                  key={particle}
                  style={{
                    '--credit-particle-delay': `${particle * 34}ms`,
                    '--credit-particle-x': `${particleVector.x * progress + spread}px`,
                    '--credit-particle-y': `${particleVector.y * progress - spread * 0.45}px`,
                  } as CSSProperties}
                />
              );
            })}
          </span>
        )}
      </button>
      <span aria-live="polite" aria-atomic="true" className="credit-burn-live-region">
        {announcement}
      </span>
    </>
  );
}
