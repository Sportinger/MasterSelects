/**
 * Not even the first bytes could be read: Chromium says NotReadableError when a file changed on disk after
 * the page got it (still being copied or written, replaced, re-encoded). Size limits fail later, not here.
 */
export function isChangedSourceFailure(failures: readonly unknown[]): boolean {
  return failures.some(error => typeof error === 'object' && error !== null
    && (error as { name?: unknown }).name === 'NotReadableError');
}
