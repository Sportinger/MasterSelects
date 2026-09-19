import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppLoadingScreen } from '../../src/components/common/AppLoadingScreen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AppLoadingScreen', () => {
  it('shows a compact accessible progress indicator', () => {
    render(<AppLoadingScreen />);

    expect(screen.getByRole('status', { name: 'Opening MasterSelects' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Opening MasterSelects progress' }))
      .not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('MasterSelects')).toBeInTheDocument();
  });

  it('does not claim a numeric completion value while content is pending', () => {
    render(<AppLoadingScreen label="Preparing editor" />);

    const progress = screen.getByRole('progressbar', { name: 'Preparing editor progress' });
    expect(progress).not.toHaveAttribute('aria-valuenow');
    expect(progress.querySelectorAll('.app-loading-clip')).toHaveLength(6);
    expect(progress.querySelector('.app-loading-playhead')).toBeInTheDocument();
  });

  it('moves two clips every 500ms, producing four clip movements per second', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { container } = render(<AppLoadingScreen />);
    const readSlots = () => Array.from(container.querySelectorAll('.app-loading-clip'))
      .map((clip) => clip.getAttribute('data-slot'));

    const initialSlots = readSlots();
    act(() => vi.advanceTimersByTime(320));
    const firstSwapSlots = readSlots();
    expect(firstSwapSlots.filter((slot, index) => slot !== initialSlots[index])).toHaveLength(2);

    act(() => vi.advanceTimersByTime(500));
    const secondSwapSlots = readSlots();
    expect(secondSwapSlots.filter((slot, index) => slot !== firstSwapSlots[index])).toHaveLength(2);
  });
});
