import type { SpeechMarker } from '../../speechMarkersManifest';
import type { AudioSpan } from '../../voiceActivityManifest';
import { fftRadix2, hannWindow } from '../../clipRender/spectralFft';

export interface BreathDetectionInput {
  pcm: Float32Array;
  sampleRate: number;
  vadSegments: readonly AudioSpan[];
  offsetSeconds?: number;
}

const MIN_GAP_SECONDS = 0.12;
const MAX_GAP_SECONDS = 1.2;
const MAX_ADJACENCY_SECONDS = 0.5;
const FFT_SIZE = 1024;
const FFT_HOP = FFT_SIZE / 2;
const DB_FLOOR = -120;

// Confidence favors features separating unvoiced broadband breathing from quiet pitched speech:
// RMS 20%, flatness 30%, centroid 20%, and normalized autocorrelation 30%.
const CONFIDENCE_WEIGHTS = { rms: 0.2, flatness: 0.3, centroid: 0.2, autocorrelation: 0.3 } as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rmsDb(samples: Float32Array): number {
  if (samples.length === 0) return DB_FLOOR;
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.max(DB_FLOOR, 20 * Math.log10(Math.sqrt(sumSquares / samples.length) + 1e-12));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function timeSlice(
  pcm: Float32Array,
  sampleRate: number,
  start: number,
  end: number,
  offset: number,
): Float32Array {
  const first = Math.max(0, Math.floor((start - offset) * sampleRate));
  const last = Math.min(pcm.length, Math.ceil((end - offset) * sampleRate));
  return first < last ? pcm.subarray(first, last) : new Float32Array();
}

function spectralFeatures(samples: Float32Array, sampleRate: number) {
  const window = hannWindow(FFT_SIZE);
  const magnitudeSum = new Float64Array(FFT_SIZE / 2 + 1);
  const starts: number[] = [];
  if (samples.length <= FFT_SIZE) starts.push(0);
  else {
    for (let start = 0; start + FFT_SIZE <= samples.length; start += FFT_HOP) starts.push(start);
    const finalStart = samples.length - FFT_SIZE;
    if (starts.at(-1) !== finalStart) starts.push(finalStart);
  }

  for (const start of starts) {
    const real = new Float32Array(FFT_SIZE);
    const imaginary = new Float32Array(FFT_SIZE);
    const available = Math.min(FFT_SIZE, samples.length - start);
    for (let index = 0; index < available; index += 1) {
      real[index] = samples[start + index]! * window[index]!;
    }
    fftRadix2(real, imaginary);
    for (let bin = 1; bin < magnitudeSum.length; bin += 1) {
      magnitudeSum[bin] += Math.hypot(real[bin]!, imaginary[bin]!);
    }
  }

  let magnitudeTotal = 0;
  let weightedFrequency = 0;
  let logMagnitudeTotal = 0;
  const binCount = magnitudeSum.length - 1;
  for (let bin = 1; bin < magnitudeSum.length; bin += 1) {
    const magnitude = magnitudeSum[bin]! / starts.length;
    magnitudeTotal += magnitude;
    weightedFrequency += magnitude * bin * sampleRate / FFT_SIZE;
    logMagnitudeTotal += Math.log(magnitude + 1e-12);
  }
  const arithmeticMean = magnitudeTotal / Math.max(1, binCount);
  return {
    flatness: arithmeticMean > 1e-12
      ? Math.exp(logMagnitudeTotal / Math.max(1, binCount)) / arithmeticMean
      : 0,
    centroidHz: magnitudeTotal > 1e-12 ? weightedFrequency / magnitudeTotal : 0,
  };
}

function autocorrelationPeak(samples: Float32Array, sampleRate: number): number {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (energy <= 1e-12) return 1;
  const minimumLag = Math.max(1, Math.floor(sampleRate / 450));
  const maximumLag = Math.min(samples.length - 1, Math.ceil(sampleRate / 60));
  let peak = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let product = 0;
    let leadingEnergy = 0;
    let trailingEnergy = 0;
    for (let index = 0; index + lag < samples.length; index += 1) {
      const leading = samples[index]!;
      const trailing = samples[index + lag]!;
      product += leading * trailing;
      leadingEnergy += leading * leading;
      trailingEnergy += trailing * trailing;
    }
    const denominator = Math.sqrt(leadingEnergy * trailingEnergy);
    if (denominator > 1e-12) peak = Math.max(peak, product / denominator);
  }
  return peak;
}

function centralScore(value: number, minimum: number, maximum: number): number {
  const midpoint = (minimum + maximum) / 2;
  return clamp01(1 - Math.abs(value - midpoint) / ((maximum - minimum) / 2));
}

function trimEnergeticCore(
  samples: Float32Array,
  sampleRate: number,
  gapStart: number,
): [number, number] {
  const frameSize = Math.max(1, Math.round(sampleRate * 0.02));
  const frameRms: number[] = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    frameRms.push(rmsDb(samples.subarray(start, Math.min(samples.length, start + frameSize))));
  }
  const threshold = Math.max(DB_FLOOR + 1, Math.max(...frameRms) - 12);
  const first = frameRms.findIndex((value) => value >= threshold);
  let last = frameRms.length - 1;
  while (last >= 0 && frameRms[last]! < threshold) last -= 1;
  if (first < 0 || last < first) return [gapStart, gapStart + samples.length / sampleRate];
  return [
    gapStart + first * frameSize / sampleRate,
    gapStart + Math.min(samples.length, (last + 1) * frameSize) / sampleRate,
  ];
}

export function detectBreaths(input: BreathDetectionInput): SpeechMarker[] {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0 || input.pcm.length === 0) return [];
  const offset = input.offsetSeconds ?? 0;
  const segments = [...input.vadSegments].sort((left, right) => left.start - right.start);
  const markers: SpeechMarker[] = [];

  for (let index = 0; index + 1 < segments.length; index += 1) {
    const previous = segments[index]!;
    const next = segments[index + 1]!;
    const gapStart = previous.end;
    const gapEnd = next.start;
    const gapDuration = gapEnd - gapStart;
    if (gapDuration < MIN_GAP_SECONDS || gapDuration > MAX_GAP_SECONDS) continue;
    const hasAdjacentSpeech = gapStart - previous.end <= MAX_ADJACENCY_SECONDS
      || next.start - gapEnd <= MAX_ADJACENCY_SECONDS;
    if (!hasAdjacentSpeech) continue;

    const samples = timeSlice(input.pcm, input.sampleRate, gapStart, gapEnd, offset);
    const currentRmsDb = rmsDb(samples);
    const speechRmsDb = median([
      rmsDb(timeSlice(input.pcm, input.sampleRate, previous.start, previous.end, offset)),
      rmsDb(timeSlice(input.pcm, input.sampleRate, next.start, next.end, offset)),
    ]);
    const { flatness, centroidHz } = spectralFeatures(samples, input.sampleRate);
    const autocorrelation = autocorrelationPeak(samples, input.sampleRate);
    const rmsMinimum = speechRmsDb - 35;
    const rmsMaximum = speechRmsDb - 8;
    if (!(currentRmsDb > rmsMinimum && currentRmsDb < rmsMaximum)
      || flatness <= 0.35 || centroidHz < 400 || centroidHz > 4000 || autocorrelation >= 0.5) continue;

    const confidence =
      centralScore(currentRmsDb, rmsMinimum, rmsMaximum) * CONFIDENCE_WEIGHTS.rms
      + centralScore(flatness, 0.35, 1) * CONFIDENCE_WEIGHTS.flatness
      + centralScore(centroidHz, 400, 4000) * CONFIDENCE_WEIGHTS.centroid
      + centralScore(autocorrelation, 0, 0.5) * CONFIDENCE_WEIGHTS.autocorrelation;
    const [start, end] = trimEnergeticCore(samples, input.sampleRate, gapStart);
    markers.push({
      id: `breath-${Math.round(start * 1000)}`,
      type: 'breath',
      start,
      end,
      confidence: clamp01(confidence),
      evidence: { rmsDb: currentRmsDb, spectralFlatness: flatness, centroidHz },
    });
  }
  return markers;
}
