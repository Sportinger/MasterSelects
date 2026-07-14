import { useCallback, useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Lifetime safety net slightly above the 620ms turn keyframes; jsdom never fires animationend. */
export const TURN_SHEET_LIFETIME_MS = 760;

/** Matches the fb-book-open-* keyframe durations plus a small buffer. */
export const BOOK_OPENING_MS = 780;

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = () => setReducedMotion(media.matches);
    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return reducedMotion;
}

/**
 * True while the one-shot book-opening animation plays after mount.
 * Never true when `enabled` is false (reduced motion).
 */
export function useBookOpening(enabled: boolean, durationMs: number = BOOK_OPENING_MS): boolean {
  const [opening, setOpening] = useState(enabled);

  useEffect(() => {
    if (!opening) return undefined;
    const timer = window.setTimeout(() => setOpening(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, opening]);

  return enabled && opening;
}

export interface PromptBookTurnSheet {
  direction: -1 | 1;
  id: number;
}

let turnSheetSequence = 0;

/**
 * State for the blank overlay sheet that flips across the spread during page
 * navigation. `beginTurn` is called by the navigation handlers (not by data
 * driven index corrections, which must not animate). The sheet is removed on
 * animationend or, as a fallback, after TURN_SHEET_LIFETIME_MS.
 */
export function usePromptBookTurnSheet(enabled: boolean): {
  beginTurn: (direction: -1 | 1) => void;
  finishTurn: (id: number) => void;
  turnSheet: PromptBookTurnSheet | null;
} {
  const [turnSheet, setTurnSheet] = useState<PromptBookTurnSheet | null>(null);

  const beginTurn = useCallback((direction: -1 | 1) => {
    if (!enabled) return;
    turnSheetSequence += 1;
    setTurnSheet({ direction, id: turnSheetSequence });
  }, [enabled]);

  const finishTurn = useCallback((id: number) => {
    setTurnSheet((current) => (current?.id === id ? null : current));
  }, []);

  useEffect(() => {
    if (!turnSheet) return undefined;
    const timer = window.setTimeout(() => finishTurn(turnSheet.id), TURN_SHEET_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [finishTurn, turnSheet]);

  return { beginTurn, finishTurn, turnSheet };
}
