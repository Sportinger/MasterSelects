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
  FREQUENCY_BAND_PAYLOAD_VERSION,
  FREQUENCY_SUMMARY_MANIFEST_VERSION,
  PHASE_CORRELATION_MANIFEST_VERSION,
  PHASE_CORRELATION_PAYLOAD_VERSION,
  createFrequencySummaryManifest,
  createPhaseCorrelationManifest,
  encodeFrequencyBandPayload,
  encodePhaseCorrelationPayload,
  frequencyBandsToFloat32,
  phaseCorrelationPointsToFloat32,
  type FrequencyBandSummary,
  type FrequencySummaryManifest,
  type PhaseCorrelationManifest,
  type PhaseCorrelationPoint,
} from './frequencyPhaseManifest';

export const FREQUENCY_PHASE_ANALYZER_VERSION = 'masterselects.frequency-phase-analysis@1.0.0';
export const FREQUENCY_BAND_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.frequency-bands';
export const PHASE_CORRELATION_PAYLOAD_MIME_TYPE = 'application/vnd.masterselects.phase-correlation';

export type FrequencyPhaseAnalysisPhase =
  | 'queued'
  | 'analyzing-frequency'
  | 'analyzing-phase'
  | 'storing-payloads'
  | 'storing-manifests'
  | 'complete'
  | 'cancelled'
  | 'failed';

export type FrequencyPhaseAnalysisErrorCode =
  | 'cancelled'
  | 'invalid-audio-buffer'
  | 'invalid-parameters'
  | 'artifact-store-failed';

export interface FrequencyPhaseAnalysisProgress {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  phase: FrequencyPhaseAnalysisPhase;
  percent: number;
  timestamp: string;
  frequencyCacheKey: string;
  phaseCacheKey: string;
  frameIndex?: number;
  frameCount?: number;
  message?: string;
}

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

interface FrequencyBandDefinition {
  bandId: string;
  label: string;
  minFrequency: number;
  maxFrequency: number;
  group: 'low' | 'mid' | 'high';
}

interface NormalizedFrequencyBand extends FrequencyBandDefinition {
  binStart: number;
  binEnd: number;
  binCount: number;
}

interface FrequencyAccumulator extends NormalizedFrequencyBand {
  energy: number;
  peakPower: number;
  weightedFrequency: number;
}

interface FrequencyAnalysis {
  bands: FrequencyBandSummary[];
  summary: FrequencySummaryManifest['summary'];
}

interface PhaseAnalysis {
  points: PhaseCorrelationPoint[];
  summary: PhaseCorrelationManifest['summary'];
}

interface NormalizedFrequencyPhaseParameters {
  fftSize: 1024 | 2048 | 4096;
  hopSize: number;
  frameCount: number;
  phaseWindowDuration: number;
  phaseHopDuration: number;
  phaseWindowSamples: number;
  phaseHopSamples: number;
  phasePointCount: number;
}

interface GenerationContext {
  jobId: string;
  mediaFileId: string;
  sourceFingerprint: string;
  frequencyCacheKey: string;
  phaseCacheKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: FrequencyPhaseAnalysisProgress) => void;
}

const DEFAULT_FFT_SIZE = 2048 as const;
const DEFAULT_HOP_SIZE = 1024;
const DEFAULT_PHASE_WINDOW_DURATION = 0.1;
const DEFAULT_PHASE_HOP_DURATION = 0.05;
const DEFAULT_DECODER_ID = 'audio-buffer';
const DEFAULT_DECODER_VERSION = '1.0.0';
const SILENCE_FLOOR_DB = -120;
const EPSILON = 1e-20;
const textEncoder = new TextEncoder();

const DEFAULT_FREQUENCY_BANDS: readonly FrequencyBandDefinition[] = [
  { bandId: 'sub', label: 'Sub', minFrequency: 20, maxFrequency: 60, group: 'low' },
  { bandId: 'bass', label: 'Bass', minFrequency: 60, maxFrequency: 250, group: 'low' },
  { bandId: 'low-mid', label: 'Low Mid', minFrequency: 250, maxFrequency: 500, group: 'mid' },
  { bandId: 'mid', label: 'Mid', minFrequency: 500, maxFrequency: 2000, group: 'mid' },
  { bandId: 'high-mid', label: 'High Mid', minFrequency: 2000, maxFrequency: 4000, group: 'mid' },
  { bandId: 'presence', label: 'Presence', minFrequency: 4000, maxFrequency: 6000, group: 'high' },
  { bandId: 'brilliance', label: 'Brilliance', minFrequency: 6000, maxFrequency: 20000, group: 'high' },
];

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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function powerToDb(power: number): number {
  if (!Number.isFinite(power) || power <= EPSILON) {
    return SILENCE_FLOOR_DB;
  }
  return Math.max(SILENCE_FLOOR_DB, 10 * Math.log10(power));
}

function ratioToDb(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || numerator <= EPSILON) {
    return -120;
  }
  return clamp(10 * Math.log10(numerator / Math.max(denominator, EPSILON)), -120, 120);
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

function normalizeBands(sampleRate: number, fftSize: number): NormalizedFrequencyBand[] {
  const nyquist = sampleRate / 2;
  const binCount = fftSize / 2;

  return DEFAULT_FREQUENCY_BANDS.map((band) => {
    const clampedMin = clamp(band.minFrequency, 0, nyquist);
    const clampedMax = clamp(band.maxFrequency, clampedMin, nyquist);
    const binStart = Math.max(1, Math.floor((clampedMin / sampleRate) * fftSize));
    const binEnd = Math.max(binStart + 1, Math.min(binCount, Math.ceil((clampedMax / sampleRate) * fftSize)));
    return {
      ...band,
      maxFrequency: clampedMax,
      binStart,
      binEnd,
      binCount: Math.max(0, binEnd - binStart),
    };
  });
}

function analyzeFrequencySummary(
  buffer: AudioBuffer,
  parameters: NormalizedFrequencyPhaseParameters,
  context: GenerationContext,
): FrequencyAnalysis {
  const mix = createMonoMix(buffer);
  const window = hannWindow(parameters.fftSize);
  const real = new Float32Array(parameters.fftSize);
  const imag = new Float32Array(parameters.fftSize);
  const bands = normalizeBands(buffer.sampleRate, parameters.fftSize);
  const accumulators: FrequencyAccumulator[] = bands.map((band) => ({
    ...band,
    energy: 0,
    peakPower: 0,
    weightedFrequency: 0,
  }));

  let totalEnergy = 0;
  let totalWeightedFrequency = 0;
  const binCount = parameters.fftSize / 2;

  for (let frameIndex = 0; frameIndex < parameters.frameCount; frameIndex += 1) {
    if (frameIndex % 64 === 0) {
      context.onProgress?.({
        jobId: context.jobId,
        mediaFileId: context.mediaFileId,
        sourceFingerprint: context.sourceFingerprint,
        frequencyCacheKey: context.frequencyCacheKey,
        phaseCacheKey: context.phaseCacheKey,
        phase: 'analyzing-frequency',
        percent: 5 + (frameIndex / parameters.frameCount) * 45,
        timestamp: new Date().toISOString(),
        frameIndex,
        frameCount: parameters.frameCount,
        message: 'Analyzing frequency bands',
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

    for (let binIndex = 1; binIndex < binCount; binIndex += 1) {
      const power = (real[binIndex] * real[binIndex] + imag[binIndex] * imag[binIndex]) /
        (parameters.fftSize * parameters.fftSize);
      if (!Number.isFinite(power) || power <= 0) {
        continue;
      }

      const frequency = (binIndex * buffer.sampleRate) / parameters.fftSize;
      totalEnergy += power;
      totalWeightedFrequency += power * frequency;

      for (const accumulator of accumulators) {
        if (binIndex < accumulator.binStart || binIndex >= accumulator.binEnd) {
          continue;
        }
        accumulator.energy += power;
        accumulator.peakPower = Math.max(accumulator.peakPower, power);
        accumulator.weightedFrequency += power * frequency;
      }
    }
  }

  const coveredEnergy = accumulators.reduce((sum, band) => sum + band.energy, 0);
  const dominantBand = accumulators.toSorted((a, b) => b.energy - a.energy)[0];
  const groupShare = (group: FrequencyBandDefinition['group']): number => (
    accumulators
      .filter((band) => band.group === group)
      .reduce((sum, band) => sum + band.energy, 0) / Math.max(coveredEnergy, EPSILON)
  );

  return {
    bands: accumulators.map((band) => ({
      bandId: band.bandId,
      label: band.label,
      minFrequency: band.minFrequency,
      maxFrequency: band.maxFrequency,
      rmsDb: powerToDb(band.energy / Math.max(1, parameters.frameCount * band.binCount)),
      peakDb: powerToDb(band.peakPower),
      energyShare: coveredEnergy > EPSILON ? band.energy / coveredEnergy : 0,
      centroidHz: band.energy > EPSILON
        ? band.weightedFrequency / band.energy
        : (band.minFrequency + band.maxFrequency) / 2,
    })),
    summary: {
      spectralCentroidHz: totalEnergy > EPSILON ? totalWeightedFrequency / totalEnergy : 0,
      lowEnergyShare: groupShare('low'),
      midEnergyShare: groupShare('mid'),
      highEnergyShare: groupShare('high'),
      ...(dominantBand && dominantBand.energy > EPSILON ? { dominantBandId: dominantBand.bandId } : {}),
    },
  };
}

function phaseCorrelationForWindow(
  left: Float32Array,
  right: Float32Array,
  start: number,
  sampleCount: number,
): {
  correlation: number;
  midSideRatioDb: number;
  midPower: number;
  sidePower: number;
} {
  let sumLR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  let midPower = 0;
  let sidePower = 0;

  for (let offset = 0; offset < sampleCount; offset += 1) {
    const sampleIndex = start + offset;
    const leftSample = safeSample(left[sampleIndex] ?? 0);
    const rightSample = safeSample(right[sampleIndex] ?? 0);
    sumLR += leftSample * rightSample;
    sumL2 += leftSample * leftSample;
    sumR2 += rightSample * rightSample;

    const mid = (leftSample + rightSample) * 0.5;
    const side = (leftSample - rightSample) * 0.5;
    midPower += mid * mid;
    sidePower += side * side;
  }

  const denominator = Math.sqrt(sumL2 * sumR2);
  const silent = sumL2 <= EPSILON && sumR2 <= EPSILON;
  const correlation = silent
    ? 1
    : clamp(denominator > EPSILON ? sumLR / denominator : 0, -1, 1);

  return {
    correlation,
    midSideRatioDb: ratioToDb(midPower / Math.max(1, sampleCount), sidePower / Math.max(1, sampleCount)),
    midPower,
    sidePower,
  };
}

function analyzePhaseCorrelation(
  buffer: AudioBuffer,
  parameters: NormalizedFrequencyPhaseParameters,
  context: GenerationContext,
): PhaseAnalysis {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels >= 2 ? buffer.getChannelData(1) : left;
  const points: PhaseCorrelationPoint[] = [];
  let correlationSum = 0;
  let minCorrelation = 1;
  let maxCorrelation = -1;
  let negativeCount = 0;
  let midSideSum = 0;
  let midPowerSum = 0;
  let sidePowerSum = 0;

  for (let pointIndex = 0; pointIndex < parameters.phasePointCount; pointIndex += 1) {
    if (pointIndex % 64 === 0) {
      context.onProgress?.({
        jobId: context.jobId,
        mediaFileId: context.mediaFileId,
        sourceFingerprint: context.sourceFingerprint,
        frequencyCacheKey: context.frequencyCacheKey,
        phaseCacheKey: context.phaseCacheKey,
        phase: 'analyzing-phase',
        percent: 52 + (pointIndex / parameters.phasePointCount) * 28,
        timestamp: new Date().toISOString(),
        frameIndex: pointIndex,
        frameCount: parameters.phasePointCount,
        message: 'Analyzing phase correlation',
      });
    }
    throwIfCancelled(context.signal, context.jobId);

    const start = pointIndex * parameters.phaseHopSamples;
    const availableSamples = Math.max(0, Math.min(parameters.phaseWindowSamples, buffer.length - start));
    const sampleCount = Math.max(1, availableSamples);
    const point = phaseCorrelationForWindow(left, right, start, sampleCount);
    const time = start / buffer.sampleRate;

    points.push({
      time,
      correlation: point.correlation,
      midSideRatioDb: point.midSideRatioDb,
    });
    correlationSum += point.correlation;
    minCorrelation = Math.min(minCorrelation, point.correlation);
    maxCorrelation = Math.max(maxCorrelation, point.correlation);
    if (point.correlation < 0) {
      negativeCount += 1;
    }
    midSideSum += point.midSideRatioDb;
    midPowerSum += point.midPower;
    sidePowerSum += point.sidePower;
  }

  const pointCount = Math.max(1, points.length);
  const negativeCorrelationPercent = negativeCount / pointCount;
  const stereoWidth = sidePowerSum / Math.max(EPSILON, midPowerSum + sidePowerSum);

  return {
    points,
    summary: {
      averageCorrelation: correlationSum / pointCount,
      minimumCorrelation: minCorrelation,
      maximumCorrelation: maxCorrelation,
      negativeCorrelationPercent,
      averageMidSideRatioDb: midSideSum / pointCount,
      stereoWidth: clamp(stereoWidth, 0, 1),
      monoCompatible: minCorrelation >= -0.25 && negativeCorrelationPercent <= 0.1,
    },
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
    let progressContext: GenerationContext | null = null;

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
      const context: GenerationContext = {
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

      const frequencyAnalysis = analyzeFrequencySummary(request.buffer, parameters, context);
      const phaseAnalysis = analyzePhaseCorrelation(request.buffer, parameters, context);

      const frequencyPayloadRef = await this.storeFrequencyPayload({
        request,
        cacheKey: frequencyCacheKey,
        analyzerVersion,
        generatedAt,
        bands: frequencyAnalysis.bands,
        context,
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

      const phasePayloadRef = await this.storePhasePayload({
        request,
        cacheKey: phaseCacheKey,
        analyzerVersion,
        generatedAt,
        points: phaseAnalysis.points,
        parameters,
        context,
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

  private async storeFrequencyPayload(input: {
    request: FrequencyPhaseAnalysisRequest;
    cacheKey: string;
    analyzerVersion: string;
    generatedAt: string;
    bands: readonly FrequencyBandSummary[];
    context: GenerationContext;
  }): Promise<AudioArtifactRef> {
    this.emitProgress(input.context, {
      phase: 'storing-payloads',
      percent: 82,
      timestamp: this.now(),
      message: 'Storing frequency band payload',
    });

    return this.artifactStore.putPayload(encodeFrequencyBandPayload({
      header: {
        schemaVersion: FREQUENCY_BAND_PAYLOAD_VERSION,
        bandCount: input.bands.length,
        valueLayout: 'band-major',
        valueEncoding: 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32',
      },
      values: frequencyBandsToFloat32(input.bands),
    }), {
      mediaFileId: input.request.mediaFileId,
      kind: 'frequency-summary',
      sourceFingerprint: input.request.sourceFingerprint,
      clipAudioStateHash: input.request.clipAudioStateHash,
      mimeType: FREQUENCY_BAND_PAYLOAD_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion: input.analyzerVersion,
      createdAt: input.generatedAt,
      sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
      metadata: {
        cacheKey: input.cacheKey,
        bandCount: input.bands.length,
        valueEncoding: 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32',
      },
    });
  }

  private async storePhasePayload(input: {
    request: FrequencyPhaseAnalysisRequest;
    cacheKey: string;
    analyzerVersion: string;
    generatedAt: string;
    points: readonly PhaseCorrelationPoint[];
    parameters: NormalizedFrequencyPhaseParameters;
    context: GenerationContext;
  }): Promise<AudioArtifactRef> {
    this.emitProgress(input.context, {
      phase: 'storing-payloads',
      percent: 92,
      timestamp: this.now(),
      message: 'Storing phase correlation payload',
    });

    return this.artifactStore.putPayload(encodePhaseCorrelationPayload({
      header: {
        schemaVersion: PHASE_CORRELATION_PAYLOAD_VERSION,
        pointCount: input.points.length,
        windowDuration: input.parameters.phaseWindowDuration,
        hopDuration: input.parameters.phaseHopDuration,
        valueLayout: 'time-major',
        valueEncoding: 'time-correlation-midSideRatioDb-f32',
      },
      values: phaseCorrelationPointsToFloat32(input.points),
    }), {
      mediaFileId: input.request.mediaFileId,
      kind: 'phase-correlation',
      sourceFingerprint: input.request.sourceFingerprint,
      clipAudioStateHash: input.request.clipAudioStateHash,
      mimeType: PHASE_CORRELATION_PAYLOAD_MIME_TYPE,
      encoding: 'raw',
      analyzerVersion: input.analyzerVersion,
      createdAt: input.generatedAt,
      sourceRefs: [`audio-analysis-cache:${input.cacheKey}`],
      metadata: {
        cacheKey: input.cacheKey,
        pointCount: input.points.length,
        valueEncoding: 'time-correlation-midSideRatioDb-f32',
      },
    });
  }

  private emitProgress(
    context: GenerationContext,
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
