import { fftRadix2, nextPowerOfTwo } from './audio/clipRender/spectralFft';

export const DEFAULT_SAMPLE_RATE = 1000;
export const DEFAULT_TARGET_EXCERPT_SECONDS = 180;
export const DEFAULT_MIN_PEAK_RATIO = 1.02;
export const MIN_SYNC_SECONDS = 3;

const ENVELOPE_BIN_SECONDS = 0.1;

export interface AudioSyncOffsetResult {
  offsetSamples: number;
  offsetSeconds: number;
  peak: number;
  secondPeak: number | null;
  peakRatio: number | null;
  method: 'waveform' | 'envelope';
  confidence: 'low' | 'medium' | 'high';
}

interface Candidate {
  offsetSamples: number;
  peak: number;
  secondPeak: number | null;
  peakRatio: number | null;
  method: AudioSyncOffsetResult['method'];
  sampleRate: number;
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / samples.length);
}

function normalizeSeries(samples: Float32Array): Float32Array {
  if (samples.length === 0) return new Float32Array();

  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) {
    mean += samples[index];
  }
  mean /= samples.length;

  let variance = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean;
    variance += centered * centered;
  }

  const standardDeviation = Math.sqrt(variance / samples.length);
  const normalized = new Float32Array(samples.length);
  if (standardDeviation < 1e-12) {
    for (let index = 0; index < samples.length; index += 1) {
      normalized[index] = samples[index] - mean;
    }
    return normalized;
  }

  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = (samples[index] - mean) / standardDeviation;
  }
  return normalized;
}

function fftCrossCorrelate(left: Float32Array, right: Float32Array): Float32Array {
  const outputLength = left.length + right.length - 1;
  const fftSize = nextPowerOfTwo(outputLength);
  const leftReal = new Float32Array(fftSize);
  const leftImag = new Float32Array(fftSize);
  const rightReal = new Float32Array(fftSize);
  const rightImag = new Float32Array(fftSize);

  leftReal.set(left);
  for (let index = 0; index < right.length; index += 1) {
    rightReal[index] = right[right.length - 1 - index];
  }

  fftRadix2(leftReal, leftImag);
  fftRadix2(rightReal, rightImag);

  for (let index = 0; index < fftSize; index += 1) {
    const real = leftReal[index] * rightReal[index] - leftImag[index] * rightImag[index];
    const imag = leftReal[index] * rightImag[index] + leftImag[index] * rightReal[index];
    leftReal[index] = real;
    leftImag[index] = imag;
  }

  fftRadix2(leftReal, leftImag, true);
  return leftReal.slice(0, outputLength);
}

function fftGccPhat(left: Float32Array, right: Float32Array): Float32Array {
  const outputLength = left.length + right.length - 1;
  const fftSize = nextPowerOfTwo(outputLength);
  const leftReal = new Float32Array(fftSize);
  const leftImag = new Float32Array(fftSize);
  const rightReal = new Float32Array(fftSize);
  const rightImag = new Float32Array(fftSize);

  leftReal.set(left);
  rightReal.set(right);
  fftRadix2(leftReal, leftImag);
  fftRadix2(rightReal, rightImag);

  for (let index = 0; index < fftSize; index += 1) {
    const real = leftReal[index] * rightReal[index] + leftImag[index] * rightImag[index];
    const imag = leftImag[index] * rightReal[index] - leftReal[index] * rightImag[index];
    const magnitude = Math.max(Math.hypot(real, imag), 1e-12);
    leftReal[index] = real / magnitude;
    leftImag[index] = imag / magnitude;
  }

  fftRadix2(leftReal, leftImag, true);

  const output = new Float32Array(outputLength);
  const tailLength = right.length - 1;
  for (let index = 0; index < tailLength; index += 1) {
    output[index] = leftReal[fftSize - tailLength + index];
  }
  for (let index = 0; index < left.length; index += 1) {
    output[tailLength + index] = leftReal[index];
  }
  return output;
}

function hybridCorrelation(left: Float32Array, right: Float32Array): Float32Array {
  const normalizedLeft = normalizeSeries(left);
  const normalizedRight = normalizeSeries(right);
  const raw = normalizeSeries(fftCrossCorrelate(normalizedLeft, normalizedRight));
  const phat = normalizeSeries(fftGccPhat(normalizedLeft, normalizedRight));
  const output = new Float32Array(raw.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = 0.45 * raw[index] + 0.55 * phat[index];
  }
  return output;
}

function topCandidates(
  correlation: Float32Array,
  rightLength: number,
  lagMinSamples: number,
  lagMaxSamples: number,
  exclusionRadiusSamples: number,
  count: number,
): Array<Omit<Candidate, 'method' | 'sampleRate'>> {
  const startIndex = Math.max(0, lagMinSamples + rightLength - 1);
  const endIndex = Math.min(correlation.length - 1, lagMaxSamples + rightLength - 1);
  if (endIndex < startIndex) return [];

  const window = correlation.slice(startIndex, endIndex + 1);
  const candidates: Array<Omit<Candidate, 'method' | 'sampleRate'>> = [];

  for (let candidateIndex = 0; candidateIndex < count; candidateIndex += 1) {
    let relativeBestIndex = -1;
    let peak = -Infinity;
    for (let index = 0; index < window.length; index += 1) {
      if (window[index] > peak) {
        peak = window[index];
        relativeBestIndex = index;
      }
    }
    if (relativeBestIndex < 0 || !Number.isFinite(peak)) break;

    const bestIndex = startIndex + relativeBestIndex;
    const exclusionStart = Math.max(0, relativeBestIndex - exclusionRadiusSamples);
    const exclusionEnd = Math.min(window.length - 1, relativeBestIndex + exclusionRadiusSamples);

    let secondPeak: number | null = null;
    for (let index = 0; index < window.length; index += 1) {
      if (index >= exclusionStart && index <= exclusionEnd) continue;
      secondPeak = secondPeak === null ? window[index] : Math.max(secondPeak, window[index]);
    }

    candidates.push({
      offsetSamples: bestIndex - (rightLength - 1),
      peak,
      secondPeak,
      peakRatio: secondPeak !== null && secondPeak > 0 ? peak / secondPeak : null,
    });

    for (let index = exclusionStart; index <= exclusionEnd; index += 1) {
      window[index] = -Infinity;
    }
  }

  return candidates;
}

function buildEnergyEnvelope(samples: Float32Array, sampleRate: number): { samples: Float32Array; sampleRate: number } {
  const binSize = Math.max(1, Math.round(sampleRate * ENVELOPE_BIN_SECONDS));
  const binCount = Math.max(1, Math.ceil(samples.length / binSize));
  const envelope = new Float32Array(binCount);

  for (let binIndex = 0; binIndex < binCount; binIndex += 1) {
    const start = binIndex * binSize;
    const end = Math.min(samples.length, start + binSize);
    envelope[binIndex] = rms(samples.subarray(start, end));
  }

  const normalizedRms = normalizeSeries(envelope);
  const onset = new Float32Array(binCount);
  for (let index = 1; index < binCount; index += 1) {
    onset[index] = Math.abs(envelope[index] - envelope[index - 1]);
  }
  const normalizedOnset = normalizeSeries(onset);
  const combined = new Float32Array(binCount);
  for (let index = 0; index < binCount; index += 1) {
    combined[index] = 0.7 * normalizedRms[index] + 0.3 * normalizedOnset[index];
  }

  return { samples: combined, sampleRate: sampleRate / binSize };
}

function confidenceForPeakRatio(peakRatio: number | null): AudioSyncOffsetResult['confidence'] {
  if (peakRatio !== null && peakRatio >= 1.15) return 'high';
  if (peakRatio !== null && peakRatio >= 1.05) return 'medium';
  return 'low';
}

function lagRangeForMinimumOverlap(
  leftLength: number,
  rightLength: number,
  minOverlapSamples: number,
): { min: number; max: number } {
  const requiredOverlap = Math.min(leftLength, rightLength, Math.max(1, minOverlapSamples));
  return {
    min: -Math.max(0, rightLength - requiredOverlap),
    max: Math.max(0, leftLength - requiredOverlap),
  };
}

export function findAudioSyncOffset(
  masterSamples: Float32Array,
  targetSamples: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE,
  options: { minPeakRatio?: number; candidateLimit?: number } = {},
): AudioSyncOffsetResult | null {
  if (masterSamples.length < MIN_SYNC_SECONDS * sampleRate || targetSamples.length < MIN_SYNC_SECONDS * sampleRate) {
    return null;
  }

  const lagRange = lagRangeForMinimumOverlap(
    masterSamples.length,
    targetSamples.length,
    Math.round(MIN_SYNC_SECONDS * sampleRate),
  );
  const waveformCandidates = topCandidates(
    hybridCorrelation(masterSamples, targetSamples),
    targetSamples.length,
    lagRange.min,
    lagRange.max,
    Math.max(1, Math.round(sampleRate)),
    options.candidateLimit ?? 6,
  ).map(candidate => ({ ...candidate, method: 'waveform' as const, sampleRate }));

  const masterEnvelope = buildEnergyEnvelope(masterSamples, sampleRate);
  const targetEnvelope = buildEnergyEnvelope(targetSamples, sampleRate);
  const envelopeLagRange = lagRangeForMinimumOverlap(
    masterEnvelope.samples.length,
    targetEnvelope.samples.length,
    Math.round(MIN_SYNC_SECONDS * masterEnvelope.sampleRate),
  );
  const envelopeCandidates = topCandidates(
    fftCrossCorrelate(normalizeSeries(masterEnvelope.samples), normalizeSeries(targetEnvelope.samples)),
    targetEnvelope.samples.length,
    envelopeLagRange.min,
    envelopeLagRange.max,
    Math.max(1, Math.round(masterEnvelope.sampleRate)),
    Math.max(2, Math.floor((options.candidateLimit ?? 6) / 2)),
  ).map(candidate => ({ ...candidate, method: 'envelope' as const, sampleRate: masterEnvelope.sampleRate }));

  const minPeakRatio = options.minPeakRatio ?? DEFAULT_MIN_PEAK_RATIO;
  const sortWaveformCandidates = (candidates: Candidate[]) => candidates
    .filter(candidate => candidate.peakRatio === null || candidate.peakRatio >= minPeakRatio)
    .toSorted((left, right) => (
      right.peak - left.peak
      || (right.peakRatio ?? 0) - (left.peakRatio ?? 0)
    ));
  const sortEnvelopeCandidates = (candidates: Candidate[]) => candidates
    .filter(candidate => candidate.peakRatio === null || candidate.peakRatio >= minPeakRatio)
    .toSorted((left, right) => (
      (right.peakRatio ?? 0) - (left.peakRatio ?? 0)
      || right.peak - left.peak
    ));

  const sortedWaveformCandidates = sortWaveformCandidates(waveformCandidates);
  const sortedEnvelopeCandidates = sortEnvelopeCandidates(envelopeCandidates);
  const best = sortedWaveformCandidates[0] ?? sortedEnvelopeCandidates[0];
  if (!best) return null;

  return {
    offsetSamples: Math.round(best.offsetSamples * (sampleRate / best.sampleRate)),
    offsetSeconds: best.offsetSamples / best.sampleRate,
    peak: best.peak,
    secondPeak: best.secondPeak,
    peakRatio: best.peakRatio,
    method: best.method,
    confidence: confidenceForPeakRatio(best.peakRatio),
  };
}
