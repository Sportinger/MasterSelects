import { Logger } from '../logger';
import type { SignalMetadata } from '../../signals/types';
import {
  AUDIO_DECODE_SCHEMA_VERSION,
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
import {
  createBrowserAudioDecodeRuntime,
  normalizeBrowserLimits,
  type BrowserAudioDecodeLimits,
  type BrowserAudioDecodeRuntimeOptions,
} from './decode/browserFallbackRuntime';
import {
  AudioDecodeServiceError,
  decodeCancelledError,
  errorMessage,
  getAbortReason,
  isCancellationError,
  throwIfSignalCancelled,
} from './decode/errors';
import {
  cloneMetadata,
  cloneWarning,
  decodedPcmBytes,
  describeChannelLayout,
  enforceDecodedPcmLimit,
  fallbackWarning,
  validateAudioBuffer,
} from './decode/resultMapping';
import {
  createSourceFingerprint,
  formatSourceInfo,
  getAudioDecodeSourceInfo,
  readAudioDecodeSourceBytes,
} from './decode/source';

const log = Logger.create('AudioDecodeService');

export {
  BROWSER_AUDIO_DECODE_DECODER_ID,
  BROWSER_AUDIO_DECODE_DECODER_VERSION,
  DEFAULT_BROWSER_AUDIO_DECODE_LIMITS,
  createBrowserAudioDecodeRuntime,
  type BrowserAudioDecodeLimits,
  type BrowserAudioDecodeRuntimeOptions,
} from './decode/browserFallbackRuntime';
export { AudioDecodeServiceError } from './decode/errors';
export {
  getAudioDecodeSourceInfo,
  readAudioDecodeSourceBytes,
} from './decode/source';

export interface AudioDecodeServiceOptions extends BrowserAudioDecodeRuntimeOptions {
  runtimes?: AudioDecodeRuntime[];
  enableBrowserFallback?: boolean;
  now?: () => string;
  createJobId?: () => string;
}

export interface DecodeAudioBufferOptions {
  jobId?: string;
  mediaFileId?: string;
  sourceFingerprint?: string;
  clipAudioStateHash?: string;
  targetSampleRate?: number;
  metadata?: SignalMetadata;
  signal?: AbortSignal;
  onProgress?: (progress: AudioDecodeProgress) => void;
}

interface MutableJobState {
  snapshot: AudioDecodeJobSnapshot;
  controller: AbortController;
  lastPercent: number;
}

type TerminalJobStatus = Extract<AudioDecodeJobSnapshot['status'], 'completed' | 'cancelled' | 'failed'>;

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

  async decodeAudioBuffer(
    source: AudioDecodeSource,
    options: DecodeAudioBufferOptions = {},
  ): Promise<AudioBuffer> {
    const sourceInfo = getAudioDecodeSourceInfo(source);
    const request: AudioDecodeRequest = {
      jobId: options.jobId,
      mediaFileId: options.mediaFileId ?? sourceInfo.name ?? `${sourceInfo.kind}:${sourceInfo.size}`,
      sourceFingerprint: options.sourceFingerprint ?? createSourceFingerprint(sourceInfo),
      source,
      clipAudioStateHash: options.clipAudioStateHash,
      targetSampleRate: options.targetSampleRate,
      metadata: options.metadata,
    };

    const result = await this.runDecodeJob(request, {
      signal: options.signal,
      onProgress: options.onProgress,
    }).promise;
    return result.buffer;
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
      const failureDetails = {
        jobId,
        mediaFileId: request.mediaFileId,
        code: serviceError.code,
        message: serviceError.message,
      };
      // An undecodable source is the caller's to explain (waveform, proxy, analyzer all
      // receive this error); every other failure code is unexpected here.
      if (serviceError.code === 'decode-failed') {
        log.debug('Audio decode job failed', failureDetails);
      } else {
        log.warn('Audio decode job failed', failureDetails);
      }
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

interface AudioDecodeServiceGlobal {
  __masterselectsAudioDecodeService?: AudioDecodeService | null;
  __masterselectsAudioDecodeServiceBeforeUnloadHandler?: () => void;
}

function getAudioDecodeServiceGlobal(): AudioDecodeServiceGlobal {
  return globalThis as typeof globalThis & AudioDecodeServiceGlobal;
}

function ensureSharedAudioDecodeServiceCleanup(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const globalState = getAudioDecodeServiceGlobal();
  if (globalState.__masterselectsAudioDecodeServiceBeforeUnloadHandler) {
    return;
  }

  globalState.__masterselectsAudioDecodeServiceBeforeUnloadHandler = () => {
    disposeSharedAudioDecodeService();
  };
  window.addEventListener('beforeunload', globalState.__masterselectsAudioDecodeServiceBeforeUnloadHandler);
}

export function getSharedAudioDecodeService(): AudioDecodeService {
  const globalState = getAudioDecodeServiceGlobal();
  if (!globalState.__masterselectsAudioDecodeService) {
    globalState.__masterselectsAudioDecodeService = new AudioDecodeService({
      limits: {
        maxSourceBytes: Number.MAX_SAFE_INTEGER,
        maxDecodedPcmBytes: Number.MAX_SAFE_INTEGER,
      },
    });
  }
  ensureSharedAudioDecodeServiceCleanup();
  return globalState.__masterselectsAudioDecodeService;
}

export function disposeSharedAudioDecodeService(): void {
  const globalState = getAudioDecodeServiceGlobal();
  globalState.__masterselectsAudioDecodeService?.dispose();
  globalState.__masterselectsAudioDecodeService = null;
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
