import { sha256ArrayBuffer } from '../../artifacts';
import type { JsonValue, SignalMetadata } from '../../signals';
import {
  createAudioAnalysisCacheKey,
  createAudioAnalysisManifestRefFromArtifact,
  type AudioAnalysisManifestRef,
} from './audioAnalysisManifestKeys';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type {
  AudioAnalysisArtifact,
  AudioArtifactRef,
  AudioChannelLayout,
} from './audioArtifactTypes';
import { analyzeFrequencySummary } from './frequencyPhase/frequencyBandAnalysis';
import {
  type FrequencyPhaseAnalysisContext,
  type FrequencyPhaseAnalysisPhase,
  type FrequencyPhaseAnalysisProgress,
  type NormalizedFrequencyPhaseParameters,
} from './frequencyPhase/frequencyPhaseAnalysisTypes';
import { analyzePhaseCorrelation } from './frequencyPhase/phaseCorrelationAnalysis';
import {
  FREQUENCY_BAND_PAYLOAD_MIME_TYPE,
  PHASE_CORRELATION_PAYLOAD_MIME_TYPE,
  storeFrequencyPayload,
  storePhasePayload,
} from './frequencyPhase/payloadAssembly';
import {
  FREQUENCY_BAND_PAYLOAD_VERSION,
  FREQUENCY_SUMMARY_MANIFEST_VERSION,
  PHASE_CORRELATION_MANIFEST_VERSION,
  PHASE_CORRELATION_PAYLOAD_VERSION,
  createFrequencySummaryManifest,
  createPhaseCorrelationManifest,
  type FrequencySummaryManifest,
  type PhaseCorrelationManifest,
} from './frequencyPhaseManifest';

export const FREQUENCY_PHASE_ANALYZER_VERSION = 'masterselects.frequency-phase-analysis@1.0.0';
export { FREQUENCY_BAND_PAYLOAD_MIME_TYPE, PHASE_CORRELATION_PAYLOAD_MIME_TYPE };
export type { FrequencyPhaseAnalysisPhase, FrequencyPhaseAnalysisProgress };

export type FrequencyPhaseAnalysisErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface FrequencyPhaseAnalysisGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface FrequencyPhaseAnalysisRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  fftSize?: 1024 | 2048 | 4096;
  hopSize?: number;
  phaseWindowDuration?: number;
  phaseHopDuration?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface FrequencyPhaseAnalysisResult {
  jobId: string;
  frequencyCacheKey: string;
  phaseCacheKey: string;
  frequencyAnalysisRef: AudioAnalysisManifestRef;
  phaseAnalysisRef: AudioAnalysisManifestRef;
  frequencyArtifact: AudioAnalysisArtifact;
  phaseArtifact: AudioAnalysisArtifact;
  frequencyManifest: FrequencySummaryManifest;
  phaseManifest: PhaseCorrelationManifest;
  frequencyPayloadRef: AudioArtifactRef;
  phasePayloadRef: AudioArtifactRef;
}

export interface FrequencyPhaseAnalyzerVersionParameters {
  fftSize: number;
  hopSize: number;
  phaseWindowDuration: number;
  phaseHopDuration: number;
}

const DEFAULT_FFT_SIZE = 2048 as const;
const DEFAULT_HOP_SIZE = 1024;
const DEFAULT_PHASE_WINDOW_DURATION = 0.1;
const DEFAULT_PHASE_HOP_DURATION = 0.05;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export class FrequencyPhaseAnalysisGeneratorError extends Error {
  readonly code: FrequencyPhaseAnalysisErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: FrequencyPhaseAnalysisErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'FrequencyPhaseAnalysisCancelledError'
      : 'FrequencyPhaseAnalysisGeneratorError';
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
  return `frequency-phase:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): FrequencyPhaseAnalysisGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new FrequencyPhaseAnalysisGeneratorError(`Frequency/phase analysis ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is FrequencyPhaseAnalysisGeneratorError {
  return error instanceof FrequencyPhaseAnalysisGeneratorError && error.code === 'cancelled';
}

function throwIfCancelled(signal: AbortSignal | undefined, jobId: string): void {
  if (signal?.aborted) {
    throw cancelledError(jobId, getAbortReason(signal));
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function describeMonoMixChannelLayout(): AudioChannelLayout {
  return { kind: 'mono', channelCount: 1, labels: ['Mix'] };
}

function describeSourceChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) return { kind: 'mono', channelCount, labels: ['M'] };
  if (channelCount === 2) return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  if (channelCount > 2 && channelCount <= 8) return { kind: 'surround', channelCount };
  if (channelCount > 8) return { kind: 'discrete', channelCount };
  return { kind: 'unknown', channelCount: Math.max(1, channelCount) };
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new FrequencyPhaseAnalysisGeneratorError('Frequency/phase analysis requires an AudioBuffer.', {
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
    throw new FrequencyPhaseAnalysisGeneratorError('AudioBuffer metadata is invalid for frequency/phase analysis.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
}

function assertPositiveFinite(value: number, label: string, jobId: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FrequencyPhaseAnalysisGeneratorError(`${label} must be a positive finite number.`, {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }
}

function normalizeParameters(
  request: FrequencyPhaseAnalysisRequest,
  jobId: string,
): NormalizedFrequencyPhaseParameters {
  const fftSize = request.fftSize ?? DEFAULT_FFT_SIZE;
  if (![1024, 2048, 4096].includes(fftSize)) {
    throw new FrequencyPhaseAnalysisGeneratorError('Frequency analysis fftSize must be 1024, 2048, or 4096.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  const hopSize = Math.max(1, Math.floor(request.hopSize ?? Math.min(DEFAULT_HOP_SIZE, fftSize / 2)));
  const phaseWindowDuration = request.phaseWindowDuration ?? DEFAULT_PHASE_WINDOW_DURATION;
  const phaseHopDuration = request.phaseHopDuration ?? DEFAULT_PHASE_HOP_DURATION;
  assertPositiveFinite(phaseWindowDuration, 'phaseWindowDuration', jobId);
  assertPositiveFinite(phaseHopDuration, 'phaseHopDuration', jobId);

  const phaseWindowSamples = Math.max(16, Math.floor(phaseWindowDuration * request.buffer.sampleRate));
  const phaseHopSamples = Math.max(1, Math.floor(phaseHopDuration * request.buffer.sampleRate));

  return {
    fftSize,
    hopSize,
    frameCount: Math.max(1, Math.ceil(Math.max(1, request.buffer.length) / hopSize)),
    phaseWindowDuration,
    phaseHopDuration,
    phaseWindowSamples,
    phaseHopSamples,
    phasePointCount: Math.max(1, Math.ceil(Math.max(1, request.buffer.length) / phaseHopSamples)),
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createFrequencyPhaseAnalyzerVersion(
  parameters: FrequencyPhaseAnalyzerVersionParameters,
  baseVersion = FREQUENCY_PHASE_ANALYZER_VERSION,
): string {
  return [
    baseVersion,
    `frequencyManifest=v${FREQUENCY_SUMMARY_MANIFEST_VERSION}`,
    `phaseManifest=v${PHASE_CORRELATION_MANIFEST_VERSION}`,
    `frequencyPayload=v${FREQUENCY_BAND_PAYLOAD_VERSION}`,
    `phasePayload=v${PHASE_CORRELATION_PAYLOAD_VERSION}`,
    `fft=${parameters.fftSize}`,
    `hop=${parameters.hopSize}`,
    'window=hann',
    `phaseWindow=${parameters.phaseWindowDuration}`,
    `phaseHop=${parameters.phaseHopDuration}`,
    'frequencyBands=professional-7-band',
    'frequencyChannels=mono-mix',
    'phaseChannels=l-r',
  ].join(';');
}

export class FrequencyPhaseAnalysisGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: FrequencyPhaseAnalysisGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? FREQUENCY_PHASE_ANALYZER_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: FrequencyPhaseAnalysisRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: FrequencyPhaseAnalysisProgress) => void;
    } = {},
  ): Promise<FrequencyPhaseAnalysisResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: FrequencyPhaseAnalysisContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createFrequencyPhaseAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const frequencyChannelLayout = describeMonoMixChannelLayout();
      const phaseChannelLayout = describeSourceChannelLayout(request.buffer.numberOfChannels);
      const frequencyCacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'frequency-summary',
        analyzerVersion,
        channelLayout: frequencyChannelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const phaseCacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'phase-correlation',
        analyzerVersion,
        channelLayout: phaseChannelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const context: FrequencyPhaseAnalysisContext = {
        jobId,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        frequencyCacheKey,
        phaseCacheKey,
        signal: options.signal,
        onProgress: options.onProgress,
      };
      progressContext = context;

      this.emitProgress(context, {
        phase: 'queued',
        percent: 0,
        timestamp: generatedAt,
        message: 'Queued frequency/phase analysis',
      });

      const frequencyAnalysis = analyzeFrequencySummary(request.buffer, parameters, context, throwIfCancelled);
      const phaseAnalysis = analyzePhaseCorrelation(request.buffer, parameters, context, throwIfCancelled);

      const frequencyPayloadRef = await storeFrequencyPayload({
        artifactStore: this.artifactStore,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        cacheKey: frequencyCacheKey,
        analyzerVersion,
        generatedAt,
        bands: frequencyAnalysis.bands,
        context,
        now: this.now,
        throwIfCancelled,
      });
      const frequencyManifest = createFrequencySummaryManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout: frequencyChannelLayout,
        duration: request.buffer.duration,
        fftSize: parameters.fftSize,
        hopSize: parameters.hopSize,
        window: 'hann',
        bands: frequencyAnalysis.bands,
        bandsPayloadRef: frequencyPayloadRef,
        summary: frequencyAnalysis.summary,
      });

      const frequencyArtifactId = await deterministicHashId('audio:frequency-summary', frequencyCacheKey);
      this.emitProgress(context, {
        phase: 'storing-manifests',
        percent: 88,
        timestamp: this.now(),
        message: 'Storing frequency summary manifest',
      });
      const frequencyArtifactResult = await this.artifactStore.putAnalysisArtifact({
        id: frequencyArtifactId,
        kind: 'frequency-summary',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout: frequencyChannelLayout,
        duration: request.buffer.duration,
        payloadRefs: [frequencyPayloadRef],
        createdAt: toTimestamp(generatedAt),
        stale: false,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'frequency-summary',
          cacheKey: frequencyCacheKey,
          sourceChannelLayout: phaseChannelLayout as unknown as JsonValue,
          frequencySummaryManifest: frequencyManifest as unknown as JsonValue,
        },
      });

      const phasePayloadRef = await storePhasePayload({
        artifactStore: this.artifactStore,
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        cacheKey: phaseCacheKey,
        analyzerVersion,
        generatedAt,
        points: phaseAnalysis.points,
        parameters,
        context,
        now: this.now,
        throwIfCancelled,
      });
      const phaseManifest = createPhaseCorrelationManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout: phaseChannelLayout,
        duration: request.buffer.duration,
        windowDuration: parameters.phaseWindowDuration,
        hopDuration: parameters.phaseHopDuration,
        pointCount: phaseAnalysis.points.length,
        correlationPayloadRef: phasePayloadRef,
        summary: phaseAnalysis.summary,
      });
      const phaseArtifactId = await deterministicHashId('audio:phase-correlation', phaseCacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifests',
        percent: 96,
        timestamp: this.now(),
        message: 'Storing phase correlation manifest',
      });
      const phaseArtifactResult = await this.artifactStore.putAnalysisArtifact({
        id: phaseArtifactId,
        kind: 'phase-correlation',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout: phaseChannelLayout,
        duration: request.buffer.duration,
        payloadRefs: [phasePayloadRef],
        createdAt: toTimestamp(generatedAt),
        stale: false,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'phase-correlation',
          cacheKey: phaseCacheKey,
          phaseCorrelationManifest: phaseManifest as unknown as JsonValue,
        },
      });

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Frequency/phase analysis complete',
      });

      return {
        jobId,
        frequencyCacheKey,
        phaseCacheKey,
        frequencyAnalysisRef: createAudioAnalysisManifestRefFromArtifact(frequencyArtifactResult.artifact),
        phaseAnalysisRef: createAudioAnalysisManifestRefFromArtifact(phaseArtifactResult.artifact),
        frequencyArtifact: frequencyArtifactResult.artifact,
        phaseArtifact: phaseArtifactResult.artifact,
        frequencyManifest,
        phaseManifest,
        frequencyPayloadRef,
        phasePayloadRef,
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
          frequencyCacheKey: 'cancelled-before-frequency-cache-key',
          phaseCacheKey: 'cancelled-before-phase-cache-key',
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

      throw error instanceof FrequencyPhaseAnalysisGeneratorError
        ? error
        : new FrequencyPhaseAnalysisGeneratorError(
          `Frequency/phase analysis ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private emitProgress(
    context: FrequencyPhaseAnalysisContext,
    update: Omit<
      FrequencyPhaseAnalysisProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'frequencyCacheKey' | 'phaseCacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: FrequencyPhaseAnalysisProgress = {
      ...update,
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      frequencyCacheKey: context.frequencyCacheKey,
      phaseCacheKey: context.phaseCacheKey,
      percent: clampPercent(update.percent),
    };
    context.onProgress?.(progress);

    if (checkCancellation) {
      throwIfCancelled(context.signal, context.jobId);
    }
  }
}
