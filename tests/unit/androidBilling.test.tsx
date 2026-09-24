import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDialogHost } from '../../src/components/common/AccountDialogHost';
import { useAccountStore } from '../../src/stores/accountStore';
import { cloudApi } from '../../src/services/cloudApi';

const original = useAccountStore.getState();
beforeEach(() => {
  Object.defineProperty(window, '__masterselectsAndroid', { configurable: true, value: { bundledEditor: true } });
  useAccountStore.setState({ ...original, isInitialized: true, loadAccountState: vi.fn().mockResolvedValue(undefined) }, true);
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, '__masterselectsAndroid');
  useAccountStore.setState(original, true);
  vi.restoreAllMocks();
});

describe('Android beta purchases', () => {
  it('shows account access without purchase controls when pricing is requested', () => {
    render(<AccountDialogHost />);
    act(() => useAccountStore.getState().openPricingDialog());
    expect(useAccountStore.getState().dialog).toBe('account');
    expect(screen.queryByRole('button', { name: 'Change plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pricing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
  it('does not send checkout or billing-portal requests even if called directly', async () => {
    const checkout = vi.spyOn(cloudApi.billing, 'checkout');
    const portal = vi.spyOn(cloudApi.billing, 'portal');
    await useAccountStore.getState().startCheckout('pro');
    await useAccountStore.getState().openBillingPortal();
    expect(checkout).not.toHaveBeenCalled();
    expect(portal).not.toHaveBeenCalled();
    expect(useAccountStore.getState().error).toContain('Purchases are not available');
  });
  it('handles a restored pricing dialog without rendering checkout', () => {
    useAccountStore.setState({ dialog: 'pricing' });
    render(<AccountDialogHost />);
    expect(screen.queryByRole('heading', { name: 'Pricing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
