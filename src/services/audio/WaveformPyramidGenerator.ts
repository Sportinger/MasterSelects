import { sha256ArrayBuffer } from '../../artifacts';
import type { JsonValue, SignalMetadata } from '../../signals';
import {
  createAudioAnalysisManifestRefFromArtifact,
  createAudioAnalysisCacheKey,
  type AudioAnalysisManifestRef,
} from './audioAnalysisManifestKeys';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type {
  AudioAnalysisArtifact,
  AudioAnalysisArtifactKind,
  AudioAnalysisWarning,
  AudioArtifactRef,
  AudioChannelLayout,
} from './audioArtifactTypes';
import {
  DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES,
  createWaveformPyramidManifest,
  type WaveformStatistic,
  type WaveformPyramidData,
  type WaveformPyramidManifest,
} from './waveformPyramidManifest';
import { normalizeBucketSizes } from './waveformPyramid/bucketMath';
import {
  createPyramidDataFromLevelStats,
  createWaveformPyramidAnalyzerVersion as buildWaveformPyramidAnalyzerVersion,
  generateWaveformLevelStats,
} from './waveformPyramid/pyramidAssembly';
import {
  WAVEFORM_PACKED_PAYLOAD_MIME_TYPE,
  storeWaveformPyramidPayloads,
} from './waveformPyramid/payloadEncoding';
import type { WaveformPyramidAnalysisContext } from './waveformPyramid/waveformPyramidAnalysisTypes';

export const WAVEFORM_PYRAMID_GENERATOR_VERSION = 'masterselects.waveform-pyramid-generator@1.0.0';
export const WAVEFORM_STAT_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.waveform-stat';
export { WAVEFORM_PACKED_PAYLOAD_MIME_TYPE };

export type WaveformPyramidGenerationPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type WaveformPyramidGeneratorErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-levels'
  | 'artifact-store-failed';

export interface WaveformPyramidGenerationProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: WaveformPyramidGenerationPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  levelIndex?: number;
  channelIndex?: number;
  samplesPerBucket?: number;
  statistic?: WaveformStatistic;
  message?: string;
}

export interface WaveformPyramidGeneratorOptions {
  artifactStore: AudioArtifactStore;
  bucketSizes?: readonly number[];
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface WaveformPyramidGenerateRequest {
  jobId?: string;
  kind?: Extract<AudioAnalysisArtifactKind, 'waveform-pyramid' | 'processed-waveform-pyramid'>;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  channelLayout?: AudioChannelLayout;
  bucketSizes?: readonly number[];
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface WaveformPyramidStoreRequest {
  jobId?: string;
  kind?: Extract<AudioAnalysisArtifactKind, 'waveform-pyramid' | 'processed-waveform-pyramid'>;
  mediaFileId: string;
  sourceFingerprint: string;
  pyramid: WaveformPyramidData;
  clipAudioStateHash?: string;
  channelLayout?: AudioChannelLayout;
  bucketSizes?: readonly number[];
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface WaveformPyramidGenerationResult {
  jobId: string;
  cacheKey: string;
  analysisRef: AudioAnalysisManifestRef;
  artifact: AudioAnalysisArtifact;
  manifest: WaveformPyramidManifest;
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}

const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export class WaveformPyramidGeneratorError extends Error {
  readonly code: WaveformPyramidGeneratorErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: WaveformPyramidGeneratorErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'WaveformPyramidGenerationCancelledError'
      : 'WaveformPyramidGeneratorError';
    this.code = options.code;
    this.jobId = options.jobId;
    this.recoverable = options.recoverable ?? options.code !== 'invalid-audio-buffer';
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultJobId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `waveform-pyramid:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): WaveformPyramidGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new WaveformPyramidGeneratorError(`Waveform pyramid generation ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is WaveformPyramidGeneratorError {
  return error instanceof WaveformPyramidGeneratorError && error.code === 'cancelled';
}

function throwIfCancelled(signal: AbortSignal | undefined, jobId: string): void {
  if (signal?.aborted) {
    throw cancelledError(jobId, getAbortReason(signal));
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function describeChannelLayout(channelCount: number): AudioChannelLayout {
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

function validateChannelLayout(
  layout: AudioChannelLayout,
  buffer: AudioBuffer,
  jobId: string,
): AudioChannelLayout {
  if (!Number.isInteger(layout.channelCount) || layout.channelCount !== buffer.numberOfChannels) {
    throw new WaveformPyramidGeneratorError(
      'Waveform pyramid channelLayout.channelCount must match the AudioBuffer channel count.',
      {
        code: 'invalid-audio-buffer',
        jobId,
        recoverable: false,
      },
    );
  }

  return {
    kind: layout.kind,
    channelCount: layout.channelCount,
    ...(layout.labels ? { labels: [...layout.labels] } : {}),
  };
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new WaveformPyramidGeneratorError('Waveform pyramid generation requires an AudioBuffer.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }

  if (
    !Number.isInteger(buffer.numberOfChannels)
    || buffer.numberOfChannels < 1
    || !Number.isInteger(buffer.length)
    || buffer.length < 0
    || !finiteNumber(buffer.sampleRate)
    || buffer.sampleRate <= 0
    || !finiteNumber(buffer.duration)
    || buffer.duration < 0
    || typeof buffer.getChannelData !== 'function'
  ) {
    throw new WaveformPyramidGeneratorError('AudioBuffer metadata is invalid for waveform pyramid generation.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
}

function validatePyramidData(pyramid: WaveformPyramidData, jobId: string): void {
  if (
    !pyramid ||
    typeof pyramid !== 'object' ||
    !finiteNumber(pyramid.sampleRate) ||
    pyramid.sampleRate <= 0 ||
    !finiteNumber(pyramid.duration) ||
    pyramid.duration < 0 ||
    !Array.isArray(pyramid.levels) ||
    pyramid.levels.length === 0
  ) {
    throw new WaveformPyramidGeneratorError('Waveform pyramid data is invalid.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }

  const channelCount = pyramid.levels[0]?.channels.length ?? 0;
  if (channelCount < 1) {
    throw new WaveformPyramidGeneratorError('Waveform pyramid data requires at least one channel.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }

  for (const level of pyramid.levels) {
    if (
      !Number.isInteger(level.samplesPerBucket) ||
      level.samplesPerBucket < 1 ||
      !Number.isInteger(level.bucketCount) ||
      level.bucketCount < 0 ||
      !finiteNumber(level.bucketDuration) ||
      level.bucketDuration <= 0 ||
      level.channels.length !== channelCount
    ) {
      throw new WaveformPyramidGeneratorError('Waveform pyramid level metadata is invalid.', {
        code: 'invalid-levels',
        jobId,
        recoverable: false,
      });
    }

    for (const channel of level.channels) {
      if (
        channel.min.length !== level.bucketCount ||
        channel.max.length !== level.bucketCount ||
        channel.rms.length !== level.bucketCount ||
        channel.peak.length !== level.bucketCount
      ) {
        throw new WaveformPyramidGeneratorError('Waveform pyramid channel data must match level bucketCount.', {
          code: 'invalid-audio-buffer',
          jobId,
          recoverable: false,
        });
      }
    }
  }
}

function describePyramidChannelLayout(pyramid: WaveformPyramidData): AudioChannelLayout {
  const channelCount = pyramid.levels[0]?.channels.length ?? 0;
  return describeChannelLayout(channelCount);
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createWaveformPyramidAnalyzerVersion(
  bucketSizes: readonly number[] = DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES,
  baseVersion = WAVEFORM_PYRAMID_GENERATOR_VERSION,
): string {
  return buildWaveformPyramidAnalyzerVersion(bucketSizes, baseVersion);
}

export class WaveformPyramidGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly bucketSizes: readonly number[];
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: WaveformPyramidGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.bucketSizes = options.bucketSizes ?? DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES;
    this.baseAnalyzerVersion = options.analyzerVersion ?? WAVEFORM_PYRAMID_GENERATOR_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: WaveformPyramidGenerateRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: WaveformPyramidGenerationProgress) => void;
    } = {},
  ): Promise<WaveformPyramidGenerationResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: WaveformPyramidAnalysisContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      let bucketSizes: number[];
      try {
        bucketSizes = normalizeBucketSizes(request.bucketSizes ?? this.bucketSizes);
      } catch (error) {
        throw new WaveformPyramidGeneratorError(errorMessage(error), {
          code: 'invalid-levels',
          jobId,
          recoverable: false,
          cause: error,
        });
      }
      const analyzerVersion = createWaveformPyramidAnalyzerVersion(bucketSizes, this.baseAnalyzerVersion);
      const analysisKind = request.kind ?? 'waveform-pyramid';
      const channelLayout = validateChannelLayout(
        request.channelLayout ?? describeChannelLayout(request.buffer.numberOfChannels),
        request.buffer,
        jobId,
      );
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: analysisKind,
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: WaveformPyramidAnalysisContext = {
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        cacheKey,
        signal: options.signal,
        onProgress: options.onProgress,
      };
      progressContext = context;

      this.emitProgress(context, {
        phase: 'queued',
        percent: 0,
        timestamp: generatedAt,
        message: 'Queued waveform pyramid generation',
      });
      throwIfCancelled(options.signal, jobId);

      const levelStats = await generateWaveformLevelStats({
        buffer: request.buffer,
        bucketSizes,
        context,
        now: this.now,
        emitProgress: this.emitProgress,
        throwIfCancelled,
      });
      const pyramid = createPyramidDataFromLevelStats(request.buffer.sampleRate, request.buffer.duration, levelStats);
      const stored = await storeWaveformPyramidPayloads({
        artifactStore: this.artifactStore,
        request,
        analyzerVersion,
        generatedAt,
        context,
        pyramid,
        now: this.now,
        emitProgress: this.emitProgress,
        throwIfCancelled,
      });
      const manifest = createWaveformPyramidManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        levels: stored.levels,
        payloadLayout: 'packed-pyramid',
        packedPayload: stored.packedPayload,
      });
      const artifactId = await deterministicHashId(`audio:${analysisKind}`, cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing waveform pyramid manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: analysisKind,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        payloadRefs: stored.payloadRefs,
        createdAt: toTimestamp(generatedAt),
        stale: false,
        warnings: stored.warnings.length > 0 ? stored.warnings : undefined,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind,
          cacheKey,
          waveformManifest: manifest as unknown as JsonValue,
        },
      });
      const analysisRef = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Waveform pyramid generation complete',
      });

      return {
        jobId,
        cacheKey,
        analysisRef,
        artifact: artifactResult.artifact,
        manifest,
        payloadRefs: stored.payloadRefs,
        warnings: stored.warnings,
      };
    } catch (error) {
      if (isCancellationError(error) || options.signal?.aborted) {
        const cancellation = isCancellationError(error)
          ? error
          : cancelledError(jobId, options.signal ? getAbortReason(options.signal) : undefined);
        this.emitProgress(progressContext ?? {
          jobId,
          mediaFileId: request.mediaFileId,
          sourceFingerprint: request.sourceFingerprint,
          cacheKey: 'cancelled-before-cache-key',
          signal: options.signal,
          onProgress: options.onProgress,
        }, {
          phase: 'cancelled',
          percent: 0,
          timestamp: this.now(),
          message: cancellation.message,
        }, false);
        throw cancellation;
      }

      throw error instanceof WaveformPyramidGeneratorError
        ? error
        : new WaveformPyramidGeneratorError(
          `Waveform pyramid generation ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  async storePyramid(
    request: WaveformPyramidStoreRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: WaveformPyramidGenerationProgress) => void;
    } = {},
  ): Promise<WaveformPyramidGenerationResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    const analysisKind = request.kind ?? 'waveform-pyramid';

    try {
      validatePyramidData(request.pyramid, jobId);
      let bucketSizes: number[];
      try {
        bucketSizes = normalizeBucketSizes(
          request.bucketSizes ?? request.pyramid.levels.map(level => level.samplesPerBucket),
        );
      } catch (error) {
        throw new WaveformPyramidGeneratorError(errorMessage(error), {
          code: 'invalid-levels',
          jobId,
          recoverable: false,
          cause: error,
        });
      }
      const analyzerVersion = createWaveformPyramidAnalyzerVersion(bucketSizes, this.baseAnalyzerVersion);
      const channelLayout = request.channelLayout ?? describePyramidChannelLayout(request.pyramid);
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: analysisKind,
        analyzerVersion,
        channelLayout,
        sampleRate: request.pyramid.sampleRate,
        duration: request.pyramid.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: WaveformPyramidAnalysisContext = {
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        cacheKey,
        signal: options.signal,
        onProgress: options.onProgress,
      };

      this.emitProgress(context, {
        phase: 'queued',
        percent: 0,
        timestamp: generatedAt,
        message: 'Queued waveform pyramid storage',
      });
      throwIfCancelled(options.signal, jobId);

      const stored = await storeWaveformPyramidPayloads({
        artifactStore: this.artifactStore,
        request,
        analyzerVersion,
        generatedAt,
        context,
        pyramid: request.pyramid,
        now: this.now,
        emitProgress: this.emitProgress,
        throwIfCancelled,
      });
      const manifest = createWaveformPyramidManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.pyramid.sampleRate,
        channelLayout,
        duration: request.pyramid.duration,
        levels: stored.levels,
        payloadLayout: 'packed-pyramid',
        packedPayload: stored.packedPayload,
      });
      const artifactId = await deterministicHashId(`audio:${analysisKind}`, cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing waveform pyramid manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: analysisKind,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.pyramid.sampleRate,
        channelLayout,
        duration: request.pyramid.duration,
        payloadRefs: stored.payloadRefs,
        createdAt: toTimestamp(generatedAt),
        stale: false,
        warnings: stored.warnings.length > 0 ? stored.warnings : undefined,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind,
          cacheKey,
          waveformManifest: manifest as unknown as JsonValue,
        },
      });
      const analysisRef = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Waveform pyramid storage complete',
      });

      return {
        jobId,
        cacheKey,
        analysisRef,
        artifact: artifactResult.artifact,
        manifest,
        payloadRefs: stored.payloadRefs,
        warnings: stored.warnings,
      };
    } catch (error) {
      if (isCancellationError(error) || options.signal?.aborted) {
        throw isCancellationError(error)
          ? error
          : cancelledError(jobId, options.signal ? getAbortReason(options.signal) : undefined);
      }

      throw error instanceof WaveformPyramidGeneratorError
        ? error
        : new WaveformPyramidGeneratorError(
          `Waveform pyramid storage ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private emitProgress(
    context: WaveformPyramidAnalysisContext,
    update: Omit<
      WaveformPyramidGenerationProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'cacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: WaveformPyramidGenerationProgress = {
      ...update,
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      cacheKey: context.cacheKey,
      percent: clampPercent(update.percent),
    };
    context.onProgress?.(progress);

    if (checkCancellation) {
      throwIfCancelled(context.signal, context.jobId);
    }
  }
}
