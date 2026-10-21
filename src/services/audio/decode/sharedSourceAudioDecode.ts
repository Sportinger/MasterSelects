// One whole-source audio decode chain per source file.
//
// Importing an audio file starts the audio proxy (playback/scrub WAV) and the
// source waveform at about the same time. Both need the whole source as PCM and
// both run the same ordered chain: browser decodeAudioData, then container demux
// + WebCodecs, then FFmpeg WASM (sourceAudioFallbackDecode.ts). Coordinated here:
//   - a concurrent caller for the same content joins the running chain and gets
//     the same result (AudioBuffer + decoder id; both paths only read the buffer)
//     or the same error;
//   - a successful result stays available for a short handoff window within a
//     PCM budget, so the waveform job that runs right after the proxy (it waits
//     in the background queue) does not decode the source a second time;
//   - a chain failure is remembered for a while only when every path examined
//     the bytes and rejected them; environmental failures (read errors, memory,
//     FFmpeg not loadable) are retried by the next caller;
//   - the key is the content identity (metadata plus head/tail hash), so a
//     replaced file with the same name, size and mtime never sees an old result.
// Cancellation is never shared: a joiner whose owner was cancelled runs the chain
// itself, and a cancelled chain is not remembered.

import { Logger } from '../../logger';
import {
  decodeSourceAudioWithFallbacks,
  SOURCE_AUDIO_FALLBACK_DECODE_ATTEMPTS,
  type SourceAudioDecodeAttempt,
  type SourceAudioDecodeResult,
} from './sourceAudioFallbackDecode';
import { isDurableSourceAudioDecodeFailure, type SourceAudioDecodeChainError } from './sourceAudioDecodeFailures';
import { sourceAudioDecodeIdentity } from './sourceAudioIdentity';

const log = Logger.create('SharedSourceAudioDecode');

/** Long enough for the proxy and the (possibly queued) waveform job of one import. */
export const SHARED_SOURCE_DECODE_FAILURE_TTL_MS = 10 * 60_000;
/** How long a decoded buffer waits for the second consumer of the same import. */
export const SHARED_SOURCE_DECODE_HANDOFF_TTL_MS = 60_000;
/** Decoded PCM kept for handoff across all sources (a 10-minute stereo 48 kHz file is ~230 MB). */
export const SHARED_SOURCE_DECODE_HANDOFF_MAX_PCM_BYTES = 192 * 1024 * 1024;
const MAX_REMEMBERED_FAILURES = 64;

export interface SharedSourceAudioDecodeOptions {
  /** This caller's browser decodeAudioData attempt; it runs first when this caller owns the chain. */
  browserAttempt: SourceAudioDecodeAttempt;
  signal?: AbortSignal;
  /** An explicit retry (forced proxy regeneration) decodes again instead of reusing a remembered failure. */
  retryRememberedFailure?: boolean;
  /** Paths after the browser attempt; defaults to container/WebCodecs, then FFmpeg WASM. */
  fallbackAttempts?: readonly SourceAudioDecodeAttempt[];
}

interface RunningDecode {
  promise: Promise<SourceAudioDecodeResult>;
  ownerSignal: AbortSignal | undefined;
}

interface Handoff {
  result: SourceAudioDecodeResult;
  pcmBytes: number;
  timer: ReturnType<typeof setTimeout>;
}

const running = new Map<string, RunningDecode>();
const failures = new Map<string, { error: SourceAudioDecodeChainError; expiresAt: number }>();
const handoffs = new Map<string, Handoff>();
let handoffBytes = 0;

function rememberFailure(key: string, error: SourceAudioDecodeChainError): void {
  failures.delete(key);
  failures.set(key, { error, expiresAt: Date.now() + SHARED_SOURCE_DECODE_FAILURE_TTL_MS });
  while (failures.size > MAX_REMEMBERED_FAILURES) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}

function rememberedFailure(key: string): SourceAudioDecodeChainError | null {
  const entry = failures.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    failures.delete(key);
    return null;
  }
  return entry.error;
}

function dropHandoff(key: string): void {
  const entry = handoffs.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  handoffs.delete(key);
  handoffBytes -= entry.pcmBytes;
}

function offerHandoff(key: string, result: SourceAudioDecodeResult): void {
  const { buffer } = result;
  const pcmBytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isFinite(pcmBytes) || pcmBytes > SHARED_SOURCE_DECODE_HANDOFF_MAX_PCM_BYTES) return;
  dropHandoff(key);
  while (handoffs.size > 0 && handoffBytes + pcmBytes > SHARED_SOURCE_DECODE_HANDOFF_MAX_PCM_BYTES) {
    const oldest = handoffs.keys().next().value;
    if (oldest === undefined) break;
    dropHandoff(oldest);
  }
  const timer = setTimeout(() => dropHandoff(key), SHARED_SOURCE_DECODE_HANDOFF_TTL_MS);
  handoffs.set(key, { result, pcmBytes, timer });
  handoffBytes += pcmBytes;
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
 * Decodes the whole source through the ordered decode chain, shared with every
 * other caller decoding the same content. Reused failures rethrow the original
 * error object, so callers classify it exactly as if they had decoded it themselves.
 */
export async function decodeSourceAudioShared(
  file: File,
  options: SharedSourceAudioDecodeOptions,
): Promise<SourceAudioDecodeResult> {
  const { signal } = options;
  const attempts = [options.browserAttempt, ...(options.fallbackAttempts ?? SOURCE_AUDIO_FALLBACK_DECODE_ATTEMPTS)];
  signal?.throwIfAborted();
  const key = await sourceAudioDecodeIdentity(file);
  signal?.throwIfAborted();
  if (!key) return decodeSourceAudioWithFallbacks(file, attempts, signal);
  return decodeWithKey(file, key, attempts, options);
}

async function decodeWithKey(
  file: File,
  key: string,
  attempts: readonly SourceAudioDecodeAttempt[],
  options: SharedSourceAudioDecodeOptions,
): Promise<SourceAudioDecodeResult> {
  const { signal } = options;
  const handoff = handoffs.get(key);
  if (handoff) {
    log.debug('Reusing the decoded audio of this source', { file: file.name, decoderId: handoff.result.decoderId });
    return handoff.result;
  }

  if (options.retryRememberedFailure) {
    failures.delete(key);
  } else {
    const knownFailure = rememberedFailure(key);
    if (knownFailure) {
      log.debug('Reusing the decode failure of this source instead of decoding it again', {
        file: file.name,
        message: knownFailure.message,
      });
      throw knownFailure;
    }
  }

  const current = running.get(key);
  if (current) {
    try {
      return await raceSignal(current.promise, signal);
    } catch (error) {
      if (signal?.aborted || !current.ownerSignal?.aborted) throw error;
      // The owning caller was cancelled; this caller still wants the audio.
      if (running.get(key) === current) running.delete(key);
      return decodeWithKey(file, key, attempts, options);
    }
  }

  const entry: RunningDecode = {
    promise: decodeSourceAudioWithFallbacks(file, attempts, signal),
    ownerSignal: signal,
  };
  running.set(key, entry);
  try {
    const result = await entry.promise;
    offerHandoff(key, result);
    return result;
  } catch (error) {
    if (!signal?.aborted && isDurableSourceAudioDecodeFailure(error)) rememberFailure(key, error);
    throw error;
  } finally {
    if (running.get(key) === entry) running.delete(key);
  }
}

/** Test hook: forgets running chains, handoff buffers and remembered failures. */
export function clearSharedSourceAudioDecodeState(): void {
  running.clear();
  failures.clear();
  for (const key of [...handoffs.keys()]) dropHandoff(key);
}
