import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditBurnMeter } from '../../src/components/common/CreditBurnMeter';
import {
  applyConfirmedCreditUpdate,
  beginCreditActivity,
  resetCreditCoordinatorForTests,
} from '../../src/services/credits/creditBalanceCoordinator';
import { useAccountStore } from '../../src/stores/accountStore';
import { useCreditActivityStore } from '../../src/stores/creditActivityStore';

function setReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      matches,
      media: '(prefers-reduced-motion: reduce)',
      removeEventListener: vi.fn(),
    })),
  });
}

function setAccount(balance = 100, reference = 200): void {
  useAccountStore.setState({
    billingSummary: null,
    creditBalance: balance,
    creditMeterReference: reference,
    dialog: null,
    isInitialized: true,
    session: { authenticated: true, provider: 'magic_link' },
    user: { email: 'user@example.com', id: 'user-1' },
  });
}

describe('CreditBurnMeter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCreditCoordinatorForTests();
    setReducedMotion(false);
    setAccount();
  });

  afterEach(() => {
    cleanup();
    resetCreditCoordinatorForTests();
    vi.useRealTimers();
  });

  it('keeps the permanent reserve bar and opens Account from the idle state', () => {
    const { container } = render(<CreditBurnMeter />);
    const button = screen.getByRole('button', { name: /100 credits available/i });

    expect(button).toHaveClass('credit-burn-meter');
    expect(button).toHaveAttribute('data-credit-level', 'normal');
    expect(container.querySelector('.credit-burn-track')).toBeInTheDocument();
    expect(container.querySelector('.credit-burn-fill')).toHaveStyle({ transform: 'scaleX(0.5)' });
    expect(button).toHaveTextContent('CREDITS');
    expect(button).toHaveTextContent('RUN —');

    fireEvent.click(button);
    expect(useAccountStore.getState().dialog).toBe('account');
  });

  it('shows active waiting, one authoritative debit burst, and the terminal hold', async () => {
    const { container } = render(<CreditBurnMeter />);

    act(() => {
      beginCreditActivity({ feature: 'AI agent', id: 'turn-1', targetId: 'missing-anchor' });
    });
    expect(screen.getByRole('button')).toHaveTextContent('AI ACTIVE');
    expect(screen.getByRole('button')).toHaveTextContent('RUN −0');

    await act(async () => {
      applyConfirmedCreditUpdate({
        activityId: 'turn-1',
        activityTotalCredits: 10,
        balance: 90,
        credits: 10,
        kind: 'debit',
        mutationId: 'debit:hosted:ai_chat:ledger-1',
        source: 'hosted:ai_chat',
      });
    });

    expect(screen.getByRole('button', { name: /90 credits available.*10 credits used/i }))
      .toHaveTextContent('RUN −10');
    expect(screen.getByRole('button')).toHaveClass('is-debit');
    expect(container.querySelector('.credit-drain-layer')).toBeInTheDocument();
    expect(container.querySelectorAll('.credit-drain-particle')).toHaveLength(7);
    expect(container.querySelector('.credit-drain-amount'))
      .toHaveAttribute('data-credit-amount', '−10');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('10 credits used.');
    expect(container.querySelector('.credit-burn-fill')).toHaveStyle({ transform: 'scaleX(0.45)' });

    act(() => {
      useCreditActivityStore.getState().endActivity('turn-1', 'completed');
    });
    expect(screen.getByRole('button')).toHaveTextContent('LAST −10');

    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(screen.getByRole('button')).toHaveTextContent('RUN —');
  });

  it('aggregates overlapping activity totals without changing the account truth', async () => {
    render(<CreditBurnMeter />);
    await act(async () => {
      beginCreditActivity({ feature: 'AI video', id: 'video-1' });
      beginCreditActivity({ feature: 'AI transcription', id: 'transcription-1' });
      applyConfirmedCreditUpdate({
        activityId: 'video-1',
        balance: 95,
        credits: 5,
        kind: 'debit',
        mutationId: 'debit:hosted:video:ledger-1',
        source: 'hosted:video',
      });
      applyConfirmedCreditUpdate({
        activityId: 'transcription-1',
        balance: 92,
        credits: 3,
        kind: 'debit',
        mutationId: 'debit:hosted:transcription:ledger-1',
        source: 'hosted:transcription',
      });
    });

    expect(screen.getByRole('button')).toHaveTextContent('2 ACTIVE');
    expect(screen.getByRole('button')).toHaveTextContent('RUN −8');
    expect(useAccountStore.getState().creditBalance).toBe(92);
  });

  it('applies reduced-motion settlements immediately with no particle layer', async () => {
    setReducedMotion(true);
    const { container } = render(<CreditBurnMeter />);
    await act(async () => {
      beginCreditActivity({ feature: 'AI speech', id: 'speech-1' });
      applyConfirmedCreditUpdate({
        activityId: 'speech-1',
        balance: 88,
        credits: 12,
        kind: 'debit',
        mutationId: 'debit:hosted:speech:ledger-1',
        source: 'hosted:speech',
      });
    });

    expect(screen.getByRole('button', { name: /88 credits available/i })).toBeInTheDocument();
    expect(container.querySelector('.credit-drain-layer')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('12 credits used.');
  });

  it('uses a distinct upward treatment for grants and exposes low/critical geometry', async () => {
    setAccount(9, 100);
    const { container } = render(<CreditBurnMeter />);
    expect(screen.getByRole('button')).toHaveAttribute('data-credit-level', 'critical');

    await act(async () => {
      applyConfirmedCreditUpdate({
        balance: 29,
        credits: 20,
        kind: 'grant',
        mutationId: 'grant:claim:ledger-1',
        source: 'claim',
      });
    });

    expect(screen.getByRole('button')).toHaveClass('is-grant');
    expect(screen.getByRole('button')).toHaveAttribute('data-credit-level', 'normal');
    expect(screen.getByRole('button')).toHaveTextContent('+20');
    expect(container.querySelector('.credit-drain-layer')).not.toBeInTheDocument();
  });
});
