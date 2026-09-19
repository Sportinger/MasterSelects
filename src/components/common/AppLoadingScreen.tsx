import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import './AppLoadingScreen.css';

interface AppLoadingScreenProps {
  label?: string;
  overlay?: boolean;
}

type LoadingClipId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

const CLIP_IDS: LoadingClipId[] = ['a', 'b', 'c', 'd', 'e', 'f'];
const CLIP_SLOTS = [
  { left: 0, top: '0.58rem' },
  { left: 34, top: '0.58rem' },
  { left: 68, top: '0.58rem' },
  { left: 0, top: '1.55rem' },
  { left: 34, top: '1.55rem' },
  { left: 68, top: '1.55rem' },
] as const;
const INITIAL_CLIP_SLOTS: Record<LoadingClipId, number> = {
  a: 0,
  b: 1,
  c: 2,
  d: 3,
  e: 4,
  f: 5,
};
const INITIAL_CLIP_WIDTHS: Record<LoadingClipId, number> = {
  a: 20,
  b: 27,
  c: 31,
  d: 24,
  e: 16,
  f: 29,
};

function pickSwapPair(previousPair: string | null): [LoadingClipId, LoadingClipId] {
  let pair: [LoadingClipId, LoadingClipId] = ['a', 'b'];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const firstIndex = Math.floor(Math.random() * CLIP_IDS.length);
    let secondIndex = Math.floor(Math.random() * (CLIP_IDS.length - 1));
    if (secondIndex >= firstIndex) secondIndex += 1;
    pair = [CLIP_IDS[firstIndex], CLIP_IDS[secondIndex]];
    const pairKey = [...pair].sort().join(':');
    if (pairKey !== previousPair) break;
  }

  return pair;
}

export function AppLoadingScreen({
  label = 'Opening MasterSelects',
  overlay = false,
}: AppLoadingScreenProps) {
  const [clipSlots, setClipSlots] = useState(INITIAL_CLIP_SLOTS);
  const [clipWidths, setClipWidths] = useState(INITIAL_CLIP_WIDTHS);
  const [movingClipIds, setMovingClipIds] = useState<LoadingClipId[]>([]);
  const [trimmingClipId, setTrimmingClipId] = useState<LoadingClipId | null>(null);
  const previousPairRef = useRef<string | null>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let actionTimer: number | null = null;
    let settleTimer: number | null = null;

    const scheduleAction = (delay: number) => {
      actionTimer = window.setTimeout(() => {
        const pair = pickSwapPair(previousPairRef.current);
        previousPairRef.current = [...pair].sort().join(':');
        setMovingClipIds(pair);
        setClipSlots((currentSlots) => ({
          ...currentSlots,
          [pair[0]]: currentSlots[pair[1]],
          [pair[1]]: currentSlots[pair[0]],
        }));

        if (Math.random() < 0.55) {
          const trimTarget = pair[Math.random() < 0.5 ? 0 : 1];
          setTrimmingClipId(trimTarget);
          setClipWidths((currentWidths) => {
            const currentWidth = currentWidths[trimTarget];
            const trimAmount = 4 + Math.random() * 5;
            const wantsShorter = Math.random() < 0.5;
            let nextWidth = currentWidth + (wantsShorter ? -trimAmount : trimAmount);
            if (nextWidth < 14 || nextWidth > 31) {
              nextWidth = currentWidth + (wantsShorter ? trimAmount : -trimAmount);
            }

            return {
              ...currentWidths,
              [trimTarget]: Math.max(14, Math.min(31, nextWidth)),
            };
          });
        }

        settleTimer = window.setTimeout(() => {
          setMovingClipIds([]);
          setTrimmingClipId(null);
          scheduleAction(220);
        }, 280);
      }, delay);
    };

    scheduleAction(320);

    return () => {
      if (actionTimer !== null) window.clearTimeout(actionTimer);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, []);

  return (
    <section
      className={`app-loading-screen ${overlay ? 'is-overlay' : ''}`.trim()}
      role="status"
      aria-label={label}
    >
      <div className="app-loading-lockup">
        <div className="app-loading-brand" aria-hidden="true">
          <span className="app-loading-mark">
            <i />
            <i />
            <i />
          </span>
          <span className="app-loading-wordmark">MasterSelects</span>
        </div>

        <div className="app-loading-meta">
          <span>{label}</span>
          <span className="app-loading-state" aria-hidden="true">Loading</span>
        </div>

        <div
          className="app-loading-progress"
          role="progressbar"
          aria-label={`${label} progress`}
        >
          {CLIP_IDS.map((clipId) => {
            const slotIndex = clipSlots[clipId];
            const slot = CLIP_SLOTS[slotIndex];
            const clipStyle = {
              '--app-loading-clip-left': `${slot.left}%`,
              '--app-loading-clip-top': slot.top,
              '--app-loading-clip-width': `${clipWidths[clipId]}%`,
            } as CSSProperties;
            const clipClassName = [
              'app-loading-clip',
              `app-loading-clip--${clipId}`,
              movingClipIds.includes(clipId) ? 'is-moving' : '',
              trimmingClipId === clipId ? 'is-trimming' : '',
            ].filter(Boolean).join(' ');

            return (
              <span
                key={clipId}
                aria-hidden="true"
                className={clipClassName}
                data-clip-id={clipId}
                data-slot={slotIndex}
                style={clipStyle}
              />
            );
          })}
          <span className="app-loading-playhead" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
