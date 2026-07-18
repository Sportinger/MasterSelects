import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FreeOfferNotice } from '../../src/components/common/FreeOfferNotice';

const claimWebsiteOffer = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/cloudApi', () => ({
  cloudApi: { credits: { claimWebsiteOffer } },
}));

afterEach(() => {
  vi.useRealTimers();
  claimWebsiteOffer.mockReset();
});

describe('FreeOfferNotice', () => {
  it('waits for an explicit click before requesting a browser-bound offer', async () => {
    vi.useFakeTimers();
    claimWebsiteOffer.mockResolvedValue({ offer: null, ok: true });
    const view = render(
      <FreeOfferNotice
        authenticated={false}
        onOpenAccount={vi.fn()}
        onOpenAuth={vi.fn()}
        preview={false}
        ready={false}
      />,
    );

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(claimWebsiteOffer).not.toHaveBeenCalled();

    view.rerender(
      <FreeOfferNotice
        authenticated={false}
        onOpenAccount={vi.fn()}
        onOpenAuth={vi.fn()}
        preview={false}
        ready
      />,
    );
    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(claimWebsiteOffer).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('button', { name: /check free gift/i })).toBeInTheDocument();
    expect(claimWebsiteOffer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /check free gift/i }));
    await act(() => Promise.resolve());
    expect(claimWebsiteOffer).toHaveBeenCalledTimes(1);
  });
});
