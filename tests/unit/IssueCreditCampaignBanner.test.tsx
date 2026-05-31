import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssueCreditCampaignBanner } from '../../src/components/common/IssueCreditCampaignBanner';

// The banner appears 10s after it is armed (splash closed) and auto-hides 10s
// later (#195), so the tests arm it and advance fake timers past the delay.
describe('IssueCreditCampaignBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the issue credit campaign and GitHub issue action after the appear delay', () => {
    render(<IssueCreditCampaignBanner armed />);

    // Hidden until the appear delay elapses.
    expect(screen.queryByRole('region', { name: 'MasterSelects issue credit campaign' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByRole('region', { name: 'MasterSelects issue credit campaign' })).toBeInTheDocument();
    expect(screen.getByText('Completed Issue = 1000 AI Credits')).toBeInTheDocument();

    const issueLink = screen.getByRole('link', { name: /Submit issue/i });
    expect(issueLink).toHaveAttribute('href', 'https://github.com/Sportinger/MasterSelects/issues/new');
    expect(issueLink).toHaveAttribute('target', '_blank');
  });

  it('can be dismissed for the current session', () => {
    render(<IssueCreditCampaignBanner armed />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss issue credit campaign' }));

    expect(screen.queryByRole('region', { name: 'MasterSelects issue credit campaign' })).not.toBeInTheDocument();
  });
});
