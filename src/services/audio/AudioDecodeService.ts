import { Logger } from '../logger';
import type { SignalMetadata } from '../../signals/types';
import {
  AUDIO_DECODE_SCHEMA_VERSION,
  type AudioDecodeErrorCode,
  type AudioDecodeChannelLayout,
  type AudioDecodeJobHandle,
  type AudioDecodeJobSnapshot,
  type AudioDecodeProgress,
  type AudioDecodeProgressPhase,
  type AudioDecodeRequest,
  type AudioDecodeResult,
  type AudioDecodeRuntime,
  type AudioDecodeRuntimeCanDecodeContext,
  type AudioDecodeRuntimeContext,
  type AudioDecodeRuntimeResult,
  type AudioDecodeSource,
  type AudioDecodeSourceInfo,
  type AudioDecodeWarning,
} from './audioDecodeTypes';

const log = Logger.create('AudioDecodeService');

const BYTES_PER_FLOAT32_SAMPLE = 4;
const MEBIBYTE = 1024 * 1024;

export const BROWSER_AUDIO_DECODE_DECODER_ID = 'browser.decodeAudioData';
export const BROWSER_AUDIO_DECODE_DECODER_VERSION = '1.0.0';

export const DEFAULT_BROWSER_AUDIO_DECODE_LIMITS = {
  maxSourceBytes: 256 * MEBIBYTE,
  maxDecodedPcmBytes: 768 * MEBIBYTE,
} as const;

export interface BrowserAudioDecodeLimits {
  maxSourceBytes: number;
  maxDecodedPcmBytes: number;
}

export interface BrowserAudioDecodeRuntimeOptions {
  limits?: Partial<BrowserAudioDecodeLimits>;
  createAudioContext?: () => AudioContext;
}

export interface AudioDecodeServiceOptions extends BrowserAudioDecodeRuntimeOptions {
  runtimes?: AudioDecodeRuntime[];
  enableBrowserFallback?: boolean;
  now?: () => string;
  createJobId?: () => string;
}

interface MutableJobState {
  snapshot: AudioDecodeJobSnapshot;
  controller: AbortController;
  lastPercent: number;
}

type TerminalJobStatus = Extract<AudioDecodeJobSnapshot['status'], 'completed' | 'cancelled' | 'failed'>;

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

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultJobId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `audio-decode:${randomId}`;
}

function clampPercent(
  value: number | undefined,
  previous: number,
  phase: AudioDecodeProgressPhase,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return previous;
  }

  if (phase === 'failed' || phase === 'cancelled') {
    return Math.min(100, Math.max(0, value));
  }

  const maxPercent = phase === 'complete' ? 100 : 99;
  return Math.max(previous, Math.min(maxPercent, Math.max(0, value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is AudioDecodeServiceError {
  return error instanceof AudioDecodeServiceError && error.code === 'cancelled';
}

function decodeCancelledError(jobId: string, reason?: unknown): AudioDecodeServiceError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new AudioDecodeServiceError(`Audio decode job ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function throwIfSignalCancelled(signal: AbortSignal, jobId: string): void {
  if (signal.aborted) {
    throw decodeCancelledError(jobId, getAbortReason(signal));
  }
}

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodedPcmBytes(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * BYTES_PER_FLOAT32_SAMPLE;
}

function normalizeByteLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function isTerminalStatus(status: AudioDecodeJobSnapshot['status']): status is TerminalJobStatus {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

function terminalPhaseForStatus(status: TerminalJobStatus): AudioDecodeProgressPhase {
  switch (status) {
    case 'completed':
      return 'complete';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
  }
}

function formatSourceInfo(sourceInfo: AudioDecodeSourceInfo): string {
  const parts = [
    `${sourceInfo.kind} source`,
    `${sourceInfo.size} bytes`,
    sourceInfo.name ? `name=${sourceInfo.name}` : undefined,
    sourceInfo.mimeType ? `mime=${sourceInfo.mimeType}` : undefined,
  ].filter(Boolean);

  return parts.join(', ');
}

function cloneMetadata(metadata?: SignalMetadata): SignalMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(metadata)) as SignalMetadata;
}

function cloneWarning(warning: AudioDecodeWarning): AudioDecodeWarning {
  return {
    ...warning,
    details: cloneMetadata(warning.details),
  };
}

function describeChannelLayout(channelCount: number): AudioDecodeChannelLayout {
  if (channelCount === 1) {
    return { kind: 'mono', channelCount, labels: ['M'] };
  }

  if (channelCount === 2) {
    return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  }

  if (channelCount > 2 && channelCount <= 8) {
    return { kind: 'surround', channelCount };
  }

  if (channelCount > 8) {
    return { kind: 'discrete', channelCount };
  }

  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

function fallbackWarning(runtime: AudioDecodeRuntime): AudioDecodeWarning {
  return {
    code: 'decode-fallback',
    message: 'Decoded audio with the bounded browser AudioContext fallback.',
    details: {
      decoderId: runtime.id,
      decoderVersion: runtime.version,
    },
  };
}

function validateAudioBuffer(
  buffer: AudioBuffer,
  jobId: string,
  runtime: AudioDecodeRuntime,
): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new AudioDecodeServiceError(`Decoder ${runtime.id} returned no AudioBuffer.`, {
      code: 'invalid-decode-result',
      jobId,
      recoverable: false,
    });
  }

  const { numberOfChannels, sampleRate, length, duration } = buffer;
  const fields = [numberOfChannels, sampleRate, length, duration];

  if (!fields.every((value) => typeof value === 'number' && Number.isFinite(value))
    || !Number.isInteger(numberOfChannels)
    || numberOfChannels <= 0
    || sampleRate <= 0
    || !Number.isInteger(length)
    || length < 0
    || duration < 0) {
    throw new AudioDecodeServiceError(`Decoder ${runtime.id} returned invalid AudioBuffer metadata.`, {
      code: 'invalid-decode-result',
      jobId,
      recoverable: false,
    });
  }

  const pcmBytes = decodedPcmBytes(buffer);
  if (!Number.isSafeInteger(pcmBytes) || pcmBytes < 0) {
    throw new AudioDecodeServiceError(`Decoder ${runtime.id} returned an AudioBuffer with unsafe PCM byte size.`, {
      code: 'invalid-decode-result',
      jobId,
      recoverable: false,
    });
  }
}

function enforceDecodedPcmLimit(
  pcmBytes: number,
  limit: number,
  jobId: string,
  runtime: AudioDecodeRuntime,
): void {
  if (pcmBytes <= limit) {
    return;
  }

  throw new AudioDecodeServiceError(
    `Decoder ${runtime.id} produced ${pcmBytes} PCM bytes, above the ${limit} byte limit.`,
    {
      code: runtime.kind === 'browser-fallback'
        ? 'browser-fallback-output-too-large'
        : 'decode-output-too-large',
      jobId,
    },
  );
}

function normalizeBrowserLimits(
  limits?: Partial<BrowserAudioDecodeLimits>,
): BrowserAudioDecodeLimits {
  return {
    maxSourceBytes: normalizeByteLimit(
      limits?.maxSourceBytes,
      DEFAULT_BROWSER_AUDIO_DECODE_LIMITS.maxSourceBytes,
    ),
    maxDecodedPcmBytes: normalizeByteLimit(
      limits?.maxDecodedPcmBytes,
      DEFAULT_BROWSER_AUDIO_DECODE_LIMITS.maxDecodedPcmBytes,
    ),
  };
}

export function getAudioDecodeSourceInfo(source: AudioDecodeSource): AudioDecodeSourceInfo {
  switch (source.kind) {
    case 'file':
      return {
        kind: 'file',
        size: source.file.size,
        name: source.file.name,
        mimeType: source.file.type || undefined,
      };
    case 'blob':
      return {
        kind: 'blob',
        size: source.blob.size,
        name: source.name,
        mimeType: source.mimeType ?? (source.blob.type || undefined),
      };
    case 'array-buffer':
      return {
        kind: 'array-buffer',
        size: source.arrayBuffer.byteLength,
        name: source.name,
        mimeType: source.mimeType,
      };
    case 'bytes':
      return {
        kind: 'bytes',
        size: source.bytes.byteLength,
        name: source.name,
        mimeType: source.mimeType,
      };
  }
}

export async function readAudioDecodeSourceBytes(source: AudioDecodeSource): Promise<ArrayBuffer> {
  switch (source.kind) {
    case 'file':
      return source.file.arrayBuffer();
    case 'blob':
      return source.blob.arrayBuffer();
    case 'array-buffer':
      return cloneArrayBuffer(source.arrayBuffer);
    case 'bytes':
      return bytesToArrayBuffer(source.bytes);
  }
}

export function createBrowserAudioDecodeRuntime(
  options: BrowserAudioDecodeRuntimeOptions = {},
): AudioDecodeRuntime {
  const limits = normalizeBrowserLimits(options.limits);
  let audioContext: AudioContext | null = null;

  const getContext = (): AudioContext => {
    if (audioContext) {
      return audioContext;
    }

    if (options.createAudioContext) {
      audioContext = options.createAudioContext();
      return audioContext;
    }

    if (typeof AudioContext === 'undefined') {
      throw new AudioDecodeServiceError('Browser AudioContext is not available for fallback decoding.', {
        code: 'browser-fallback-unavailable',
        jobId: 'unassigned',
      });
    }

    audioContext = new AudioContext();
    return audioContext;
  };

  const runtime: AudioDecodeRuntime = {
    id: BROWSER_AUDIO_DECODE_DECODER_ID,
    version: BROWSER_AUDIO_DECODE_DECODER_VERSION,
    kind: 'browser-fallback',
    canDecode: (_request, context) => {
      if (context.sourceInfo.size > limits.maxSourceBytes) {
        return false;
      }

      return Boolean(options.createAudioContext || typeof AudioContext !== 'undefined');
    },
    decode: async (_request, context) => {
      if (context.sourceInfo.size > limits.maxSourceBytes) {
        throw new AudioDecodeServiceError(
          `Browser audio fallback is limited to ${limits.maxSourceBytes} bytes; source is ${context.sourceInfo.size} bytes.`,
          {
            code: 'browser-fallback-source-too-large',
            jobId: context.jobId,
          },
        );
      }

      context.throwIfCancelled();
      context.reportProgress({ phase: 'reading', percent: 5, message: 'Reading audio source' });
      const sourceBytes = await context.readSourceBytes();
      context.throwIfCancelled();
      context.reportProgress({ phase: 'decoding', percent: 20, message: 'Decoding with browser AudioContext' });

      const decoded = await getContext().decodeAudioData(cloneArrayBuffer(sourceBytes));
      context.throwIfCancelled();

      validateAudioBuffer(decoded, context.jobId, runtime);
      const pcmBytes = decodedPcmBytes(decoded);
      enforceDecodedPcmLimit(pcmBytes, limits.maxDecodedPcmBytes, context.jobId, runtime);

      context.reportProgress({ phase: 'finalizing', percent: 95, message: 'Finalizing decoded audio' });
      return { buffer: decoded };
    },
    dispose: () => {
      const closingContext = audioContext;
      audioContext = null;
      closingContext?.close().catch(() => {});
    },
  };

  return runtime;
}

export class AudioDecodeService {
  private readonly runtimes: AudioDecodeRuntime[];
  private readonly browserFallback: AudioDecodeRuntime | null;
  private readonly browserFallbackLimits: BrowserAudioDecodeLimits;
  private readonly now: () => string;
  private readonly createJobId: () => string;
  private readonly jobs = new Map<string, MutableJobState>();
  private readonly activeJobIds = new Set<string>();

  constructor(options: AudioDecodeServiceOptions = {}) {
    this.runtimes = options.runtimes ?? [];
    this.browserFallbackLimits = normalizeBrowserLimits(options.limits);
    this.browserFallback = options.enableBrowserFallback === false
      ? null
      : createBrowserAudioDecodeRuntime({
        limits: this.browserFallbackLimits,
        createAudioContext: options.createAudioContext,
      });
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  runDecodeJob(
    request: AudioDecodeRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: AudioDecodeProgress) => void;
    } = {},
  ): AudioDecodeJobHandle {
    const jobId = request.jobId ?? this.createJobId();
    const sourceInfo = getAudioDecodeSourceInfo(request.source);
    const controller = new AbortController();
    const createdAt = this.now();
    const initialProgress = this.createProgress(request, jobId, 'queued', 0, createdAt);

    const state: MutableJobState = {
      controller,
      lastPercent: 0,
      snapshot: {
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        status: 'queued',
        progress: initialProgress,
        createdAt,
        updatedAt: createdAt,
      },
    };

    this.jobs.set(jobId, state);
    this.activeJobIds.add(jobId);

    const abortFromExternal = () => controller.abort(getAbortReason(options.signal!));
    if (options.signal) {
      if (options.signal.aborted) {
        abortFromExternal();
      } else {
        options.signal.addEventListener('abort', abortFromExternal, { once: true });
      }
    }

    const promise = this.executeJob(request, sourceInfo, controller.signal, state, options.onProgress)
      .finally(() => {
        options.signal?.removeEventListener('abort', abortFromExternal);
        this.activeJobIds.delete(jobId);
      });

    return {
      jobId,
      signal: controller.signal,
      promise,
      cancel: (reason?: unknown) => controller.abort(reason),
    };
  }

  getJobSnapshot(jobId: string): AudioDecodeJobSnapshot | null {
    const state = this.jobs.get(jobId);
    return state ? { ...state.snapshot, progress: { ...state.snapshot.progress } } : null;
  }

  getActiveJobIds(): string[] {
    return [...this.activeJobIds];
  }

  cancelJob(jobId: string, reason?: unknown): boolean {
    if (!this.activeJobIds.has(jobId)) {
      return false;
    }

    const state = this.jobs.get(jobId);
    state?.controller.abort(reason);
    if (state?.snapshot.progress) {
      state.snapshot.progress = {
        ...state.snapshot.progress,
        message: reason === undefined ? 'Cancelled' : String(reason),
      };
    }

    return true;
  }

  dispose(): void {
    for (const jobId of this.activeJobIds) {
      this.jobs.get(jobId)?.controller.abort('AudioDecodeService disposed');
    }

    for (const runtime of this.runtimes) {
      runtime.dispose?.();
    }
    this.browserFallback?.dispose?.();
    this.activeJobIds.clear();
  }

  private async executeJob(
    request: AudioDecodeRequest,
    sourceInfo: AudioDecodeSourceInfo,
    signal: AbortSignal,
    state: MutableJobState,
    onProgress?: (progress: AudioDecodeProgress) => void,
  ): Promise<AudioDecodeResult> {
    const jobId = state.snapshot.jobId;
    const startedAt = this.now();

    try {
      this.emitProgress(request, state, onProgress, {
        phase: 'queued',
        percent: 0,
        timestamp: startedAt,
      });
      throwIfSignalCancelled(signal, jobId);

      const runtime = await this.selectRuntime(request, sourceInfo, signal, jobId);
      state.snapshot.status = 'running';
      state.snapshot.runtimeId = runtime.id;

      this.emitProgress(request, state, onProgress, {
        phase: 'decoding',
        percent: 1,
        runtimeId: runtime.id,
        timestamp: this.now(),
      });

      const runtimeContext = this.createRuntimeContext(request, sourceInfo, signal, state, runtime, onProgress, startedAt);
      const runtimeResult = await this.runRuntimeDecode(request, runtime, runtimeContext, signal, jobId);
      throwIfSignalCancelled(signal, jobId);

      validateAudioBuffer(runtimeResult.buffer, jobId, runtime);
      const pcmBytes = decodedPcmBytes(runtimeResult.buffer);
      enforceDecodedPcmLimit(pcmBytes, this.browserFallbackLimits.maxDecodedPcmBytes, jobId, runtime);
      const completedAt = this.now();
      const warnings = this.collectWarnings(runtime, runtimeResult);
      const metadata = {
        schemaVersion: AUDIO_DECODE_SCHEMA_VERSION,
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: runtime.id,
        decoderVersion: runtime.version,
        runtimeKind: runtime.kind,
        fallbackUsed: runtime.kind === 'browser-fallback',
        source: sourceInfo,
        sampleRate: runtimeResult.buffer.sampleRate,
        channelLayout: describeChannelLayout(runtimeResult.buffer.numberOfChannels),
        duration: runtimeResult.buffer.duration,
        length: runtimeResult.buffer.length,
        decodedPcmBytes: pcmBytes,
        startedAt,
        completedAt,
        warnings: warnings.length > 0 ? warnings : undefined,
        requestMetadata: cloneMetadata(request.metadata),
        runtimeMetadata: cloneMetadata(runtimeResult.metadata),
      };

      state.snapshot.status = 'completed';
      this.emitProgress(request, state, onProgress, {
        phase: 'complete',
        percent: 100,
        runtimeId: runtime.id,
        timestamp: completedAt,
      });

      return {
        jobId,
        mediaFileId: request.mediaFileId,
        buffer: runtimeResult.buffer,
        metadata,
        warnings,
      };
    } catch (error) {
      if (isCancellationError(error) || signal.aborted) {
        const cancelledError = isCancellationError(error)
          ? error
          : decodeCancelledError(jobId, getAbortReason(signal));
        state.snapshot.status = 'cancelled';
        state.snapshot.errorCode = cancelledError.code;
        state.snapshot.errorMessage = cancelledError.message;
        this.emitProgress(request, state, onProgress, {
          phase: 'cancelled',
          percent: state.lastPercent,
          timestamp: this.now(),
          message: cancelledError.message,
        });
        throw cancelledError;
      }

      const serviceError = error instanceof AudioDecodeServiceError
        ? error
        : new AudioDecodeServiceError(`Audio decode job ${jobId} failed: ${errorMessage(error)}`, {
          code: 'decode-failed',
          jobId,
          cause: error,
        });

      state.snapshot.status = 'failed';
      state.snapshot.errorCode = serviceError.code;
      state.snapshot.errorMessage = serviceError.message;
      this.emitProgress(request, state, onProgress, {
        phase: 'failed',
        percent: state.lastPercent,
        timestamp: this.now(),
        message: serviceError.message,
      });
      log.warn('Audio decode job failed', {
        jobId,
        mediaFileId: request.mediaFileId,
        code: serviceError.code,
        message: serviceError.message,
      });
      throw serviceError;
    }
  }

  private async selectRuntime(
    request: AudioDecodeRequest,
    sourceInfo: AudioDecodeSourceInfo,
    signal: AbortSignal,
    jobId: string,
  ): Promise<AudioDecodeRuntime> {
      const context: AudioDecodeRuntimeCanDecodeContext = {
      jobId,
      sourceInfo,
      signal,
    };

    for (const runtime of this.runtimes) {
      throwIfSignalCancelled(signal, jobId);
      const supported = runtime.canDecode
        ? await this.runRuntimeProbe(request, runtime, context, signal, jobId)
        : true;
      if (supported) {
        return runtime;
      }
    }

    if (this.browserFallback) {
      if (sourceInfo.size > this.browserFallbackLimits.maxSourceBytes) {
        throw new AudioDecodeServiceError(
          `Browser audio fallback is limited to ${this.browserFallbackLimits.maxSourceBytes} bytes; source is ${sourceInfo.size} bytes.`,
          {
            code: 'browser-fallback-source-too-large',
            jobId,
          },
        );
      }

      const fallbackSupported = this.browserFallback.canDecode
        ? await this.runRuntimeProbe(request, this.browserFallback, context, signal, jobId)
        : true;
      if (fallbackSupported) {
        return this.browserFallback;
      }

      throw new AudioDecodeServiceError('Browser AudioContext is not available for fallback decoding.', {
        code: 'browser-fallback-unavailable',
        jobId,
      });
    }

    throw new AudioDecodeServiceError(
      `No audio decode runtime is available for ${formatSourceInfo(sourceInfo)}.`,
      {
        code: this.browserFallback ? 'browser-fallback-unavailable' : 'no-decoder-available',
        jobId,
      },
    );
  }

  private async runRuntimeProbe(
    request: AudioDecodeRequest,
    runtime: AudioDecodeRuntime,
    context: AudioDecodeRuntimeCanDecodeContext,
    signal: AbortSignal,
    jobId: string,
  ): Promise<boolean> {
    try {
      return await this.raceWithCancellation(
        Promise.resolve(runtime.canDecode?.(request, context) ?? true),
        signal,
        jobId,
      );
    } catch (error) {
      if (isCancellationError(error)) {
        throw error;
      }

      throw new AudioDecodeServiceError(
        `Audio decode runtime ${runtime.id} failed while checking support for ${formatSourceInfo(context.sourceInfo)}: ${errorMessage(error)}`,
        {
          code: 'runtime-probe-failed',
          jobId,
          cause: error,
        },
      );
    }
  }

  private async runRuntimeDecode(
    request: AudioDecodeRequest,
    runtime: AudioDecodeRuntime,
    context: AudioDecodeRuntimeContext,
    signal: AbortSignal,
    jobId: string,
  ): Promise<AudioDecodeRuntimeResult> {
    try {
      return await this.raceWithCancellation(
        runtime.decode(request, context),
        signal,
        jobId,
      );
    } catch (error) {
      if (isCancellationError(error) || error instanceof AudioDecodeServiceError) {
        throw error;
      }

      throw new AudioDecodeServiceError(
        `Audio decode runtime ${runtime.id} failed for ${formatSourceInfo(context.sourceInfo)}: ${errorMessage(error)}`,
        {
          code: 'decode-failed',
          jobId,
          cause: error,
        },
      );
    }
  }

  private createRuntimeContext(
    request: AudioDecodeRequest,
    sourceInfo: AudioDecodeSourceInfo,
    signal: AbortSignal,
    state: MutableJobState,
    runtime: AudioDecodeRuntime,
    onProgress: ((progress: AudioDecodeProgress) => void) | undefined,
    startedAt: string,
  ): AudioDecodeRuntimeContext {
    return {
      jobId: state.snapshot.jobId,
      sourceInfo,
      signal,
      startedAt,
      now: this.now,
      reportProgress: (progress) => {
        if (signal.aborted || isTerminalStatus(state.snapshot.status)) {
          return;
        }

        this.emitProgress(request, state, onProgress, {
          ...progress,
          runtimeId: runtime.id,
          timestamp: this.now(),
        });
      },
      readSourceBytes: async () => {
        try {
          return await readAudioDecodeSourceBytes(request.source);
        } catch (error) {
          throw new AudioDecodeServiceError(`Failed to read audio source: ${errorMessage(error)}`, {
            code: 'source-read-failed',
            jobId: state.snapshot.jobId,
            cause: error,
          });
        }
      },
      throwIfCancelled: () => throwIfSignalCancelled(signal, state.snapshot.jobId),
    };
  }

  private collectWarnings(
    runtime: AudioDecodeRuntime,
    result: AudioDecodeRuntimeResult,
  ): AudioDecodeWarning[] {
    const warnings = (result.warnings ?? []).map(cloneWarning);
    if (runtime.kind === 'browser-fallback') {
      warnings.unshift(fallbackWarning(runtime));
    }
    return warnings;
  }

  private createProgress(
    request: AudioDecodeRequest,
    jobId: string,
    phase: AudioDecodeProgressPhase,
    percent: number,
    timestamp: string,
  ): AudioDecodeProgress {
    return {
      jobId,
      mediaFileId: request.mediaFileId,
      sourceFingerprint: request.sourceFingerprint,
      phase,
      percent,
      timestamp,
    };
  }

  private emitProgress(
    request: AudioDecodeRequest,
    state: MutableJobState,
    onProgress: ((progress: AudioDecodeProgress) => void) | undefined,
    update: {
      phase?: AudioDecodeProgressPhase;
      percent?: number;
      timestamp: string;
      runtimeId?: string;
      message?: string;
    },
  ): void {
    const phase = update.phase ?? state.snapshot.progress.phase;
    if (
      isTerminalStatus(state.snapshot.status)
      && terminalPhaseForStatus(state.snapshot.status) !== phase
    ) {
      return;
    }

    const percent = clampPercent(update.percent, state.lastPercent, phase);

    state.lastPercent = percent;
    const progress: AudioDecodeProgress = {
      ...state.snapshot.progress,
      jobId: state.snapshot.jobId,
      mediaFileId: request.mediaFileId,
      sourceFingerprint: request.sourceFingerprint,
      phase,
      percent,
      timestamp: update.timestamp,
      runtimeId: update.runtimeId ?? state.snapshot.runtimeId,
      message: update.message,
    };

    state.snapshot.progress = progress;
    state.snapshot.updatedAt = update.timestamp;
    onProgress?.(progress);
  }

  private raceWithCancellation<T>(
    work: Promise<T>,
    signal: AbortSignal,
    jobId: string,
  ): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(decodeCancelledError(jobId, getAbortReason(signal)));
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(decodeCancelledError(jobId, getAbortReason(signal)));
      signal.addEventListener('abort', onAbort, { once: true });

      work.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }
}
