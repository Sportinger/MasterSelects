import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthDialog } from '../../src/components/common/AuthDialog';

const login = vi.fn();
vi.mock('../../src/stores/accountStore', () => ({ useAccountStore: () => ({ login, devLogin: vi.fn(), error: null, isLoading: false, notice: null }) }));

afterEach(() => { Reflect.deleteProperty(window, '__masterselectsAndroid'); login.mockClear(); });
describe('Android cloud sign-in', () => {
  it('keeps Google sign-in on the website', () => {
    render(<AuthDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(login).toHaveBeenCalledWith({ email: '', provider: 'google' });
  });
  it('sends email links and opens the native link dialog in the packaged app', () => {
    const openEmailSignInLink = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, '__masterselectsAndroid', { configurable: true, value: { openEmailSignInLink } });
    render(<AuthDialog onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'editor@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    expect(login).toHaveBeenCalledWith({ email: 'editor@example.com', provider: 'magic_link' });
    fireEvent.click(screen.getByRole('button', { name: 'Open email sign-in link' }));
    expect(openEmailSignInLink).toHaveBeenCalledOnce();
  });
});
