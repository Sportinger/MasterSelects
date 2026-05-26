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
  LOUDNESS_CURVE_PAYLOAD_VERSION,
  LOUDNESS_ENVELOPE_MANIFEST_VERSION,
  createLoudnessEnvelopeManifest,
  encodeLoudnessCurvePayload,
  type LoudnessCurvePayloadRef,
  type LoudnessEnvelopeManifest,
  type LoudnessEnvelopeMetric,
  type LoudnessEnvelopeSummary,
} from './loudnessEnvelopeManifest';

export const LOUDNESS_ENVELOPE_GENERATOR_VERSION = 'masterselects.loudness-envelope-generator@1.0.0';
export const LOUDNESS_CURVE_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.loudness-curve';

export type LoudnessEnvelopeGenerationPhase =
  | 'queued'
  | 'analyzing'
  | 'storing-payloads'
  | 'storing-manifest'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type LoudnessEnvelopeGeneratorErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface LoudnessEnvelopeGenerationProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: LoudnessEnvelopeGenerationPhase;
  percent: number;
  timestamp: string;
  cacheKey: string;
  metric?: LoudnessEnvelopeMetric;
  pointCount?: number;
  message?: string;
}

export interface LoudnessEnvelopeGeneratorOptions {
  artifactStore: AudioArtifactStore;
  analyzerVersion?: string;
  now?: () => string;
  createJobId?: () => string;
}

export interface LoudnessEnvelopeGenerateRequest {
  jobId?: string;
  mediaFileId: string;
  sourceFingerprint: string;
  buffer: AudioBuffer;
  clipAudioStateHash?: string;
  metrics?: readonly LoudnessEnvelopeMetric[];
  windowDuration?: number;
  hopDuration?: number;
  shortTermWindowDuration?: number;
  decoderId?: string;
  decoderVersion?: string;
  metadata?: SignalMetadata;
}

export interface LoudnessEnvelopeGenerationResult {
  jobId: string;
  cacheKey: string;
  analysisRef: AudioAnalysisManifestRef;
  artifact: AudioAnalysisArtifact;
  manifest: LoudnessEnvelopeManifest;
  payloadRefs: AudioArtifactRef[];
  warnings: AudioAnalysisWarning[];
}

interface NormalizedLoudnessParameters {
  metrics: LoudnessEnvelopeMetric[];
  windowDuration: number;
  hopDuration: number;
  shortTermWindowDuration: number;
}

interface LoudnessCurveData {
  metric: LoudnessEnvelopeMetric;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  values: Float32Array;
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

interface GenerationContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  cacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: LoudnessEnvelopeGenerationProgress) => void;
}

const DEFAULT_METRICS = [
  'momentary-lufs',
  'short-term-lufs',
  'rms-dbfs',
  'sample-peak-dbfs',
] as const satisfies readonly LoudnessEnvelopeMetric[];
const DEFAULT_WINDOW_DURATION = 0.4;
const DEFAULT_HOP_DURATION = 0.1;
const DEFAULT_SHORT_TERM_WINDOW_DURATION = 3;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const LUFS_SILENCE_FLOOR = -120;
const RMS_SILENCE_FLOOR_DBFS = -120;
const textEncoder = new TextEncoder();

export class LoudnessEnvelopeGeneratorError extends Error {
  readonly code: LoudnessEnvelopeGeneratorErrorCode;
  readonly jobId: string;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: {
      code: LoudnessEnvelopeGeneratorErrorCode;
      jobId: string;
      recoverable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = options.code === 'cancelled'
      ? 'LoudnessEnvelopeGenerationCancelledError'
      : 'LoudnessEnvelopeGeneratorError';
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
  return `loudness-envelope:${randomId}`;
}

function getAbortReason(signal: AbortSignal): unknown {
  return 'reason' in signal ? signal.reason : undefined;
}

function cancelledError(jobId: string, reason?: unknown): LoudnessEnvelopeGeneratorError {
  const suffix = reason === undefined ? '' : `: ${String(reason)}`;
  return new LoudnessEnvelopeGeneratorError(`Loudness envelope generation ${jobId} was cancelled${suffix}`, {
    code: 'cancelled',
    jobId,
    recoverable: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellationError(error: unknown): error is LoudnessEnvelopeGeneratorError {
  return error instanceof LoudnessEnvelopeGeneratorError && error.code === 'cancelled';
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

function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function assertPositiveFinite(value: number, label: string, jobId: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new LoudnessEnvelopeGeneratorError(`${label} must be a positive finite number.`, {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }
}

function validateAudioBuffer(buffer: AudioBuffer, jobId: string): void {
  if (!buffer || typeof buffer !== 'object') {
    throw new LoudnessEnvelopeGeneratorError('Loudness envelope generation requires an AudioBuffer.', {
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
    throw new LoudnessEnvelopeGeneratorError('AudioBuffer metadata is invalid for loudness envelope generation.', {
      code: 'invalid-audio-buffer',
      jobId,
      recoverable: false,
    });
  }
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

function normalizeParameters(
  request: LoudnessEnvelopeGenerateRequest,
  jobId: string,
): NormalizedLoudnessParameters {
  const metrics = [...new Set(request.metrics ?? DEFAULT_METRICS)]
    .toSorted((a, b) => a.localeCompare(b));
  if (metrics.length === 0) {
    throw new LoudnessEnvelopeGeneratorError('Loudness generation requires at least one metric.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  const windowDuration = request.windowDuration ?? DEFAULT_WINDOW_DURATION;
  const hopDuration = request.hopDuration ?? DEFAULT_HOP_DURATION;
  const shortTermWindowDuration = request.shortTermWindowDuration ?? DEFAULT_SHORT_TERM_WINDOW_DURATION;
  assertPositiveFinite(windowDuration, 'windowDuration', jobId);
  assertPositiveFinite(hopDuration, 'hopDuration', jobId);
  assertPositiveFinite(shortTermWindowDuration, 'shortTermWindowDuration', jobId);

  if (shortTermWindowDuration < windowDuration) {
    throw new LoudnessEnvelopeGeneratorError('shortTermWindowDuration must be at least windowDuration.', {
      code: 'invalid-parameters',
      jobId,
      recoverable: false,
    });
  }

  return {
    metrics,
    windowDuration,
    hopDuration,
    shortTermWindowDuration,
  };
}

function normalizeBiquad(coefficients: {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}): BiquadCoefficients {
  return {
    b0: coefficients.b0 / coefficients.a0,
    b1: coefficients.b1 / coefficients.a0,
    b2: coefficients.b2 / coefficients.a0,
    a1: coefficients.a1 / coefficients.a0,
    a2: coefficients.a2 / coefficients.a0,
  };
}

function createHighShelfCoefficients(
  sampleRate: number,
  frequency: number,
  q: number,
  gainDb: number,
): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const sqrtA = Math.sqrt(a);

  return normalizeBiquad({
    b0: a * ((a + 1) + (a - 1) * cos + 2 * sqrtA * alpha),
    b1: -2 * a * ((a - 1) + (a + 1) * cos),
    b2: a * ((a + 1) + (a - 1) * cos - 2 * sqrtA * alpha),
    a0: (a + 1) - (a - 1) * cos + 2 * sqrtA * alpha,
    a1: 2 * ((a - 1) - (a + 1) * cos),
    a2: (a + 1) - (a - 1) * cos - 2 * sqrtA * alpha,
  });
}

function createHighPassCoefficients(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);

  return normalizeBiquad({
    b0: (1 + cos) / 2,
    b1: -(1 + cos),
    b2: (1 + cos) / 2,
    a0: 1 + alpha,
    a1: -2 * cos,
    a2: 1 - alpha,
  });
}

function applyBiquad(input: Float32Array, coefficients: BiquadCoefficients): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let index = 0; index < input.length; index += 1) {
    const x0 = safeSample(input[index] ?? 0);
    const y0 = coefficients.b0 * x0
      + coefficients.b1 * x1
      + coefficients.b2 * x2
      - coefficients.a1 * y1
      - coefficients.a2 * y2;
    output[index] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = output[index];
  }

  return output;
}

function applyKWeighting(data: Float32Array, sampleRate: number): Float32Array {
  const shelfFrequency = Math.min(1_681.974450955533, Math.max(1, sampleRate * 0.45));
  const highPassFrequency = Math.min(38.13547087602444, Math.max(1, sampleRate * 0.2));
  const shelf = createHighShelfCoefficients(sampleRate, shelfFrequency, 0.7071752369554196, 3.99984385397);
  const highPass = createHighPassCoefficients(sampleRate, highPassFrequency, 0.5003270373238773);
  return applyBiquad(applyBiquad(data, shelf), highPass);
}

function loudnessChannelWeight(channelIndex: number, channelCount: number): number {
  if (channelCount >= 6 && channelIndex === 3) {
    return 0;
  }

  if (channelCount >= 6 && (channelIndex === 4 || channelIndex === 5)) {
    return 1.41;
  }

  return 1;
}

function createWeightedKPower(buffer: AudioBuffer, context: GenerationContext): Float64Array {
  const power = new Float64Array(buffer.length);

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    context.onProgress?.({
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      cacheKey: context.cacheKey,
      phase: 'analyzing',
      percent: 10 + (channelIndex / buffer.numberOfChannels) * 35,
      timestamp: new Date().toISOString(),
      message: 'Applying K-weighting',
    });
    throwIfCancelled(context.signal, context.jobId);

    const weighted = applyKWeighting(buffer.getChannelData(channelIndex), buffer.sampleRate);
    const channelWeight = loudnessChannelWeight(channelIndex, buffer.numberOfChannels);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      const sample = weighted[sampleIndex] ?? 0;
      power[sampleIndex] += channelWeight * sample * sample;
    }
  }

  return power;
}

function createRawMonoMix(buffer: AudioBuffer): Float32Array {
  const mix = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      mix[sampleIndex] += safeSample(data[sampleIndex] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mix;
}

function createRawPeakEnvelope(buffer: AudioBuffer): Float32Array {
  const peak = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      peak[sampleIndex] = Math.max(peak[sampleIndex], Math.abs(safeSample(data[sampleIndex] ?? 0)));
    }
  }
  return peak;
}

function createPowerPrefix(values: Float64Array | Float32Array): Float64Array {
  const prefix = new Float64Array(values.length + 1);
  for (let index = 0; index < values.length; index += 1) {
    prefix[index + 1] = prefix[index] + Math.max(0, safeSample(values[index] ?? 0));
  }
  return prefix;
}

function pointCountFor(bufferLength: number, sampleRate: number, hopDuration: number): number {
  const hopSamples = Math.max(1, Math.round(hopDuration * sampleRate));
  return Math.max(1, Math.ceil(Math.max(1, bufferLength) / hopSamples));
}

function powerToLufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : LUFS_SILENCE_FLOOR;
}

function amplitudeToDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : RMS_SILENCE_FLOOR_DBFS;
}

function createPowerLoudnessCurve(input: {
  weightedPowerPrefix: Float64Array;
  bufferLength: number;
  sampleRate: number;
  windowDuration: number;
  hopDuration: number;
}): Float32Array {
  const windowSamples = Math.max(1, Math.round(input.windowDuration * input.sampleRate));
  const hopSamples = Math.max(1, Math.round(input.hopDuration * input.sampleRate));
  const pointCount = pointCountFor(input.bufferLength, input.sampleRate, input.hopDuration);
  const values = new Float32Array(pointCount);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(input.bufferLength, start + windowSamples);
    const count = Math.max(0, end - start);
    const power = count > 0
      ? ((input.weightedPowerPrefix[end] ?? 0) - (input.weightedPowerPrefix[start] ?? 0)) / count
      : 0;
    values[pointIndex] = powerToLufs(power);
  }

  return values;
}

function createRmsCurve(input: {
  rawSquarePrefix: Float64Array;
  bufferLength: number;
  sampleRate: number;
  windowDuration: number;
  hopDuration: number;
}): Float32Array {
  const windowSamples = Math.max(1, Math.round(input.windowDuration * input.sampleRate));
  const hopSamples = Math.max(1, Math.round(input.hopDuration * input.sampleRate));
  const pointCount = pointCountFor(input.bufferLength, input.sampleRate, input.hopDuration);
  const values = new Float32Array(pointCount);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(input.bufferLength, start + windowSamples);
    const count = Math.max(0, end - start);
    const meanSquare = count > 0
      ? ((input.rawSquarePrefix[end] ?? 0) - (input.rawSquarePrefix[start] ?? 0)) / count
      : 0;
    values[pointIndex] = amplitudeToDbfs(Math.sqrt(meanSquare));
  }

  return values;
}

function createSamplePeakCurve(input: {
  rawPeak: Float32Array;
  bufferLength: number;
  sampleRate: number;
  windowDuration: number;
  hopDuration: number;
}): Float32Array {
  const windowSamples = Math.max(1, Math.round(input.windowDuration * input.sampleRate));
  const hopSamples = Math.max(1, Math.round(input.hopDuration * input.sampleRate));
  const pointCount = pointCountFor(input.bufferLength, input.sampleRate, input.hopDuration);
  const values = new Float32Array(pointCount);

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(input.bufferLength, start + windowSamples);
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, input.rawPeak[sampleIndex] ?? 0);
    }
    values[pointIndex] = amplitudeToDbfs(peak);
  }

  return values;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeIntegratedLufs(
  weightedPowerPrefix: Float64Array,
  bufferLength: number,
  sampleRate: number,
): number {
  const blockDuration = 0.4;
  const hopDuration = 0.1;
  const windowSamples = Math.max(1, Math.round(blockDuration * sampleRate));
  const hopSamples = Math.max(1, Math.round(hopDuration * sampleRate));
  const pointCount = pointCountFor(bufferLength, sampleRate, hopDuration);
  const blocks: Array<{ power: number; loudness: number }> = [];

  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const start = pointIndex * hopSamples;
    const end = Math.min(bufferLength, start + windowSamples);
    const count = Math.max(0, end - start);
    const power = count > 0
      ? ((weightedPowerPrefix[end] ?? 0) - (weightedPowerPrefix[start] ?? 0)) / count
      : 0;
    blocks.push({ power, loudness: powerToLufs(power) });
  }

  const absoluteGated = blocks.filter(block => block.loudness >= -70);
  if (absoluteGated.length === 0) {
    return LUFS_SILENCE_FLOOR;
  }

  const preliminary = powerToLufs(average(absoluteGated.map(block => block.power)));
  const relativeGate = preliminary - 10;
  const gated = absoluteGated.filter(block => block.loudness >= relativeGate);
  if (gated.length === 0) {
    return preliminary;
  }

  return powerToLufs(average(gated.map(block => block.power)));
}

function computeRawRmsDbfs(buffer: AudioBuffer): number {
  let squareSum = 0;
  let sampleCount = 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      const sample = safeSample(data[sampleIndex] ?? 0);
      squareSum += sample * sample;
      sampleCount += 1;
    }
  }

  return sampleCount > 0 ? amplitudeToDbfs(Math.sqrt(squareSum / sampleCount)) : RMS_SILENCE_FLOOR_DBFS;
}

function computeSamplePeakDbfs(rawPeak: Float32Array): number {
  let peak = 0;
  for (const sample of rawPeak) {
    peak = Math.max(peak, sample);
  }
  return amplitudeToDbfs(peak);
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function computePreviewTruePeakDbtp(buffer: AudioBuffer, oversample = 4): number {
  let peak = 0;

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      const p0 = safeSample(data[Math.max(0, sampleIndex - 1)] ?? 0);
      const p1 = safeSample(data[sampleIndex] ?? 0);
      const p2 = safeSample(data[Math.min(buffer.length - 1, sampleIndex + 1)] ?? 0);
      const p3 = safeSample(data[Math.min(buffer.length - 1, sampleIndex + 2)] ?? 0);
      peak = Math.max(peak, Math.abs(p1));

      for (let step = 1; step < oversample; step += 1) {
        peak = Math.max(peak, Math.abs(catmullRom(p0, p1, p2, p3, step / oversample)));
      }
    }
  }

  return amplitudeToDbfs(peak);
}

function createRawSquarePrefix(mix: Float32Array): Float64Array {
  const squares = new Float64Array(mix.length);
  for (let index = 0; index < mix.length; index += 1) {
    const sample = mix[index] ?? 0;
    squares[index] = sample * sample;
  }
  return createPowerPrefix(squares);
}

export function analyzeAudioBufferLoudnessSummary(buffer: AudioBuffer): LoudnessEnvelopeSummary {
  validateAudioBuffer(buffer, 'loudness-summary');
  const context: GenerationContext = {
    jobId: 'loudness-summary',
    mediaFileId: 'preflight',
    sourceFingerprint: 'preflight',
    cacheKey: 'preflight',
  };
  const weightedPower = createWeightedKPower(buffer, context);
  const weightedPowerPrefix = createPowerPrefix(weightedPower);
  const rawPeak = createRawPeakEnvelope(buffer);

  return {
    integratedLufs: computeIntegratedLufs(weightedPowerPrefix, buffer.length, buffer.sampleRate),
    truePeakDbtp: computePreviewTruePeakDbtp(buffer),
    samplePeakDbfs: computeSamplePeakDbfs(rawPeak),
    rmsDbfs: computeRawRmsDbfs(buffer),
  };
}

async function deterministicHashId(prefix: string, cacheKey: string): Promise<string> {
  const bytes = textEncoder.encode(cacheKey);
  const hash = await sha256ArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return `${prefix}:${hash}`;
}

export function createLoudnessEnvelopeAnalyzerVersion(
  parameters: NormalizedLoudnessParameters,
  baseVersion = LOUDNESS_ENVELOPE_GENERATOR_VERSION,
): string {
  return [
    baseVersion,
    `manifest=v${LOUDNESS_ENVELOPE_MANIFEST_VERSION}`,
    `payload=v${LOUDNESS_CURVE_PAYLOAD_VERSION}`,
    `metrics=${parameters.metrics.join(',')}`,
    `window=${parameters.windowDuration}`,
    `hop=${parameters.hopDuration}`,
    `shortWindow=${parameters.shortTermWindowDuration}`,
    'lufs=bs1770-k-weighted-gated-integrated',
    'truePeak=4x-cubic-preview',
    'channels=mono-mix',
  ].join(';');
}

export class LoudnessEnvelopeGenerator {
  private readonly artifactStore: AudioArtifactStore;
  private readonly baseAnalyzerVersion: string;
  private readonly now: () => string;
  private readonly createJobId: () => string;

  constructor(options: LoudnessEnvelopeGeneratorOptions) {
    this.artifactStore = options.artifactStore;
    this.baseAnalyzerVersion = options.analyzerVersion ?? LOUDNESS_ENVELOPE_GENERATOR_VERSION;
    this.now = options.now ?? defaultNow;
    this.createJobId = options.createJobId ?? defaultJobId;
  }

  async generate(
    request: LoudnessEnvelopeGenerateRequest,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: LoudnessEnvelopeGenerationProgress) => void;
    } = {},
  ): Promise<LoudnessEnvelopeGenerationResult> {
    const jobId = request.jobId ?? this.createJobId();
    const generatedAt = this.now();
    let progressContext: GenerationContext | null = null;

    try {
      validateAudioBuffer(request.buffer, jobId);
      const parameters = normalizeParameters(request, jobId);
      const analyzerVersion = createLoudnessEnvelopeAnalyzerVersion(parameters, this.baseAnalyzerVersion);
      const channelLayout = describeDisplayChannelLayout();
      const cacheKey = createAudioAnalysisCacheKey({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        kind: 'loudness-envelope',
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
        message: 'Queued loudness envelope generation',
      });
      throwIfCancelled(options.signal, jobId);

      const analyzed = this.analyzeCurves(request.buffer, parameters, context);
      const stored = await this.storePayloads({
        request,
        analyzerVersion,
        generatedAt,
        context,
        curves: analyzed.curves,
      });
      const manifest = createLoudnessEnvelopeManifest({
        mediaFileId: request.mediaFileId,
        sourceFingerprint: request.sourceFingerprint,
        clipAudioStateHash: request.clipAudioStateHash,
        sampleRate: request.buffer.sampleRate,
        channelLayout,
        duration: request.buffer.duration,
        curves: stored.curves,
        summary: analyzed.summary,
      });
      const artifactId = await deterministicHashId('audio:loudness-envelope', cacheKey);

      this.emitProgress(context, {
        phase: 'storing-manifest',
        percent: 98,
        timestamp: this.now(),
        message: 'Storing loudness envelope manifest',
      });
      throwIfCancelled(options.signal, jobId);

      const warnings: AudioAnalysisWarning[] = [{
        code: 'partial',
        message: 'True peak is stored as a 4x cubic-interpolated preview meter value.',
        details: {
          truePeakMode: '4x-cubic-interpolated-preview',
          integratedLufsMode: 'bs1770-k-weighted-relative-gated',
        },
      }];
      const artifactResult = await this.artifactStore.putAnalysisArtifact({
        id: artifactId,
        kind: 'loudness-envelope',
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
        warnings,
        metadata: {
          ...(request.metadata ?? {}),
          analysisKind: 'loudness-envelope',
          cacheKey,
          sourceChannelLayout: describeSourceChannelLayout(request.buffer.numberOfChannels) as unknown as JsonValue,
          loudnessEnvelopeManifest: manifest as unknown as JsonValue,
          integratedLufsMode: 'bs1770-k-weighted-relative-gated',
          truePeakMode: '4x-cubic-interpolated-preview',
        },
      });
      const analysisRef = createAudioAnalysisManifestRefFromArtifact(artifactResult.artifact);

      this.emitProgress(context, {
        phase: 'complete',
        percent: 100,
        timestamp: this.now(),
        message: 'Loudness envelope generation complete',
      });

      return {
        jobId,
        cacheKey,
        analysisRef,
        artifact: artifactResult.artifact,
        manifest,
        payloadRefs: stored.payloadRefs,
        warnings,
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

      throw error instanceof LoudnessEnvelopeGeneratorError
        ? error
        : new LoudnessEnvelopeGeneratorError(
          `Loudness envelope generation ${jobId} failed: ${errorMessage(error)}`,
          {
            code: 'artifact-store-failed',
            jobId,
            cause: error,
          },
        );
    }
  }

  private analyzeCurves(
    buffer: AudioBuffer,
    parameters: NormalizedLoudnessParameters,
    context: GenerationContext,
  ): { curves: LoudnessCurveData[]; summary: LoudnessEnvelopeSummary } {
    this.emitProgress(context, {
      phase: 'analyzing',
      percent: 5,
      timestamp: this.now(),
      message: 'Preparing loudness analysis buffers',
    });

    const weightedPower = createWeightedKPower(buffer, context);
    const weightedPowerPrefix = createPowerPrefix(weightedPower);
    const rawMix = createRawMonoMix(buffer);
    const rawSquarePrefix = createRawSquarePrefix(rawMix);
    const rawPeak = createRawPeakEnvelope(buffer);
    const curves: LoudnessCurveData[] = [];
    const metricCount = parameters.metrics.length;

    for (let metricIndex = 0; metricIndex < metricCount; metricIndex += 1) {
      const metric = parameters.metrics[metricIndex];
      this.emitProgress(context, {
        phase: 'analyzing',
        percent: 45 + (metricIndex / Math.max(1, metricCount)) * 35,
        timestamp: this.now(),
        metric,
        message: 'Computing loudness curve',
      });
      throwIfCancelled(context.signal, context.jobId);

      if (metric === 'momentary-lufs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.windowDuration,
          hopDuration: parameters.hopDuration,
          values: createPowerLoudnessCurve({
            weightedPowerPrefix,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.windowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'short-term-lufs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.shortTermWindowDuration,
          hopDuration: parameters.hopDuration,
          values: createPowerLoudnessCurve({
            weightedPowerPrefix,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.shortTermWindowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'rms-dbfs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.windowDuration,
          hopDuration: parameters.hopDuration,
          values: createRmsCurve({
            rawSquarePrefix,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.windowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'sample-peak-dbfs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: parameters.windowDuration,
          hopDuration: parameters.hopDuration,
          values: createSamplePeakCurve({
            rawPeak,
            bufferLength: buffer.length,
            sampleRate: buffer.sampleRate,
            windowDuration: parameters.windowDuration,
            hopDuration: parameters.hopDuration,
          }),
        });
      } else if (metric === 'true-peak-dbtp') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: buffer.duration || parameters.windowDuration,
          hopDuration: buffer.duration || parameters.hopDuration,
          values: Float32Array.from([computePreviewTruePeakDbtp(buffer)]),
        });
      } else if (metric === 'integrated-lufs') {
        curves.push({
          metric,
          channelIndex: 0,
          windowDuration: buffer.duration || parameters.windowDuration,
          hopDuration: buffer.duration || parameters.hopDuration,
          values: Float32Array.from([computeIntegratedLufs(weightedPowerPrefix, buffer.length, buffer.sampleRate)]),
        });
      }
    }

    const summary: LoudnessEnvelopeSummary = {
      integratedLufs: computeIntegratedLufs(weightedPowerPrefix, buffer.length, buffer.sampleRate),
      truePeakDbtp: computePreviewTruePeakDbtp(buffer),
      samplePeakDbfs: computeSamplePeakDbfs(rawPeak),
      rmsDbfs: computeRawRmsDbfs(buffer),
    };

    return { curves, summary };
  }

  private async storePayloads(input: {
    request: LoudnessEnvelopeGenerateRequest;
    analyzerVersion: string;
    generatedAt: string;
    context: GenerationContext;
    curves: LoudnessCurveData[];
  }): Promise<{
    curves: LoudnessCurvePayloadRef[];
    payloadRefs: AudioArtifactRef[];
  }> {
    const payloadRefs: AudioArtifactRef[] = [];
    const curves: LoudnessCurvePayloadRef[] = [];

    for (let curveIndex = 0; curveIndex < input.curves.length; curveIndex += 1) {
      const curve = input.curves[curveIndex];
      this.emitProgress(input.context, {
        phase: 'storing-payloads',
        percent: 80 + (curveIndex / Math.max(1, input.curves.length)) * 15,
        timestamp: this.now(),
        metric: curve.metric,
        pointCount: curve.values.length,
        message: 'Storing loudness curve payload',
      });
      throwIfCancelled(input.context.signal, input.context.jobId);

      const payloadRef = await this.artifactStore.putPayload(encodeLoudnessCurvePayload({
        header: {
          schemaVersion: LOUDNESS_CURVE_PAYLOAD_VERSION,
          metric: curve.metric,
          channelIndex: curve.channelIndex,
          windowDuration: curve.windowDuration,
          hopDuration: curve.hopDuration,
          pointCount: curve.values.length,
          valueLayout: 'time-series',
          valueEncoding: 'db',
        },
        values: curve.values,
      }), {
        mediaFileId: input.request.mediaFileId,
        kind: 'loudness-envelope',
        sourceFingerprint: input.request.sourceFingerprint,
        clipAudioStateHash: input.request.clipAudioStateHash,
        mimeType: LOUDNESS_CURVE_PAYLOAD_MIME_TYPE,
        encoding: 'raw',
        analyzerVersion: input.analyzerVersion,
        createdAt: input.generatedAt,
        sourceRefs: [`audio-analysis-cache:${input.context.cacheKey}`],
        metadata: {
          cacheKey: input.context.cacheKey,
          metric: curve.metric,
          channelIndex: curve.channelIndex ?? 0,
          windowDuration: curve.windowDuration,
          hopDuration: curve.hopDuration,
          pointCount: curve.values.length,
          valueEncoding: 'db',
        },
      });

      payloadRefs.push(payloadRef);
      curves.push({
        metric: curve.metric,
        channelIndex: curve.channelIndex,
        windowDuration: curve.windowDuration,
        hopDuration: curve.hopDuration,
        pointCount: curve.values.length,
        payloadRef,
      });
    }

    return { curves, payloadRefs };
  }

  private emitProgress(
    context: GenerationContext,
    update: Omit<
      LoudnessEnvelopeGenerationProgress,
      'jobId' | 'mediaFileId' | 'sourceFingerprint' | 'cacheKey'
    >,
    checkCancellation = true,
  ): void {
    const progress: LoudnessEnvelopeGenerationProgress = {
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
