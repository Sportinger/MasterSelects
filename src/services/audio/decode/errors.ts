import type { AudioDecodeErrorCode } from '../audioDecodeTypes';

export class AudioDecodeServiceError extends Error {
  readonly code: AudioDecodeErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: AudioDecodeErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'AudioDecodeCancelledError'
      : 'AudioDecodeServiceError';
    this.code = options.code;
    this.jobId = options.jobId;
    this.recoverable = options.recoverable ?? options.code !== 'invalid-decode-result';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCancellationError(error: unknown): error is AudioDecodeServiceError {
  return error instanceof AudioDecodeServiceError && error.code === 'cancelled';
}

export function decodeCancelledError(jobId: string, reason?: unknown): AudioDecodeServiceError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new AudioDecodeServiceError(`Audio decode job ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

export function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

export function throwIfSignalCancelled(signal: AbortSignal, jobId: string): void {
  if (signal.aborted) {
    throw decodeCancelledError(jobId, getAbortReason(signal));
  }
}

const UNDECODABLE_AUDIO_CODES = new Set(['decode-failed', 'no-decoder-available', 'invalid-decode-result']);

/**
 * The source file is readable but no decode path (browser decodeAudioData, then the
 * container/WebCodecs reader, then FFmpeg WASM) produced audio, e.g. a corrupt file or a
 * video without an audio track. The clip still works; it only has no waveform.
 * Intermediate layers log this known case at debug; the clip waveform analysis logs the
 * one explained warning per clip.
 */
export function isUndecodableAudioSourceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { name?: unknown; code?: unknown };
  return maybe.name === 'AudioDecodeServiceError'
    && typeof maybe.code === 'string'
    && UNDECODABLE_AUDIO_CODES.has(maybe.code);
}
