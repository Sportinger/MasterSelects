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
  AudioAnalysisWarning,
  AudioArtifactRef,
  AudioChannelLayout,
} from './audioArtifactTypes';
import {
  DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES,
  WAVEFORM_PYRAMID_MANIFEST_VERSION,
  WAVEFORM_STAT_PAYLOAD_VERSION,
  createWaveformPyramidManifest,
  encodeWaveformStatPayload,
  type WaveformPyramidLevelManifest,
  type WaveformPyramidManifest,
  type WaveformStatistic,
} from './waveformPyramidManifest';

export const WAVEFORM_PYRAMID_GENERATOR_VERSION = 'masterselects.waveform-pyramid-generator@1.0.0';
export const WAVEFORM_STAT_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.waveform-stat';

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

export interface WaveformPyramidGenerationResult {
  jobId: string;
  cacheKey: string;
  analysisRef: AudioAnalysisManifestRef;
  artifact: AudioAnalysisArtifact;
  manifest: WaveformPyramidManifest;
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}

interface WaveformChannelStats {
  channelIndex: number;
  min: Float32Array;
  max: Float32Array;
  rms: Float32Array;
  peak: Float32Array;
}

interface WaveformLevelStats {
  samplesPerBucket: number;
  bucketDuration: number;
  bucketCount: number;
  channels: WaveformChannelStats[];
}

interface GenerationContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  cacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: WaveformPyramidGenerationProgress) => void;
}

const WAVEFORM_STATISTICS = ['min', 'max', 'rms', 'peak'] as const satisfies readonly WaveformStatistic[];
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

function normalizeBucketSizes(bucketSizes: readonly number[]): number[] {
  const normalized = [...new Set(bucketSizes)]
    .toSorted((a, b) => a - b);

  if (normalized.length === 0) {
    throw new Error('Waveform pyramid generation requires at least one bucket size.');
  }

  for (const samplesPerBucket of normalized) {
    if (!Number.isInteger(samplesPerBucket) || samplesPerBucket < 1) {
      throw new Error('Waveform pyramid bucket sizes must be positive integers.');
    }
  }

  return normalized;
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

function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function calculateChannelStats(
  data: Float32Array,
  bufferLength: number,
  samplesPerBucket: number,
  channelIndex: number,
  context: GenerationContext,
): WaveformChannelStats {
  const bucketCount = Math.ceil(bufferLength / samplesPerBucket);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  const rms = new Float32Array(bucketCount);
  const peak = new Float32Array(bucketCount);

  for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
    throwIfCancelled(context.signal, context.jobId);

    const start = bucketIndex * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, bufferLength, data.length);
    let bucketMin = Number.POSITIVE_INFINITY;
    let bucketMax = Number.NEGATIVE_INFINITY;
    let bucketPeak = 0;
    let squareSum = 0;
    const count = Math.max(0, end - start);

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const sample = safeSample(data[sampleIndex] ?? 0);
      bucketMin = Math.min(bucketMin, sample);
      bucketMax = Math.max(bucketMax, sample);
      bucketPeak = Math.max(bucketPeak, Math.abs(sample));
      squareSum += sample * sample;
    }

    min[bucketIndex] = count > 0 ? bucketMin : 0;
    max[bucketIndex] = count > 0 ? bucketMax : 0;
    rms[bucketIndex] = count > 0 ? Math.sqrt(squareSum / count) : 0;
    peak[bucketIndex] = bucketPeak;
  }

  return { channelIndex, min, max, rms, peak };
}

function readStatisticValues(
  channelStats: WaveformChannelStats,
  statistic: WaveformStatistic,
): Float32Array {
  switch (statistic) {
    case 'min':
      return channelStats.min;
    case 'max':
      return channelStats.max;
    case 'rms':
      return channelStats.rms;
    case 'peak':
      return channelStats.peak;
  }
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
  const levels = normalizeBucketSizes(bucketSizes).join(',');
  return [
    baseVersion,
    `manifest=v${WAVEFORM_PYRAMID_MANIFEST_VERSION}`,
    `payload=v${WAVEFORM_STAT_PAYLOAD_VERSION}`,
    `stats=${WAVEFORM_STATISTICS.join(',')}`,
    `levels=${levels}`,
  ].join(';');
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
    let progressContext: GenerationContext | null = null;

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
      const channelLayout = validateChannelLayout(
        request.channelLayout ?? describeChannelLayout(request.buffer.numberOfChannels),
        request.buffer,
        jobId,
      );
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'waveform-pyramid',
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: GenerationContext = {
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

      const levelStats = this.generateLevelStats(request.buffer, bucketSizes, context);
      const stored = await this.storePayloads({
        request,
        analyzerVersion,
        generatedAt,
        context,
        levelStats,
      });
      const manifest = createWaveformPyramidManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        levels: stored.levels,
      });
      const artifactId = await deterministicHashId('audio:waveform-pyramid', cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing waveform pyramid manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: 'waveform-pyramid',
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

  private generateLevelStats(
    buffer: AudioBuffer,
    bucketSizes: readonly number[],
    context: GenerationContext,
  ): WaveformLevelStats[] {
    const workUnits = bucketSizes.length * buffer.numberOfChannels;
    let completedUnits = 0;

    return bucketSizes.map((samplesPerBucket, levelIndex) => {
      const level: WaveformLevelStats = {
        samplesPerBucket,
        bucketDuration: samplesPerBucket / buffer.sampleRate,
        bucketCount: Math.ceil(buffer.length / samplesPerBucket),
        channels: [],
      };

      for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
        this.emitProgress(context, {
          phase: 'analyzing',
          percent: 5 + (completedUnits / workUnits) * 70,
          timestamp: this.now(),
          levelIndex,
          channelIndex,
          samplesPerBucket,
          message: 'Analyzing waveform buckets',
        });
        throwIfCancelled(context.signal, context.jobId);

        level.channels.push(calculateChannelStats(
          buffer.getChannelData(channelIndex),
          buffer.length,
          samplesPerBucket,
          channelIndex,
          context,
        ));
        completedUnits += 1;
      }

      return level;
    });
  }

  private async storePayloads(input: {
    request: WaveformPyramidGenerateRequest;
    analyzerVersion: string;
    generatedAt: string;
    context: GenerationContext;
    levelStats: WaveformLevelStats[];
  }): Promise<{
    levels: WaveformPyramidLevelManifest[];
    payloadRefs: AudioArtifactRef[];
    warnings: AudioAnalysisWarning[];
  }> {
    const payloadRefs: AudioArtifactRef[] = [];
    const levels: WaveformPyramidLevelManifest[] = [];
    const payloadCount = input.levelStats.length
      * input.request.buffer.numberOfChannels
      * WAVEFORM_STATISTICS.length;
    let storedPayloads = 0;

    for (let levelIndex = 0; levelIndex < input.levelStats.length; levelIndex += 1) {
      const level = input.levelStats[levelIndex];
      if (!level) {
        continue;
      }

      const channels = [];
      for (const channelStats of level.channels) {
        const channelRefs: Partial<Record<WaveformStatistic, AudioArtifactRef>> = {};

        for (const statistic of WAVEFORM_STATISTICS) {
          this.emitProgress(input.context, {
            phase: 'storing-payloads',
            percent: 75 + (storedPayloads / payloadCount) * 20,
            timestamp: this.now(),
            levelIndex,
            channelIndex: channelStats.channelIndex,
            samplesPerBucket: level.samplesPerBucket,
            statistic,
            message: 'Storing waveform statistic payload',
          });
          throwIfCancelled(input.context.signal, input.context.jobId);

          const ref = await this.artifactStore.putPayload(encodeWaveformStatPayload({
            header: {
              schemaVersion: WAVEFORM_STAT_PAYLOAD_VERSION,
              statistic,
              samplesPerBucket: level.samplesPerBucket,
              channelIndex: channelStats.channelIndex,
              bucketCount: level.bucketCount,
            },
            values: readStatisticValues(channelStats, statistic),
          }), {
            mediaFileId: input.request.mediaFileId,
            kind: 'waveform-pyramid',
            sourceFingerprint: input.request.sourceFingerprint,
            clipAudioStateHash: input.request.clipAudioStateHash,
            mimeType: WAVEFORM_STAT_PAYLOAD_MIME_TYPE,
            encoding: 'raw',
            analyzerVersion: input.analyzerVersion,
            createdAt: input.generatedAt,
            sourceRefs: [`audio-analysis-cache:${input.context.cacheKey}`],
            metadata: {
              cacheKey: input.context.cacheKey,
              samplesPerBucket: level.samplesPerBucket,
              bucketCount: level.bucketCount,
              channelIndex: channelStats.channelIndex,
              statistic,
            },
          });

          channelRefs[statistic] = ref;
          payloadRefs.push(ref);
          storedPayloads += 1;
        }

        if (!channelRefs.min || !channelRefs.max || !channelRefs.rms || !channelRefs.peak) {
          throw new WaveformPyramidGeneratorError('Waveform statistic payload refs were incomplete.', {
            code: 'artifact-store-failed',
            jobId: input.context.jobId,
          });
        }

        channels.push({
          channelIndex: channelStats.channelIndex,
          min: channelRefs.min,
          max: channelRefs.max,
          rms: channelRefs.rms,
          peak: channelRefs.peak,
        });
      }

      levels.push({
        samplesPerBucket: level.samplesPerBucket,
        bucketDuration: level.bucketDuration,
        bucketCount: level.bucketCount,
        channels,
      });
    }

    return {
      levels,
      payloadRefs,
      warnings: [],
    };
  }

  private emitProgress(
    context: GenerationContext,
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
