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
  AudioAnalysisWarning,
  AudioArtifactRef,
  AudioChannelLayout,
} from './audioArtifactTypes';
import {
  SPECTROGRAM_TILE_PAYLOAD_VERSION,
  SPECTROGRAM_TILE_SET_MANIFEST_VERSION,
  createSpectrogramTileSetManifest,
  encodeSpectrogramTilePayload,
  type SpectrogramFftSize,
  type SpectrogramTileRef,
  type SpectrogramTileSetManifest,
} from './spectrogramTileManifest';

export const SPECTROGRAM_TILE_SET_GENERATOR_VERSION = 'masterselects.spectrogram-tile-set-generator@1.0.0';
export const SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.spectrogram-tile';

export type SpectrogramTileSetGenerationPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type SpectrogramTileSetGeneratorErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface SpectrogramTileSetGenerationProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: SpectrogramTileSetGenerationPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  tileIndex?: number;
  frameStart?: number;
  frameCount?: number;
  message?: string;
}

export interface SpectrogramTileSetGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface SpectrogramTileSetGenerateRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  fftSize?: SpectrogramFftSize;
  hopSize?: number;
  targetMaxFrames?: number;
  tileWidthFrames?: number;
  minDb?: number;
  maxDb?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface SpectrogramTileSetGenerationResult {
  jobId: string;
  cacheKey: string;
  analysisRef: AudioAnalysisManifestRef;
  artifact: AudioAnalysisArtifact;
  manifest: SpectrogramTileSetManifest;
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}

interface GenerationContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  cacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: SpectrogramTileSetGenerationProgress) => void;
}

interface NormalizedSpectrogramParameters {
  fftSize: SpectrogramFftSize;
  hopSize: number;
  targetMaxFrames: number;
  tileWidthFrames: number;
  minDb: number;
  maxDb: number;
  frequencyBinCount: number;
  frameCount: number;
}

const DEFAULT_FFT_SIZE: SpectrogramFftSize = 1024;
const DEFAULT_TARGET_MAX_FRAMES = 2048;
const DEFAULT_TILE_WIDTH_FRAMES = 512;
const DEFAULT_MIN_DB = -96;
const DEFAULT_MAX_DB = 0;
const MIN_HOP_SIZE = 256;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const textEncoder = new TextEncoder();

export class SpectrogramTileSetGeneratorError extends Error {
  readonly code: SpectrogramTileSetGeneratorErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: SpectrogramTileSetGeneratorErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'SpectrogramTileSetGenerationCancelledError'
      : 'SpectrogramTileSetGeneratorError';
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
  return `spectrogram-tile-set:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): SpectrogramTileSetGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new SpectrogramTileSetGeneratorError(`Spectrogram tile set generation ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is SpectrogramTileSetGeneratorError {
  return error instanceof SpectrogramTileSetGeneratorError && error.code === 'cancelled';
}

function throwIfCancelled(signal: AbortSignal | undefined, jobId: string): void {
  if (signal?.aborted) {
    throw cancelledError(jobId, getAbortReason(signal));
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function describeSourceChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) return { kind: 'mono', channelCount, labels: ['M'] };
  if (channelCount === 2) return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  if (channelCount > 2 && channelCount <= 8) return { kind: 'surround', channelCount };
  if (channelCount > 8) return { kind: 'discrete', channelCount };
  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

function describeDisplayChannelLayout(): AudioChannelLayout {
  return { kind: 'mono', channelCount: 1, labels: ['Mix'] };
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new SpectrogramTileSetGeneratorError('Spectrogram tile set generation requires an AudioBuffer.', {
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
    throw new SpectrogramTileSetGeneratorError('AudioBuffer metadata is invalid for spectrogram tile set generation.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
}

function normalizeFftSize(value: SpectrogramFftSize | undefined, jobId: string): SpectrogramFftSize {
  const fftSize = value ?? DEFAULT_FFT_SIZE;
  if (![1024, 2048, 4096, 8192].includes(fftSize)) {
    throw new SpectrogramTileSetGeneratorError('Spectrogram fftSize must be 1024, 2048, 4096, or 8192.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }
  return fftSize;
}

function normalizeParameters(
  request: SpectrogramTileSetGenerateRequest,
  jobId: string,
): NormalizedSpectrogramParameters {
  const fftSize = normalizeFftSize(request.fftSize, jobId);
  const targetMaxFrames = Math.max(1, Math.floor(request.targetMaxFrames ?? DEFAULT_TARGET_MAX_FRAMES));
  const inferredHopSize = Math.max(MIN_HOP_SIZE, Math.ceil(Math.max(1, request.buffer.length) / targetMaxFrames));
  const hopSize = Math.max(1, Math.floor(request.hopSize ?? inferredHopSize));
  const tileWidthFrames = Math.max(1, Math.floor(request.tileWidthFrames ?? DEFAULT_TILE_WIDTH_FRAMES));
  const minDb = request.minDb ?? DEFAULT_MIN_DB;
  const maxDb = request.maxDb ?? DEFAULT_MAX_DB;

  if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb) {
    throw new SpectrogramTileSetGeneratorError('Spectrogram minDb must be lower than maxDb.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  return {
    fftSize,
    hopSize,
    targetMaxFrames,
    tileWidthFrames,
    minDb,
    maxDb,
    frequencyBinCount: fftSize / 2,
    frameCount: Math.max(1, Math.ceil(Math.max(1, request.buffer.length) / hopSize)),
  };
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window[0] = 1;
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
  }

  return window;
}

function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const size = real.length;
  let reversed = 0;

  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;

    if (index < reversed) {
      const tmpReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tmpReal;
      const tmpImag = imag[index];
      imag[index] = imag[reversed];
      imag[reversed] = tmpImag;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;

      for (let pair = 0; pair < length / 2; pair += 1) {
        const evenIndex = offset + pair;
        const oddIndex = evenIndex + length / 2;
        const oddReal = real[oddIndex] * twiddleReal - imag[oddIndex] * twiddleImag;
        const oddImag = real[oddIndex] * twiddleImag + imag[oddIndex] * twiddleReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextTwiddleReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

function readMixedSample(channelData: Float32Array[], sampleIndex: number): number {
  if (sampleIndex < 0) return 0;
  let sum = 0;
  let count = 0;

  for (const data of channelData) {
    if (sampleIndex >= data.length) continue;
    const sample = data[sampleIndex] ?? 0;
    sum += Number.isFinite(sample) ? sample : 0;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

function writeFrameMagnitudes(input: {
  channelData: Float32Array[];
  frameIndex: number;
  hopSize: number;
  fftSize: number;
  frequencyBinCount: number;
  window: Float32Array;
  minDb: number;
  maxDb: number;
  real: Float32Array;
  imag: Float32Array;
  target: Float32Array;
  targetFrameOffset: number;
}): void {
  input.real.fill(0);
  input.imag.fill(0);
  const sampleStart = input.frameIndex * input.hopSize;

  for (let sampleOffset = 0; sampleOffset < input.fftSize; sampleOffset += 1) {
    input.real[sampleOffset] = readMixedSample(input.channelData, sampleStart + sampleOffset)
      * (input.window[sampleOffset] ?? 1);
  }

  fftRadix2(input.real, input.imag);

  const dbRange = input.maxDb - input.minDb;
  const amplitudeScale = input.fftSize / 2;
  const targetOffset = input.targetFrameOffset * input.frequencyBinCount;

  for (let binIndex = 0; binIndex < input.frequencyBinCount; binIndex += 1) {
    const magnitude = Math.hypot(input.real[binIndex], input.imag[binIndex]) / amplitudeScale;
    const db = 20 * Math.log10(Math.max(1e-12, magnitude));
    input.target[targetOffset + binIndex] = clamp01((db - input.minDb) / dbRange);
  }
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createSpectrogramTileSetAnalyzerVersion(
  parameters: Pick<
    NormalizedSpectrogramParameters,
    'fftSize' | 'hopSize' | 'tileWidthFrames' | 'minDb' | 'maxDb'
  >,
  baseVersion = SPECTROGRAM_TILE_SET_GENERATOR_VERSION,
): string {
  return [
    baseVersion,
    `manifest=v${SPECTROGRAM_TILE_SET_MANIFEST_VERSION}`,
    `payload=v${SPECTROGRAM_TILE_PAYLOAD_VERSION}`,
    `fft=${parameters.fftSize}`,
    `hop=${parameters.hopSize}`,
    `window=hann`,
    `scale=linear`,
    `minDb=${parameters.minDb}`,
    `maxDb=${parameters.maxDb}`,
    `tileWidth=${parameters.tileWidthFrames}`,
    'channels=mono-mix',
  ].join(';');
}

export class SpectrogramTileSetGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: SpectrogramTileSetGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? SPECTROGRAM_TILE_SET_GENERATOR_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: SpectrogramTileSetGenerateRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: SpectrogramTileSetGenerationProgress) => void;
    } = {},
  ): Promise<SpectrogramTileSetGenerationResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: GenerationContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createSpectrogramTileSetAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const channelLayout = describeDisplayChannelLayout();
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'spectrogram-tiles',
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
        message: 'Queued spectrogram tile set generation',
      });
      throwIfCancelled(options.signal, jobId);

      const stored = await this.generateAndStoreTiles({
        request,
        parameters,
        analyzerVersion,
        generatedAt,
        context,
      });
      const manifest = createSpectrogramTileSetManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        fftSize: parameters.fftSize,
        hopSize: parameters.hopSize,
        window: 'hann',
        frequencyScale: 'linear',
        minDb: parameters.minDb,
        maxDb: parameters.maxDb,
        tileWidthFrames: parameters.tileWidthFrames,
        tileHeightBins: parameters.frequencyBinCount,
        tiles: stored.tiles,
      });
      const artifactId = await deterministicHashId('audio:spectrogram-tiles', cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing spectrogram tile set manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: 'spectrogram-tiles',
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
          analysisKind: 'spectrogram-tiles',
          cacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          spectrogramTileSetManifest: manifest as unknown as JsonValue,
        },
      });
      const analysisRef = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Spectrogram tile set generation complete',
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

      throw error instanceof SpectrogramTileSetGeneratorError
        ? error
        : new SpectrogramTileSetGeneratorError(
          `Spectrogram tile set generation ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private async generateAndStoreTiles(input: {
    request: SpectrogramTileSetGenerateRequest;
    parameters: NormalizedSpectrogramParameters;
    analyzerVersion: string;
    generatedAt: string;
    context: GenerationContext;
  }): Promise<{
    tiles: SpectrogramTileRef[];
    payloadRefs: AudioArtifactRef[];
    warnings: AudioAnalysisWarning[];
  }> {
    const { request, parameters, analyzerVersion, generatedAt, context } = input;
    const payloadRefs: AudioArtifactRef[] = [];
    const tiles: SpectrogramTileRef[] = [];
    const channelData = Array.from({ length: request.buffer.numberOfChannels }, (_, index) => (
      request.buffer.getChannelData(index)
    ));
    const window = hannWindow(parameters.fftSize);
    const real = new Float32Array(parameters.fftSize);
    const imag = new Float32Array(parameters.fftSize);
    const tileCount = Math.max(1, Math.ceil(parameters.frameCount / parameters.tileWidthFrames));

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const frameStart = tileIndex * parameters.tileWidthFrames;
      const frameCount = Math.min(parameters.tileWidthFrames, parameters.frameCount - frameStart);
      const values = new Float32Array(frameCount * parameters.frequencyBinCount);

      this.emitProgress(context, {
        phase: 'analyzing',
        percent: 5 + (tileIndex / tileCount) * 70,
        timestamp: this.now(),
        tileIndex,
        frameStart,
        frameCount,
        message: 'Analyzing spectrogram tile',
      });
      throwIfCancelled(context.signal, context.jobId);

      for (let localFrame = 0; localFrame < frameCount; localFrame += 1) {
        writeFrameMagnitudes({
          channelData,
          frameIndex: frameStart + localFrame,
          hopSize: parameters.hopSize,
          fftSize: parameters.fftSize,
          frequencyBinCount: parameters.frequencyBinCount,
          window,
          minDb: parameters.minDb,
          maxDb: parameters.maxDb,
          real,
          imag,
          target: values,
          targetFrameOffset: localFrame,
        });
      }

      this.emitProgress(context, {
        phase: 'storing-payloads',
        percent: 75 + (tileIndex / tileCount) * 20,
        timestamp: this.now(),
        tileIndex,
        frameStart,
        frameCount,
        message: 'Storing spectrogram tile payload',
      });
      throwIfCancelled(context.signal, context.jobId);

      const payloadRef = await this.artifactStore.putPayload(encodeSpectrogramTilePayload({
        header: {
          schemaVersion: SPECTROGRAM_TILE_PAYLOAD_VERSION,
          tileIndex,
          channelIndex: 0,
          frameStart,
          frameCount,
          frequencyBinStart: 0,
          frequencyBinCount: parameters.frequencyBinCount,
          minDb: parameters.minDb,
          maxDb: parameters.maxDb,
          valueLayout: 'time-major',
          valueEncoding: 'normalized-db',
        },
        values,
      }), {
        mediaFileId: request.mediaFileId,
        kind: 'spectrogram-tiles',
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        mimeType: SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE,
        encoding: 'raw',
        analyzerVersion,
        createdAt: generatedAt,
        sourceRefs: [`audio-analysis-cache:${context.cacheKey}`],
        metadata: {
          cacheKey: context.cacheKey,
          tileIndex,
          channelIndex: 0,
          frameStart,
          frameCount,
          frequencyBinStart: 0,
          frequencyBinCount: parameters.frequencyBinCount,
          valueEncoding: 'normalized-db',
        },
      });

      payloadRefs.push(payloadRef);
      tiles.push({
        tileIndex,
        channelIndex: 0,
        frameStart,
        frameCount,
        frequencyBinStart: 0,
        frequencyBinCount: parameters.frequencyBinCount,
        payloadRef,
      });
    }

    return {
      tiles,
      payloadRefs,
      warnings: [],
    };
  }

  private emitProgress(
    context: GenerationContext,
    update: Omit<
      SpectrogramTileSetGenerationProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'cacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: SpectrogramTileSetGenerationProgress = {
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
