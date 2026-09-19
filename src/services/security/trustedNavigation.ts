/**
 * Trusted navigation guard
 *
 * The backend hands the client URLs to navigate to: Google OAuth
 * (`authorizationUrl`), Stripe Checkout / Billing Portal (`checkoutUrl`,
 * `portalUrl`) and, in dev, the magic-link callback (`verificationUrl`). A
 * spoofed, proxied or compromised response must not be able to turn
 * `window.location.assign` into an open redirect, so every one of those
 * navigations goes through this module.
 *
 * Allowed: same-origin http(s) URLs (absolute or relative) and https URLs on
 * the explicit external host allowlist below (default port, no credentials).
 * Everything else - other hosts, lookalike subdomains, `javascript:`/`data:`
 * URLs, userinfo tricks - is rejected and never navigated to.
 */

import { Logger } from '../logger';

const log = Logger.create('TrustedNavigation');

/**
 * External hosts the backend legitimately redirects the browser to. Keep in
 * sync with the producers: `functions/lib/auth.ts` (buildGoogleAuthorizationUrl),
 * `functions/api/billing/checkout.ts` (Stripe Checkout session / portal URL)
 * and `functions/api/billing/portal.ts` (Stripe Billing Portal session).
 */
export const TRUSTED_EXTERNAL_NAVIGATION_HOSTS: ReadonlySet<string> = new Set([
  'accounts.google.com',
  'billing.stripe.com',
  'checkout.stripe.com',
]);

export class UntrustedNavigationError extends Error {
  constructor(purpose: string) {
    super(`Blocked ${purpose} redirect: the server returned an untrusted URL.`);
    this.name = 'UntrustedNavigationError';
  }
}

function isWebProtocol(protocol: string): boolean {
  return protocol === 'https:' || protocol === 'http:';
}

/**
 * Returns the normalized absolute URL when `candidate` may be navigated to,
 * or `null` when it must not. Never throws.
 */
export function resolveTrustedNavigationUrl(
  candidate: unknown,
  baseHref: string = window.location.href,
): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  let base: URL;
  let target: URL;
  try {
    base = new URL(baseHref);
    target = new URL(trimmed, base);
  } catch {
    return null;
  }

  if (!isWebProtocol(target.protocol) || target.username || target.password) return null;
  if (isWebProtocol(base.protocol) && target.origin === base.origin) return target.href;
  if (
    target.protocol === 'https:'
    && target.port === ''
    && TRUSTED_EXTERNAL_NAVIGATION_HOSTS.has(target.hostname)
  ) {
    return target.href;
  }
  return null;
}

function describeRejected(candidate: unknown): Record<string, unknown> {
  if (typeof candidate !== 'string') return { type: typeof candidate };
  try {
    const url = new URL(candidate, window.location.href);
    // Host and scheme only: magic-link callbacks carry one-time tokens in the query.
    return { host: url.host, protocol: url.protocol };
  } catch {
    return { malformed: true };
  }
}

/** Returns the vetted URL or throws `UntrustedNavigationError`. */
export function requireTrustedNavigationUrl(candidate: unknown, purpose: string): string {
  const resolved = resolveTrustedNavigationUrl(candidate);
  if (!resolved) {
    log.warn(`Rejected ${purpose} redirect target`, describeRejected(candidate));
    throw new UntrustedNavigationError(purpose);
  }
  return resolved;
}

/**
 * Navigates the current document to `candidate` if it is trusted, otherwise
 * throws `UntrustedNavigationError` without navigating. `assign` is injectable
 * for tests; production callers use the default `window.location.assign`.
 */
export function navigateToTrustedUrl(
  candidate: unknown,
  purpose: string,
  assign: (href: string) => void = (href) => window.location.assign(href),
): void {
  assign(requireTrustedNavigationUrl(candidate, purpose));
}
