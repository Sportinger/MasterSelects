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
import {
  AUDIO_EVENT_LIST_PAYLOAD_VERSION,
  BEAT_GRID_MANIFEST_VERSION,
  ONSET_MAP_MANIFEST_VERSION,
  createBeatGridManifest,
  createOnsetMapManifest,
  encodeAudioEventListPayload,
  eventsToFloat32,
  type AudioEvent,
  type BeatGridManifest,
  type OnsetMapManifest,
} from './beatOnsetManifest';

export const BEAT_ONSET_ANALYZER_VERSION = 'masterselects.beat-onset-analysis@1.0.0';
export const AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.audio-event-list';

export type BeatOnsetAnalysisPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifests'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type BeatOnsetAnalysisErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface BeatOnsetAnalysisProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: BeatOnsetAnalysisPhase;
  percent: number;
  timestamp: string;
  onsetCacheKey: string;
  beatCacheKey: string;
  frameIndex?: number;
  frameCount?: number;
  message?: string;
}

export interface BeatOnsetAnalysisGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface BeatOnsetAnalysisRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  fftSize?: 1024 | 2048 | 4096;
  hopSize?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface BeatOnsetAnalysisResult {
  jobId: string;
  onsetCacheKey: string;
  beatCacheKey: string;
  onsetAnalysisRef: AudioAnalysisManifestRef;
  beatAnalysisRef: AudioAnalysisManifestRef;
  onsetArtifact: AudioAnalysisArtifact;
  beatArtifact: AudioAnalysisArtifact;
  onsetManifest: OnsetMapManifest;
  beatManifest: BeatGridManifest;
  onsetPayloadRef: AudioArtifactRef;
  beatPayloadRef: AudioArtifactRef;
}

interface NormalizedBeatOnsetParameters {
  fftSize: 1024 | 2048 | 4096;
  hopSize: number;
  frameCount: number;
}

interface FluxAnalysis {
  flux: Float32Array;
  onsets: AudioEvent[];
}

interface BeatEstimate {
  tempoBpm?: number;
  confidence: number;
  beats: AudioEvent[];
}

interface GenerationContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  onsetCacheKey: string;
  beatCacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: BeatOnsetAnalysisProgress) => void;
}

const DEFAULT_FFT_SIZE = 1024 as const;
const DEFAULT_HOP_SIZE = 512;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const MIN_TEMPO_BPM = 60;
const MAX_TEMPO_BPM = 200;
const textEncoder = new TextEncoder();

export class BeatOnsetAnalysisGeneratorError extends Error {
  readonly code: BeatOnsetAnalysisErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: BeatOnsetAnalysisErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'BeatOnsetAnalysisCancelledError'
      : 'BeatOnsetAnalysisGeneratorError';
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
  return `beat-onset:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): BeatOnsetAnalysisGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new BeatOnsetAnalysisGeneratorError(`Beat/onset analysis ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is BeatOnsetAnalysisGeneratorError {
  return error instanceof BeatOnsetAnalysisGeneratorError && error.code === 'cancelled';
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
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function finiteNumber(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function describeDisplayChannelLayout(): AudioChannelLayout {
  return { kind: 'mono', channelCount: 1, labels: ['Mix'] };
}

function describeSourceChannelLayout(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) return { kind: 'mono', channelCount, labels: ['M'] };
  if (channelCount === 2) return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  if (channelCount > 2 && channelCount <= 8) return { kind: 'surround', channelCount };
  if (channelCount > 8) return { kind: 'discrete', channelCount };
  return { kind: 'unknown', channelCount: Math.max(0, channelCount) };
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new BeatOnsetAnalysisGeneratorError('Beat/onset analysis requires an AudioBuffer.', {
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
    throw new BeatOnsetAnalysisGeneratorError('AudioBuffer metadata is invalid for beat/onset analysis.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
}

function normalizeParameters(
  request: BeatOnsetAnalysisRequest,
  jobId: string,
): NormalizedBeatOnsetParameters {
  const fftSize = request.fftSize ?? DEFAULT_FFT_SIZE;
  if (![1024, 2048, 4096].includes(fftSize)) {
    throw new BeatOnsetAnalysisGeneratorError('Beat/onset fftSize must be 1024, 2048, or 4096.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  const hopSize = Math.max(1, Math.floor(request.hopSize ?? Math.min(DEFAULT_HOP_SIZE, fftSize / 2)));
  return {
    fftSize,
    hopSize,
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

function createMonoMix(buffer: AudioBuffer): Float32Array {
  const mix = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      mix[sampleIndex] += safeSample(data[sampleIndex] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mix;
}

function mean(values: Float32Array): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function standardDeviation(values: Float32Array, average: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    const delta = value - average;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

function movingAverage(values: Float32Array, radius: number): Float32Array {
  const output = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) {
      sum += values[sample] ?? 0;
    }
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function analyzeSpectralFlux(
  buffer: AudioBuffer,
  parameters: NormalizedBeatOnsetParameters,
  context: GenerationContext,
): FluxAnalysis {
  const mix = createMonoMix(buffer);
  const window = hannWindow(parameters.fftSize);
  const real = new Float32Array(parameters.fftSize);
  const imag = new Float32Array(parameters.fftSize);
  const previous = new Float32Array(parameters.fftSize / 2);
  const current = new Float32Array(parameters.fftSize / 2);
  const flux = new Float32Array(parameters.frameCount);

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    if (frameIndex % 64 === 0) {
      context.onProgress?.({
        jobId: context.jobId,
        mediaFileId: context.mediaFileId,
        sourceFingerprint: context.sourceFingerprint,
        onsetCacheKey: context.onsetCacheKey,
        beatCacheKey: context.beatCacheKey,
        phase: 'analyzing',
        percent: 5 + (frameIndex / parameters.frameCount) * 60,
        timestamp: new Date().toISOString(),
        frameIndex,
        frameCount: parameters.frameCount,
        message: 'Analyzing spectral flux',
      });
    }
    throwIfCancelled(context.signal, context.jobId);

    real.fill(0);
    imag.fill(0);
    const sampleStart = frameIndex * parameters.hopSize;
    for (let sampleOffset = 0; sampleOffset < parameters.fftSize; sampleOffset += 1) {
      real[sampleOffset] = (mix[sampleStart + sampleOffset] ?? 0) * (window[sampleOffset] ?? 1);
    }

    fftRadix2(real, imag);

    let frameFlux = 0;
    for (let binIndex = 0; binIndex < current.length; binIndex += 1) {
      const magnitude = Math.hypot(real[binIndex], imag[binIndex]);
      current[binIndex] = magnitude;
      frameFlux += Math.max(0, magnitude - (previous[binIndex] ?? 0));
    }
    flux[frameIndex] = frameFlux / current.length;
    previous.set(current);
  }

  const smoothed = movingAverage(flux, 2);
  const average = mean(smoothed);
  const deviation = standardDeviation(smoothed, average);
  const threshold = average + deviation * 1.15;
  let peakFlux = 0;
  for (const value of smoothed) {
    peakFlux = Math.max(peakFlux, value);
  }

  const onsets: AudioEvent[] = [];
  const minSpacingFrames = Math.max(1, Math.round(0.06 * buffer.sampleRate / parameters.hopSize));
  let lastOnsetFrame = -minSpacingFrames;
  for (let frameIndex = 1; frameIndex < smoothed.length - 1; frameIndex += 1) {
    const value = smoothed[frameIndex] ?? 0;
    if (
      value <= threshold
      || value < (smoothed[frameIndex - 1] ?? 0)
      || value < (smoothed[frameIndex + 1] ?? 0)
      || frameIndex - lastOnsetFrame < minSpacingFrames
    ) {
      continue;
    }

    const normalizedStrength = peakFlux > 0 ? value / peakFlux : 0;
    onsets.push({
      time: (frameIndex * parameters.hopSize) / buffer.sampleRate,
      strength: clamp01(normalizedStrength),
      confidence: clamp01((value - threshold) / Math.max(deviation, 1e-12)),
    });
    lastOnsetFrame = frameIndex;
  }

  return { flux: smoothed, onsets };
}

function estimateBeatGrid(onsets: readonly AudioEvent[], duration: number): BeatEstimate {
  if (onsets.length < 2 || duration <= 0) {
    return { confidence: 0, beats: [] };
  }

  const tempoBins = new Float32Array(MAX_TEMPO_BPM - MIN_TEMPO_BPM + 1);
  for (let left = 0; left < onsets.length; left += 1) {
    for (let right = left + 1; right < Math.min(onsets.length, left + 8); right += 1) {
      const interval = (onsets[right]?.time ?? 0) - (onsets[left]?.time ?? 0);
      if (interval <= 0) continue;
      let bpm = 60 / interval;
      while (bpm < MIN_TEMPO_BPM) bpm *= 2;
      while (bpm > MAX_TEMPO_BPM) bpm /= 2;
      if (bpm < MIN_TEMPO_BPM || bpm > MAX_TEMPO_BPM) continue;
      const bin = Math.round(bpm) - MIN_TEMPO_BPM;
      const weight = ((onsets[left]?.strength ?? 0) + (onsets[right]?.strength ?? 0)) / 2;
      tempoBins[bin] += weight;
    }
  }

  let bestBin = -1;
  let bestScore = 0;
  let totalScore = 0;
  for (let bin = 0; bin < tempoBins.length; bin += 1) {
    const score = tempoBins[bin] ?? 0;
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestBin = bin;
    }
  }

  if (bestBin < 0 || bestScore <= 0) {
    return { confidence: 0, beats: [] };
  }

  const tempoBpm = MIN_TEMPO_BPM + bestBin;
  const interval = 60 / tempoBpm;
  const phase = onsets.toSorted((a, b) => b.strength - a.strength)[0]?.time ?? 0;
  const firstBeat = phase - Math.ceil(phase / interval) * interval;
  const beats: AudioEvent[] = [];

  for (let time = firstBeat; time <= duration + interval * 0.5; time += interval) {
    if (time < 0) continue;
    const nearest = onsets.reduce<AudioEvent | null>((best, onset) => {
      const distance = Math.abs(onset.time - time);
      if (distance > interval * 0.33) return best;
      if (!best) return onset;
      return distance < Math.abs(best.time - time) ? onset : best;
    }, null);
    const distance = nearest ? Math.abs(nearest.time - time) : interval * 0.33;
    const proximity = 1 - Math.min(1, distance / Math.max(interval * 0.33, 1e-6));
    beats.push({
      time,
      strength: nearest?.strength ?? 0,
      confidence: clamp01((nearest?.confidence ?? 0.35) * 0.5 + proximity * 0.5),
    });
  }

  return {
    tempoBpm,
    confidence: clamp01(bestScore / Math.max(totalScore, 1e-12)),
    beats,
  };
}

function summarizeOnsets(onsets: readonly AudioEvent[]) {
  const peakStrength = onsets.reduce((peak, event) => Math.max(peak, event.strength), 0);
  const averageStrength = onsets.length > 0
    ? onsets.reduce((sum, event) => sum + event.strength, 0) / onsets.length
    : 0;
  return {
    eventCount: onsets.length,
    averageStrength,
    peakStrength,
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createBeatOnsetAnalyzerVersion(
  parameters: Pick<NormalizedBeatOnsetParameters, 'fftSize' | 'hopSize'>,
  baseVersion = BEAT_ONSET_ANALYZER_VERSION,
): string {
  return [
    baseVersion,
    `onsetManifest=v${ONSET_MAP_MANIFEST_VERSION}`,
    `beatManifest=v${BEAT_GRID_MANIFEST_VERSION}`,
    `payload=v${AUDIO_EVENT_LIST_PAYLOAD_VERSION}`,
    `fft=${parameters.fftSize}`,
    `hop=${parameters.hopSize}`,
    'window=hann',
    'onset=spectral-flux-adaptive',
    `tempo=${MIN_TEMPO_BPM}-${MAX_TEMPO_BPM}`,
    'channels=mono-mix',
  ].join(';');
}

export class BeatOnsetAnalysisGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: BeatOnsetAnalysisGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? BEAT_ONSET_ANALYZER_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: BeatOnsetAnalysisRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: BeatOnsetAnalysisProgress) => void;
    } = {},
  ): Promise<BeatOnsetAnalysisResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: GenerationContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createBeatOnsetAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const channelLayout = describeDisplayChannelLayout();
      const onsetCacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'onset-map',
        analyzerVersion,
        channelLayout,
        sampleRate: request.buffer.sampleRate,
        duration: request.buffer.duration,
        clipAudioStateHash: request.clipAudioStateHash,
      });
      const beatCacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'beat-grid',
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
        onsetCacheKey,
        beatCacheKey,
        signal: options.signal,
        onProgress: options.onProgress,
      };
      progressContext = context;

      this.emitProgress(context, {
        phase: 'queued',
        percent: 0,
        timestamp: generatedAt,
        message: 'Queued beat/onset analysis',
      });

      const fluxAnalysis = analyzeSpectralFlux(request.buffer, parameters, context);
      const beatEstimate = estimateBeatGrid(fluxAnalysis.onsets, request.buffer.duration);

      const onsetPayloadRef = await this.storeEventsPayload({
        request,
        kind: 'onset-map',
        cacheKey: onsetCacheKey,
        analyzerVersion,
        generatedAt,
        events: fluxAnalysis.onsets,
        context,
      });
      const onsetManifest = createOnsetMapManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        fftSize: parameters.fftSize,
        hopSize: parameters.hopSize,
        detectionFunction: 'spectral-flux',
        eventCount: fluxAnalysis.onsets.length,
        eventsPayloadRef: onsetPayloadRef,
        summary: summarizeOnsets(fluxAnalysis.onsets),
      });

      const onsetArtifactId = await deterministicHashId('audio:onset-map', onsetCacheKey);
      this.emitProgress(context, {
        phase: 'storing-manifests',
        percent: 86,
        timestamp: this.now(),
        message: 'Storing onset manifest',
      });
      const onsetArtifactResult = await this.artifactStore.putAnalysisArtifact({
        id: onsetArtifactId,
        kind: 'onset-map',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        payloadRefs: [onsetPayloadRef],
        createdAt: toTimestamp(generatedAt),
        stale: false,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'onset-map',
          cacheKey: onsetCacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          onsetMapManifest: onsetManifest as unknown as JsonValue,
        },
      });

      const beatPayloadRef = await this.storeEventsPayload({
        request,
        kind: 'beat-grid',
        cacheKey: beatCacheKey,
        analyzerVersion,
        generatedAt,
        events: beatEstimate.beats,
        context,
      });
      const beatManifest = createBeatGridManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        tempoBpm: beatEstimate.tempoBpm,
        beatCount: beatEstimate.beats.length,
        beatsPayloadRef: beatPayloadRef,
        sourceOnsetMapArtifactId: onsetArtifactResult.artifact.manifestRef.artifactId,
        summary: {
          beatCount: beatEstimate.beats.length,
          tempoBpm: beatEstimate.tempoBpm,
          confidence: beatEstimate.confidence,
        },
      });
      const beatArtifactId = await deterministicHashId('audio:beat-grid', beatCacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifests',
        percent: 96,
        timestamp: this.now(),
        message: 'Storing beat grid manifest',
      });
      const beatArtifactResult = await this.artifactStore.putAnalysisArtifact({
        id: beatArtifactId,
        kind: 'beat-grid',
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        decoderId: request.decoderId ?? DEFAULT_DECODER_ID,
        decoderVersion: request.decoderVersion ?? DEFAULT_DECODER_VERSION,
        analyzerVersion,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        payloadRefs: [beatPayloadRef],
        createdAt: toTimestamp(generatedAt),
        stale: false,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'beat-grid',
          cacheKey: beatCacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          beatGridManifest: beatManifest as unknown as JsonValue,
        },
      });

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Beat/onset analysis complete',
      });

      return {
        jobId,
        onsetCacheKey,
        beatCacheKey,
        onsetAnalysisRef: createAudioAnalysisManifestRefFromArtifact(onsetArtifactResult.artifact),
        beatAnalysisRef: createAudioAnalysisManifestRefFromArtifact(beatArtifactResult.artifact),
        onsetArtifact: onsetArtifactResult.artifact,
        beatArtifact: beatArtifactResult.artifact,
        onsetManifest,
        beatManifest,
        onsetPayloadRef,
        beatPayloadRef,
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
          onsetCacheKey: 'cancelled-before-onset-cache-key',
          beatCacheKey: 'cancelled-before-beat-cache-key',
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

      throw error instanceof BeatOnsetAnalysisGeneratorError
        ? error
        : new BeatOnsetAnalysisGeneratorError(
          `Beat/onset analysis ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private async storeEventsPayload(input: {
    request: BeatOnsetAnalysisRequest;
    kind: 'onset-map' | 'beat-grid';
    cacheKey: string;
    analyzerVersion: string;
    generatedAt: string;
    events: readonly AudioEvent[];
    context: GenerationContext;
  }): Promise<AudioArtifactRef> {
    this.emitProgress(input.context, {
      phase: 'storing-payloads',
      percent: input.kind === 'onset-map' ? 72 : 90,
      timestamp: this.now(),
      message: `Storing ${input.kind} event payload`,
    });

    return this.artifactStore.putPayload(encodeAudioEventListPayload({
      header: {
        schemaVersion: AUDIO_EVENT_LIST_PAYLOAD_VERSION,
        kind: input.kind,
        eventCount: input.events.length,
        valueLayout: 'event-major',
        valueEncoding: 'time-strength-confidence-f32',
        timeUnit: 'seconds',
      },
      values: eventsToFloat32(input.events),
    }), {
      mediaFileId: input.request.mediaFileId,
      kind: input.kind,
      sourceFingerprint: input.request.sourceFingerprint,
      clipAudioStateHash: input.request.clipAudioStateHash,
      mimeType: AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion: input.analyzerVersion,
      createdAt: input.generatedAt,
      sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
      metadata: {
        cacheKey: input.cacheKey,
        eventCount: input.events.length,
        valueEncoding: 'time-strength-confidence-f32',
      },
    });
  }

  private emitProgress(
    context: GenerationContext,
    update: Omit<
      BeatOnsetAnalysisProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'onsetCacheKey' | 'beatCacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: BeatOnsetAnalysisProgress = {
      ...update,
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      onsetCacheKey: context.onsetCacheKey,
      beatCacheKey: context.beatCacheKey,
      percent: clampPercent(update.percent),
    };
    context.onProgress?.(progress);

    if (checkCancellation) {
      throwIfCancelled(context.signal, context.jobId);
    }
  }
}
