import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOK_OPENING_MS,
  TURN_SHEET_LIFETIME_MS,
  useBookOpening,
  usePrefersReducedMotion,
  usePromptBookTurnSheet,
} from '../../src/components/panels/flashboard/promptBookAnimations';

describe('usePromptBookTurnSheet', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts without a sheet and creates one per beginTurn with the given direction', () => {
    const { result } = renderHook(() => usePromptBookTurnSheet(true));
    expect(result.current.turnSheet).toBeNull();

    act(() => result.current.beginTurn(1));
    expect(result.current.turnSheet?.direction).toBe(1);

    const firstId = result.current.turnSheet?.id;
    act(() => result.current.beginTurn(-1));
    expect(result.current.turnSheet?.direction).toBe(-1);
    expect(result.current.turnSheet?.id).not.toBe(firstId);
  });

  it('removes the sheet via finishTurn only when the id matches', () => {
    const { result } = renderHook(() => usePromptBookTurnSheet(true));
    act(() => result.current.beginTurn(1));
    const sheetId = result.current.turnSheet?.id ?? 0;

    act(() => result.current.finishTurn(sheetId - 1));
    expect(result.current.turnSheet).not.toBeNull();

    act(() => result.current.finishTurn(sheetId));
    expect(result.current.turnSheet).toBeNull();
  });

  it('expires the sheet after the lifetime fallback when animationend never fires', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePromptBookTurnSheet(true));
    act(() => result.current.beginTurn(1));
    expect(result.current.turnSheet).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(TURN_SHEET_LIFETIME_MS + 10);
    });
    expect(result.current.turnSheet).toBeNull();
  });

  it('never creates a sheet when disabled (reduced motion)', () => {
    const { result } = renderHook(() => usePromptBookTurnSheet(false));
    act(() => result.current.beginTurn(1));
    expect(result.current.turnSheet).toBeNull();
  });
});

describe('useBookOpening', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is true on mount and turns off after the opening duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBookOpening(true));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(BOOK_OPENING_MS + 10);
    });
    expect(result.current).toBe(false);
  });

  it('stays off when disabled', () => {
    const { result } = renderHook(() => useBookOpening(false));
    expect(result.current).toBe(false);
  });
});

describe('usePrefersReducedMotion', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('defaults to false when matchMedia is unavailable (jsdom)', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it('reflects a reduce preference from matchMedia', () => {
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: true,
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });
});
