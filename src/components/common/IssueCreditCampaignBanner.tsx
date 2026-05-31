import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { IconExternalLink, IconX } from '@tabler/icons-react';
import './IssueCreditCampaignBanner.css';

const ISSUE_CAMPAIGN_URL = 'https://github.com/Sportinger/MasterSelects/issues/new';
const CONFETTI_VISIBLE_MS = 3600;
const CONFETTI_IDLE_TIMEOUT_MS = 1400;
// Show the banner 10s after the splash screen closes, then auto-dismiss after
// 10s so it isn't intrusive (#195).
const APPEAR_DELAY_MS = 10000;
const AUTO_HIDE_MS = 10000;

interface IssueCreditCampaignBannerProps {
  /** Becomes true once the splash screen is gone; starts the appear delay. */
  armed: boolean;
}

const CONFETTI_COLORS = [
  '#ffcc33',
  '#ff5f6d',
  '#22d3ee',
  '#34d399',
  '#a78bfa',
  '#fb7185',
  '#f97316',
  '#4ade80',
];

const CONFETTI_PIECES = Array.from({ length: 36 }, (_, index) => ({
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  delay: (index % 12) * 0.055,
  drift: ((index * 17) % 96) - 48,
  duration: 1.9 + (index % 9) * 0.11,
  height: 8 + (index % 4) * 4,
  rotate: ((index * 41) % 180) - 90,
  width: 5 + (index % 3) * 2,
  x: 3 + ((index * 29) % 94),
}));

type IdleWindow = typeof window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function IssueCreditCampaignBanner({ armed }: IssueCreditCampaignBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const hasShownRef = useRef(false);

  // Appear once, 10s after the splash is gone.
  useEffect(() => {
    if (!armed || hasShownRef.current) return undefined;
    const timer = window.setTimeout(() => {
      hasShownRef.current = true;
      setIsVisible(true);
    }, APPEAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  // Auto-dismiss 10s after appearing.
  useEffect(() => {
    if (!isVisible) return undefined;
    const timer = window.setTimeout(() => setIsVisible(false), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let rafId: number | null = null;
    let idleId: number | null = null;
    let fallbackTimer: number | null = null;
    let cleanupTimer: number | null = null;
    const idleWindow = window as IdleWindow;

    const startConfetti = () => {
      setShowConfetti(true);
      cleanupTimer = window.setTimeout(() => {
        setShowConfetti(false);
      }, CONFETTI_VISIBLE_MS);
    };

    rafId = window.requestAnimationFrame(() => {
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleId = idleWindow.requestIdleCallback(startConfetti, { timeout: CONFETTI_IDLE_TIMEOUT_MS });
        return;
      }
      fallbackTimer = window.setTimeout(startConfetti, 420);
    });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="issue-credit-campaign" role="region" aria-label="MasterSelects issue credit campaign">
      {showConfetti ? (
        <div className="issue-credit-campaign-confetti" aria-hidden="true">
          {CONFETTI_PIECES.map((piece, index) => (
            <span
              key={`${piece.x}-${piece.drift}-${index}`}
              className="issue-credit-campaign-confetti-piece"
              style={{
                '--issue-confetti-color': piece.color,
                '--issue-confetti-delay': `${piece.delay}s`,
                '--issue-confetti-drift': `${piece.drift}px`,
                '--issue-confetti-duration': `${piece.duration}s`,
                '--issue-confetti-height': `${piece.height}px`,
                '--issue-confetti-rotate': `${piece.rotate}deg`,
                '--issue-confetti-width': `${piece.width}px`,
                '--issue-confetti-x': `${piece.x}%`,
              } as CSSProperties}
            />
          ))}
        </div>
      ) : null}

      <section className="issue-credit-campaign-banner" aria-label="Version 2.0 issue campaign">
        <div className="issue-credit-campaign-version" aria-hidden="true">
          <span>MS</span>
          <strong>2.0</strong>
        </div>

        <div className="issue-credit-campaign-copy">
          <span className="issue-credit-campaign-kicker">Issue Campaign</span>
          <strong>Completed Issue = 1000 AI Credits</strong>
          <p>
            Submit an issue. When we mark it completed, you get 1000 AI credits.
          </p>
        </div>

        <a
          className="issue-credit-campaign-action"
          href={ISSUE_CAMPAIGN_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>Submit issue</span>
          <IconExternalLink size={14} stroke={2.2} aria-hidden="true" />
        </a>

        <button
          type="button"
          className="issue-credit-campaign-close"
          aria-label="Dismiss issue credit campaign"
          onClick={() => setIsVisible(false)}
        >
          <IconX size={15} stroke={2.4} aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
