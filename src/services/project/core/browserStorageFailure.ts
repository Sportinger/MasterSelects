// Classifies browser-storage failures that come from the environment rather
// than from MasterSelects code, and keeps platform-impossible backends away.
//
// WebKit (every iOS/iPadOS browser) rejects OPFS calls with a DOMException
// `UnknownError` - "The operation failed for an unknown transient reason
// (e.g. out of memory)" - while its storage process is resuming, in Private
// Browsing, inside in-app browsers, and when the device is low on space. The
// worker relays only the message, so both the name and the text identify it.

import { Logger } from '../../logger';
import { isMobileAppleWebKit } from '../../../utils/mobileAppleWebKit';

const log = Logger.create('BrowserStorage');

const UNKNOWN_STORAGE_MESSAGE = /unknown transient reason/i;
const RETRY_DELAY_MS = 200;

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

/** True for WebKit's opaque storage failure, raw, wrapped in a cause, or relayed as text. */
export function isBrowserStorageUnavailableError(error: unknown): boolean {
  for (const entry of errorChain(error)) {
    if (typeof entry === 'string' && UNKNOWN_STORAGE_MESSAGE.test(entry)) return true;
    if (typeof entry !== 'object' || entry === null) continue;
    const { name, message } = entry as { name?: unknown; message?: unknown };
    if (name === 'UnknownError') return true;
    if (typeof message === 'string' && UNKNOWN_STORAGE_MESSAGE.test(message)) return true;
  }
  return false;
}

function isRetryableStorageError(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
  // A raw AbortError from OPFS is WebKit's storage process resuming; repository
  // cancellations are RepositoryErrors and never match this name.
  return name === 'AbortError' || isBrowserStorageUnavailableError(error);
}

/**
 * Runs a storage operation and repeats it once after a short pause when WebKit
 * reports a transient failure. Callers pass only operations that are safe to
 * repeat (acquisition, or idempotent open-or-create flows).
 */
export async function retryTransientStorage<T>(operation: () => Promise<T>, context: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isRetryableStorageError(error)) throw error;
    log.warn(`${context}: transient browser-storage failure, retrying once`, error);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return operation();
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
