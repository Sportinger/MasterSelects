import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { BillingSummaryResponse } from '../../src/services/cloudApi';
import { PricingDialog } from '../../src/components/common/PricingDialog';
import { useAccountStore } from '../../src/stores/accountStore';

function createBillingSummary(
  planId: 'free' | 'starter' | 'pro' | 'studio',
  options?: { cancelAtPeriodEnd?: boolean },
): BillingSummaryResponse {
  return {
    creditBalance: 4440,
    entitlements: {},
    hostedAIEnabled: true,
    plan: {
      id: planId,
      label: planId.charAt(0).toUpperCase() + planId.slice(1),
      monthlyCredits: planId === 'starter' ? 4500 : planId === 'pro' ? 13500 : planId === 'studio' ? 27000 : 25,
    },
    recentCredits: [],
    stripeCustomerId: planId === 'free' ? null : 'cus_test',
    subscription: planId === 'free' ? null : {
      cancelAtPeriodEnd: options?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: '2026-05-14T10:16:15.000Z',
      currentPeriodStart: '2026-04-14T10:16:15.000Z',
      id: 'sub_local',
      planId,
      status: 'active',
      stripeSubscriptionId: 'sub_stripe',
      updatedAt: '2026-04-14T10:16:15.000Z',
    },
    usage: {
      byFeature: [],
      completedCount: 0,
      creditCost: 0,
      failedCount: 0,
      pendingCount: 0,
      since: '2026-04-01T00:00:00.000Z',
    },
    user: {
      avatarUrl: null,
      displayName: 'Roman',
      email: 'mail@romankuskowski.de',
      id: 'user_1',
    },
  };
}

describe('PricingDialog', () => {
  beforeEach(() => {
    useAccountStore.setState({
      billingSummary: createBillingSummary('starter'),
      creditBalance: 4440,
      error: null,
      isLoading: false,
      startCheckout: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('marks the active paid plan as selected by default', () => {
    render(<PricingDialog onClose={vi.fn()} />);

    const starterCard = screen.getByText('Starter', { selector: '.pricing-plan-name' }).closest('article');
    const freeCard = screen.getByText('Free', { selector: '.pricing-plan-name' }).closest('article');

    expect(starterCard).not.toBeNull();
    expect(freeCard).not.toBeNull();

    expect(starterCard).toHaveClass('pricing-plan-current');
    expect(starterCard).toHaveClass('pricing-plan-selected');
    expect(within(starterCard!).getByText('Current')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current plan' })).toBeDisabled();
    expect(freeCard).not.toHaveClass('pricing-plan-selected');
  });

  it('moves the selection highlight when another paid plan is chosen', () => {
    render(<PricingDialog onClose={vi.fn()} />);

    const proCard = screen.getByText('Pro', { selector: '.pricing-plan-name' }).closest('article');
    expect(proCard).not.toBeNull();

    fireEvent.click(proCard!);

    expect(proCard).toHaveClass('pricing-plan-selected');
    expect(within(proCard!).getByText('New')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeEnabled();
    expect(screen.getByText(/prorated difference immediately/i)).toBeInTheDocument();
  });

  it('allows selecting the free plan as a downgrade target', () => {
    render(<PricingDialog onClose={vi.fn()} />);

    const freeCard = screen.getByText('Free', { selector: '.pricing-plan-name' }).closest('article');
    expect(freeCard).not.toBeNull();

    fireEvent.click(freeCard!);

    expect(freeCard).toHaveClass('pricing-plan-selected');
    expect(within(freeCard!).getByText('New')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Downgrade to Free' })).toBeEnabled();
  });

  it('shows canceled state and end date when the current subscription is set to end', () => {
    useAccountStore.setState({
      billingSummary: createBillingSummary('starter', { cancelAtPeriodEnd: true }),
      creditBalance: 4440,
      error: null,
      isLoading: false,
      startCheckout: vi.fn().mockResolvedValue(undefined),
    });

    render(<PricingDialog onClose={vi.fn()} />);

    const starterCard = screen.getByText('Starter', { selector: '.pricing-plan-name' }).closest('article');
    expect(starterCard).not.toBeNull();

    expect(within(starterCard!).getByText('Canceled')).toBeInTheDocument();
    expect(screen.getByText(/Canceled · ends on/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Canceled plan' })).toBeDisabled();
  });
});
