// Failure kinds of the whole-source decode chain (browser decodeAudioData, then
// container/WebCodecs, then FFmpeg WASM) and how callers classify them.
//
// Two questions matter to callers:
//   - did a path prove the source has no audio at all (stop the chain, a video
//     proxy reports 'none')?
//   - did every path really examine the bytes and reject them, or did one fail
//     for an environmental reason (read error, memory, decoder not loadable)?
//     Only the first kind may be remembered as "this source is undecodable".

import { AudioDecodeServiceError } from './errors';

export interface SourceAudioDecodeFailure {
  decoderId: string;
  message: string;
  /** The path failed for an environmental reason, not because of the source bytes. */
  transient: boolean;
}

/** The container was parsed and holds no audio track: no later decoder can find one. */
export class SourceAudioHasNoTrackError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceAudioHasNoTrackError';
  }
}

/** A decoder could not be made available (e.g. FFmpeg WASM failed to load); says nothing about the source. */
export class SourceAudioDecoderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SourceAudioDecoderUnavailableError';
  }
}

/**
 * Every decode path failed. Keeps the AudioDecodeServiceError shape (`decode-failed`,
 * first error as cause) so existing classification keeps working, plus each path's
 * failure and raw error.
 */
export class SourceAudioDecodeChainError extends AudioDecodeServiceError {
  readonly failures: readonly SourceAudioDecodeFailure[];
  readonly errors: readonly unknown[];

  constructor(message: string, options: {
    jobId: string;
    failures: readonly SourceAudioDecodeFailure[];
    errors: readonly unknown[];
  }) {
    super(message, { code: 'decode-failed', jobId: options.jobId, cause: options.errors[0] });
    this.failures = options.failures;
    this.errors = options.errors;
  }
}

const TRANSIENT_DECODE_CODES = new Set([
  'source-read-failed',
  'runtime-probe-failed',
  'browser-fallback-unavailable',
  'no-decoder-available',
  'cancelled',
]);

const TRANSIENT_ERROR_NAMES = new Set([
  'NotReadableError',
  'NotFoundError',
  'NotAllowedError',
  'SecurityError',
  'QuotaExceededError',
  'InvalidStateError',
  'AbortError',
  'TimeoutError',
  'NetworkError',
  'SourceAudioDecoderUnavailableError',
]);

function* causeChain(error: unknown): Generator<unknown> {
  let current = error;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth++) {
    yield current;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
}

/** True when a decode path failed because of the environment (file access, memory, decoder loading), not the bytes. */
export function isTransientSourceAudioDecodeError(error: unknown): boolean {
  for (const link of causeChain(error)) {
    if (link instanceof AudioDecodeServiceError && TRANSIENT_DECODE_CODES.has(link.code)) return true;
    if (link instanceof RangeError) return true; // allocation failures
    if (link && typeof link === 'object') {
      const name = (link as { name?: unknown }).name;
      if (typeof name === 'string' && TRANSIENT_ERROR_NAMES.has(name)) return true;
    }
  }
  return false;
}

/** The chain proved the source has no audio track, or the browser rejected it as undecodable audio. */
export function isSourceAudioMissingError(error: unknown): boolean {
  const roots = error instanceof SourceAudioDecodeChainError ? error.errors : [error];
  return roots.some(root => {
    for (const link of causeChain(root)) {
      if (link instanceof SourceAudioHasNoTrackError) return true;
      if (link instanceof DOMException && link.name === 'EncodingError') return true;
    }
    return false;
  });
}

/** Every path examined the bytes and rejected them: safe to remember for this exact content. */
export function isDurableSourceAudioDecodeFailure(error: unknown): error is SourceAudioDecodeChainError {
  return error instanceof SourceAudioDecodeChainError
    && error.failures.length > 0
    && error.failures.every(failure => !failure.transient);
}
