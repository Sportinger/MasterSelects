// Classifies browser-storage failures that come from the environment rather
// than from MasterSelects code, and keeps platform-impossible backends away.
//
// WebKit (every iOS/iPadOS browser) rejects OPFS calls with a DOMException
// `UnknownError` - "The operation failed for an unknown transient reason
// (e.g. out of memory)" - while its storage process is resuming, in Private
// Browsing, inside in-app browsers, and when the device is low on space. The
// worker relays only the message, so both the name and the text identify it.
//
// Firefox refuses OPFS for good with a SecurityError in Private Browsing, and
// Chrome does so when site data is blocked. That is the same environment problem,
// but it does not pass, so it is never retried.

import { Logger } from '../../logger';
import { isMobileAppleWebKit } from '../../../utils/mobileAppleWebKit';

const log = Logger.create('BrowserStorage');

// IndexedDB's sibling of the same failure: the open succeeds without a connection (Instagram on iOS).
const UNKNOWN_STORAGE_MESSAGE = /unknown transient reason|returned no database connection/i;
const REFUSED_STORAGE_MESSAGE = /security error when calling getdirectory|storage directory access is denied/i;
/**
 * Pauses before each new attempt. WebKit's storage process can take more than a second to resume; giving
 * up early sends the person to the temporary fallback store, which must stay a last resort.
 */
const RETRY_DELAYS_MS = [200, 600, 1500];

export const BROWSER_STORAGE_UNAVAILABLE_MESSAGE = 'This browser could not open its project storage. '
  + 'Private Browsing, in-app browsers, and low device storage can block it: open MasterSelects in a regular '
  + 'browser window, free some space, and try again.';

function* errorChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth += 1) {
    yield current;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
}

function isTransientStorageFailure(error: unknown): boolean {
  for (const entry of errorChain(error)) {
    if (typeof entry === 'string' && UNKNOWN_STORAGE_MESSAGE.test(entry)) return true;
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, message } = entry as { name?: unknown; message?: unknown };
    if (name === 'UnknownError') return true;
    if (typeof message === 'string' && UNKNOWN_STORAGE_MESSAGE.test(message)) return true;
  }
  return false;
}

function isRefusedStorageFailure(error: unknown): boolean {
  for (const entry of errorChain(error)) {
    const message = typeof entry === 'object' && entry !== null ? (entry as { message?: unknown }).message : entry;
    if (typeof message === 'string' && REFUSED_STORAGE_MESSAGE.test(message)) return true;
  }
  return false;
}

/** True when the browser itself withholds its storage, raw, wrapped in a cause, or relayed as text. */
export function isBrowserStorageUnavailableError(error: unknown): boolean {
  return isTransientStorageFailure(error) || isRefusedStorageFailure(error);
}

/**
 * Failure of `navigator.storage.getDirectory()` itself. Any SecurityError from that call is a refusal,
 * also with the wording of browsers whose text is too generic to classify elsewhere (WebKit: "The operation is insecure").
 */
export function isOpfsRefusal(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  return name === 'SecurityError' || isBrowserStorageUnavailableError(error);
}

function isRetryableStorageError(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  // A raw AbortError from OPFS is WebKit's storage process resuming; repository
  // cancellations are RepositoryErrors and never match this name.
  return name === 'AbortError' || isTransientStorageFailure(error);
}

/**
 * Runs a storage operation and repeats it after growing pauses (up to three more times) when WebKit
 * reports a transient failure. Callers pass only operations that are safe to repeat (acquisition,
 * reads, or idempotent open-or-create flows).
 */
export async function retryTransientStorage<T>(operation: () => Promise<T>, context: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryableStorageError(error)) throw error;
      log.warn(`${context}: transient browser-storage failure, retrying (${attempt + 1}/${RETRY_DELAYS_MS.length})`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/** Replaces WebKit's opaque storage text with an explanation the person can act on. */
export function describeBrowserStorageFailure(error: unknown): string | null {
  return isBrowserStorageUnavailableError(error) ? BROWSER_STORAGE_UNAVAILABLE_MESSAGE : null;
}

let nativeHelperSkipLogged = false;

/**
 * The Native Helper is a desktop companion reached over localhost. iOS/iPadOS
 * (all WebKit) and Android cannot run it, so asking for it there only adds a
 * connection attempt and a misleading warning before browser storage is used.
 */
export function canHostNativeHelper(
  environment: { userAgent?: string; platform?: string; maxTouchPoints?: number } | undefined =
    typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!environment) return false;
  const supported = !isMobileAppleWebKit(environment) && !/android/i.test(environment.userAgent ?? '');
  if (!supported && !nativeHelperSkipLogged) {
    nativeHelperSkipLogged = true;
    log.info('Native Helper is not available on this platform; projects use browser storage');
  }
  return supported;
}
