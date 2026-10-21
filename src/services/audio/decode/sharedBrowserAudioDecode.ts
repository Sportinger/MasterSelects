// One browser decodeAudioData attempt per source file.
//
// Importing an audio file starts the audio proxy (shared AudioDecodeService,
// `file` source) and the source waveform (per-job AudioDecodeService,
// `array-buffer` source) at about the same time. Without coordination both
// run decodeAudioData on the same bytes: twice the PCM memory for a valid
// file, and a duplicate failure for an undecodable one. Callers that decode a
// whole File through the browser path wrap the attempt here:
//   - a concurrent attempt for the same file joins the running one and gets
//     the same AudioBuffer (both paths only read it) or the same error;
//   - a `decode-failed` result is remembered for a while, so a later path
//     reuses the failure instead of decoding the bytes again.
// Cancellation is never shared: a joiner whose owner was cancelled decodes
// itself, and a cancelled attempt is not remembered as a failure.

import { Logger } from '../../logger';
import { AudioDecodeServiceError, isCancellationError } from './errors';

const log = Logger.create('SharedBrowserAudioDecode');

/** Long enough for the proxy and the (possibly queued) waveform job of one import. */
export const SHARED_BROWSER_DECODE_FAILURE_TTL_MS = 10 * 60_000;
const MAX_REMEMBERED_FAILURES = 64;

interface RememberedFailure {
  error: AudioDecodeServiceError;
  expiresAt: number;
}

const inFlight = new Map<string, Promise<AudioBuffer>>();
const failures = new Map<string, RememberedFailure>();

/** Same file identity the waveform and proxy paths already use for fingerprints. */
export function browserAudioDecodeSourceKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function isAbortLike(error: unknown): boolean {
  return isCancellationError(error)
    || (Boolean(error) && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

function isRememberableFailure(error: unknown): error is AudioDecodeServiceError {
  return error instanceof AudioDecodeServiceError && error.code === 'decode-failed';
}

function rememberFailure(key: string, error: AudioDecodeServiceError): void {
  failures.delete(key);
  failures.set(key, { error, expiresAt: Date.now() + SHARED_BROWSER_DECODE_FAILURE_TTL_MS });
  while (failures.size > MAX_REMEMBERED_FAILURES) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

function rememberedFailure(key: string): AudioDecodeServiceError | null {
  const entry = failures.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    failures.delete(key);
    return null;
  }
  return entry.error;
}

function raceSignal<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Audio decode cancelled', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/**
 * Runs `decode` (a browser decodeAudioData attempt for `file`) unless another
 * caller is already decoding the same file or it recently failed with
 * `decode-failed`. Reused failures rethrow the original error object, so
 * callers classify it exactly as if they had decoded the bytes themselves.
 */
export async function runSharedBrowserAudioDecode(
  file: File,
  decode: () => Promise<AudioBuffer>,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const key = browserAudioDecodeSourceKey(file);
  const knownFailure = rememberedFailure(key);
  if (knownFailure) {
    log.debug('Reusing the browser decode failure of this source instead of decoding it again', {
      file: file.name,
      message: knownFailure.message,
    });
    throw knownFailure;
  }

  const running = inFlight.get(key);
  if (running) {
    try {
      return await raceSignal(running, signal);
    } catch (error) {
      if (signal?.aborted || !isAbortLike(error)) throw error;
      // The owning caller was cancelled; this caller still wants the audio.
      if (inFlight.get(key) === running) inFlight.delete(key);
      return runSharedBrowserAudioDecode(file, decode, signal);
    }
  }

  const attempt = decode();
  inFlight.set(key, attempt);
  try {
    return await attempt;
  } catch (error) {
    if (!isAbortLike(error) && isRememberableFailure(error)) rememberFailure(key, error);
    throw error;
  } finally {
    if (inFlight.get(key) === attempt) inFlight.delete(key);
  }
}

/** Test hook: forgets running attempts and remembered failures. */
export function clearSharedBrowserAudioDecodeState(): void {
  inFlight.clear();
  failures.clear();
}
