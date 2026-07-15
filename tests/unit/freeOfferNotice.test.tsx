import { act, render } from '@testing-library/react';
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
  it('requests the offer only ten seconds after onboarding is clear', async () => {
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
    expect(claimWebsiteOffer).toHaveBeenCalledTimes(1);
  });
});
