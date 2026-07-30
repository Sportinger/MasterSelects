import {
  getProviderTaskStartedAt,
  resolveFlashBoardJobStartedAt,
} from '../../src/services/flashboard/FlashBoardJobTiming';

describe('FlashBoard job timing', () => {
  it('keeps the original generation start across resume updates', () => {
    expect(resolveFlashBoardJobStartedAt({
      currentStartedAt: 1_000,
      nextStatus: 'processing',
      now: 9_000,
    })).toBe(1_000);
  });

  it('uses the earlier provider task creation time instead of the local receipt time', () => {
    expect(resolveFlashBoardJobStartedAt({
      currentStartedAt: 5_000,
      nextStartedAt: 3_000,
      nextStatus: 'processing',
      now: 9_000,
    })).toBe(3_000);
  });

  it('starts locally when no provider timestamp is available', () => {
    expect(resolveFlashBoardJobStartedAt({
      nextStatus: 'processing',
      now: 9_000,
    })).toBe(9_000);
  });

  it('reads a valid provider task creation date', () => {
    expect(getProviderTaskStartedAt({
      createdAt: new Date(4_000),
    })).toBe(4_000);
  });
});
