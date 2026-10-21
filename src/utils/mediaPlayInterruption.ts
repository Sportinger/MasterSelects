/**
 * `HTMLMediaElement.play()` rejects with an AbortError when a later `pause()`,
 * `load()` or source change supersedes it. That is expected media-element
 * behaviour, not a failure, and must never be reported as an error.
 */
const PLAY_INTERRUPTION_PATTERN = /\bplay\(\) request was interrupted\b|fetching process for the media resource was aborted/i;

export function isMediaPlayInterruption(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === 'AbortError'
    && typeof message === 'string'
    && PLAY_INTERRUPTION_PATTERN.test(message);
}
