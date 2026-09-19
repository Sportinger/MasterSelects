import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDialogHost } from '../../src/components/common/AccountDialogHost';
import { notifyBillingUpgradeRequired } from '../../src/services/billingPromptEvents';
import { useAccountStore, type AccountState } from '../../src/stores/accountStore';

const originalAccountState = useAccountStore.getState();

function resetAccountState(overrides: Partial<AccountState> = {}) {
  useAccountStore.setState({
    ...originalAccountState,
    dialog: null,
    isInitialized: true,
    session: null,
    user: null,
    ...overrides,
  }, true);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/chat');
  resetAccountState({
    loadAccountState: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  useAccountStore.setState(originalAccountState, true);
});

describe('AccountDialogHost', () => {
  it('shows the sign-in dialog when any route opens shared account authentication', () => {
    render(<AccountDialogHost />);

    act(() => {
      useAccountStore.getState().openAuthDialog();
    });

    expect(screen.getByRole('heading', { name: 'Sign in or create account' }))
      .toBeInTheDocument();
  });

  it('finishes an auth return without replacing the route that initiated login', async () => {
    const loadAccountState = vi.fn().mockResolvedValue(undefined);
    const openAccountDialog = vi.fn();
    window.history.replaceState(null, '', '/landing?auth=success');
    resetAccountState({ loadAccountState, openAccountDialog });

    render(<AccountDialogHost />);

    await waitFor(() => expect(openAccountDialog).toHaveBeenCalledTimes(1));
    expect(loadAccountState).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe('/landing');
    expect(window.location.search).toBe('');
  });

  it('opens pricing when an AI request reports exhausted credits', () => {
    render(<AccountDialogHost />);

    act(() => notifyBillingUpgradeRequired());

    expect(screen.getByRole('heading', { name: 'Pricing' })).toBeInTheDocument();
  });

  it('offers sign in instead of sign out for a guest account', () => {
    resetAccountState({
      dialog: 'account',
      session: { authenticated: false, guest: true },
    });
    render(<AccountDialogHost />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('heading', { name: 'Sign in or create account' }))
      .toBeInTheDocument();
  });

  it('keeps sign out for an authenticated account', () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    resetAccountState({
      dialog: 'account',
      logout,
      session: { authenticated: true, provider: 'google' },
    });
    render(<AccountDialogHost />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
