import { describe, expect, it, vi } from 'vitest';
import {
  UntrustedNavigationError,
  navigateToTrustedUrl,
  requireTrustedNavigationUrl,
  resolveTrustedNavigationUrl,
} from '../../src/services/security/trustedNavigation';

const BASE = 'https://app.masterselects.test/editor?x=1';

describe('resolveTrustedNavigationUrl', () => {
  it('accepts same-origin absolute and relative URLs', () => {
    expect(resolveTrustedNavigationUrl('https://app.masterselects.test/api/auth/callback?state=s&token=t', BASE))
      .toBe('https://app.masterselects.test/api/auth/callback?state=s&token=t');
    expect(resolveTrustedNavigationUrl('/?redeem=123456', BASE)).toBe('https://app.masterselects.test/?redeem=123456');
    expect(resolveTrustedNavigationUrl('claim', BASE)).toBe('https://app.masterselects.test/claim');
  });

  it('accepts http same-origin URLs during local development', () => {
    expect(resolveTrustedNavigationUrl('http://localhost:5173/api/auth/callback?state=s', 'http://localhost:5173/'))
      .toBe('http://localhost:5173/api/auth/callback?state=s');
  });

  it('accepts https URLs on the explicit external allowlist', () => {
    expect(resolveTrustedNavigationUrl('https://checkout.stripe.com/c/pay/cs_test_a1B2', BASE))
      .toBe('https://checkout.stripe.com/c/pay/cs_test_a1B2');
    expect(resolveTrustedNavigationUrl('https://billing.stripe.com/p/session/test_x', BASE))
      .toBe('https://billing.stripe.com/p/session/test_x');
    expect(resolveTrustedNavigationUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=s', BASE))
      .toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=c&state=s');
    expect(resolveTrustedNavigationUrl('HTTPS://CHECKOUT.STRIPE.COM/c/pay/x', BASE))
      .toBe('https://checkout.stripe.com/c/pay/x');
  });

  it('rejects lookalike, parent and subdomain hosts', () => {
    for (const candidate of [
      'https://checkout.stripe.com.evil.test/c/pay/x',
      'https://evil.test/checkout.stripe.com',
      'https://notcheckout.stripe.com/',
      'https://stripe.com/',
      'https://app.masterselects.test.evil.test/',
      'https://evil.app.masterselects.test/',
    ]) {
      expect(resolveTrustedNavigationUrl(candidate, BASE), candidate).toBeNull();
    }
  });

  it('rejects protocol-relative and backslash tricks', () => {
    expect(resolveTrustedNavigationUrl('//evil.test/x', BASE)).toBeNull();
    expect(resolveTrustedNavigationUrl('/\\evil.test/x', BASE)).toBeNull();
    expect(resolveTrustedNavigationUrl('\\\\evil.test\\x', BASE)).toBeNull();
  });

  it('rejects non-http(s) schemes', () => {
    for (const candidate of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://app.masterselects.test/0f1e2d3c',
      'mailto:someone@example.test',
      'ftp://checkout.stripe.com/',
      'vbscript:msgbox(1)',
    ]) {
      expect(resolveTrustedNavigationUrl(candidate, BASE), candidate).toBeNull();
    }
  });

  it('rejects http, credentials and non-default ports on external hosts', () => {
    for (const candidate of [
      'http://checkout.stripe.com/c/pay/x',
      'https://checkout.stripe.com@evil.test/',
      'https://user:pw@checkout.stripe.com/',
      'https://accounts.google.com:8443/o/oauth2/v2/auth',
    ]) {
      expect(resolveTrustedNavigationUrl(candidate, BASE), candidate).toBeNull();
    }
  });

  it('rejects empty, malformed and non-string input', () => {
    for (const candidate of ['', '   ', 'http://', 42, null, undefined, {}, ['https://checkout.stripe.com/']]) {
      expect(resolveTrustedNavigationUrl(candidate, BASE)).toBeNull();
    }
    expect(resolveTrustedNavigationUrl('/x', 'not a url')).toBeNull();
  });
});

describe('requireTrustedNavigationUrl / navigateToTrustedUrl', () => {
  it('navigates to a trusted external URL', () => {
    const assign = vi.fn();
    navigateToTrustedUrl('https://checkout.stripe.com/c/pay/cs_test_123', 'checkout', assign);
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_123');
  });

  it('resolves relative URLs against the current location', () => {
    const assign = vi.fn();
    navigateToTrustedUrl('/?redeem=1', 'redeem', assign);
    expect(assign).toHaveBeenCalledWith(`${window.location.origin}/?redeem=1`);
  });

  it('throws and never navigates for untrusted URLs', () => {
    const assign = vi.fn();
    expect(() => navigateToTrustedUrl('https://evil.test/phish', 'sign-in', assign)).toThrow(UntrustedNavigationError);
    expect(() => requireTrustedNavigationUrl('javascript:alert(1)', 'sign-in')).toThrow(/untrusted URL/);
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the rejected URL out of the error message', () => {
    expect.assertions(2);
    try {
      requireTrustedNavigationUrl('https://evil.test/callback?token=secret-token', 'magic-link verification');
    } catch (error) {
      expect(String(error)).not.toContain('evil.test');
      expect(String(error)).not.toContain('secret-token');
    }
  });
});
