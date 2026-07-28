import { fftRadix2, hannWindow } from '../../clipRender/spectralFft';
import type { RoomToneCandidate, RoomToneNoiseFloor } from '../../roomToneProfileManifest';
import type { AudioSpan } from '../../voiceActivityManifest';

const MIN_CANDIDATE_SECONDS = 0.4;
const MAX_CANDIDATE_SECONDS = 2;
const SUB_WINDOW_SECONDS = 0.025;
const FFT_SIZE = 1024;
const THIRD_OCTAVE_CENTERS = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000,
] as const;
const THIRD_OCTAVE_EDGE_FACTOR = 1.122;
const DB_FLOOR = -240;

export interface RoomToneProfilerInput {
  pcm: Float32Array;
  sampleRate: number;
  vadSegments: readonly AudioSpan[];
  offsetSeconds?: number;
  maxCandidates?: number;
}

export interface RoomToneProfileResult {
  candidates: RoomToneCandidate[];
  noiseFloor: RoomToneNoiseFloor;
  bandCentersHz: number[];
  bandAverageDb: number[];
}

interface TimeRange { start: number; end: number }
interface CandidateMeasurement { candidate: RoomToneCandidate; transientCount: number }

function amplitudeToDb(amplitude: number): number {
  return Math.max(DB_FLOOR, 20 * Math.log10(Math.max(amplitude, 1e-12)));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return DB_FLOOR;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return (sorted[lower] ?? DB_FLOOR) * (1 - mix) + (sorted[upper] ?? DB_FLOOR) * mix;
}

function normalizeSpeechRanges(
  spans: readonly AudioSpan[], signalStart: number, signalEnd: number,
): TimeRange[] {
  const clipped = spans
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.end))
    .map(span => ({
      start: clamp(Math.min(span.start, span.end), signalStart, signalEnd),
      end: clamp(Math.max(span.start, span.end), signalStart, signalEnd),
    }))
    .filter(span => span.end > span.start)
    .toSorted((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const span of clipped) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function findNonSpeechRanges(
  speech: readonly TimeRange[], signalStart: number, signalEnd: number,
): TimeRange[] {
  const gaps: TimeRange[] = [];
  let cursor = signalStart;
  for (const span of speech) {
    if (span.start > cursor) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < signalEnd) gaps.push({ start: cursor, end: signalEnd });
  return gaps;
}

function splitCandidateRanges(gaps: readonly TimeRange[]): TimeRange[] {
  return gaps.flatMap((gap) => {
    const duration = gap.end - gap.start;
    if (duration < MIN_CANDIDATE_SECONDS) return [];
    const count = Math.ceil(duration / MAX_CANDIDATE_SECONDS);
    const windowDuration = duration / count;
    return Array.from({ length: count }, (_, index) => ({
      start: gap.start + index * windowDuration,
      end: index === count - 1 ? gap.end : gap.start + (index + 1) * windowDuration,
    }));
  });
}

function rangeSamples(
  range: TimeRange, offsetSeconds: number, sampleRate: number, sampleCount: number,
): { start: number; end: number } {
  return {
    start: clamp(Math.ceil((range.start - offsetSeconds) * sampleRate), 0, sampleCount),
    end: clamp(Math.floor((range.end - offsetSeconds) * sampleRate), 0, sampleCount),
  };
}

function frameMeasurements(
  pcm: Float32Array, range: TimeRange, offsetSeconds: number, sampleRate: number,
): Array<{ rmsDb: number; transient: boolean }> {
  const samples = rangeSamples(range, offsetSeconds, sampleRate, pcm.length);
  const frameSize = Math.max(1, Math.round(sampleRate * SUB_WINDOW_SECONDS));
  const frames: Array<{ rmsDb: number; transient: boolean }> = [];
  for (let start = samples.start; start < samples.end; start += frameSize) {
    const end = Math.min(samples.end, start + frameSize);
    if (end <= start) continue;
    let sumSquares = 0;
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      const sample = pcm[index] ?? 0;
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumSquares / (end - start));
    frames.push({ rmsDb: amplitudeToDb(rms), transient: rms > 0 && peak / rms > 4 });
  }
  return frames;
}

function measureCandidate(
  pcm: Float32Array, range: TimeRange, offsetSeconds: number,
  sampleRate: number, floorMedian: number,
): CandidateMeasurement {
  const frames = frameMeasurements(pcm, range, offsetSeconds, sampleRate);
  const rmsDb = frames.reduce((sum, frame) => sum + frame.rmsDb, 0) / Math.max(1, frames.length);
  const variance = frames.reduce((sum, frame) => sum + (frame.rmsDb - rmsDb) ** 2, 0)
    / Math.max(1, frames.length);
  const transientCount = frames.filter(frame => frame.transient).length;
  const closeness = clamp(1 - Math.abs(rmsDb - floorMedian) / 3, 0, 1);
  const stability = Math.exp(-variance / 9);
  const transientQuality = transientCount === 0 ? 1 : 1 / (1 + transientCount);
  const durationBonus = clamp((range.end - range.start) / 1.2, 0, 1);
  const score = clamp(
    closeness * 0.5 + stability * 0.25 + transientQuality * 0.15 + durationBonus * 0.1,
    0, 1,
  );
  return {
    candidate: { start: range.start, end: range.end, rmsDb, variance, score },
    transientCount,
  };
}

function computeThirdOctaveSpectrum(
  pcm: Float32Array, ranges: readonly TimeRange[], offsetSeconds: number, sampleRate: number,
): { bandCentersHz: number[]; bandAverageDb: number[] } {
  const nyquist = sampleRate / 2;
  const bandCentersHz = THIRD_OCTAVE_CENTERS.filter(
    center => center <= 16000 && center <= nyquist / THIRD_OCTAVE_EDGE_FACTOR,
  );
  const bandPowerSums = new Float64Array(bandCentersHz.length);
  const bandBinCounts = new Uint32Array(bandCentersHz.length);
  const window = hannWindow(FFT_SIZE);
  let fftWindowCount = 0;

  for (const range of ranges) {
    const samples = rangeSamples(range, offsetSeconds, sampleRate, pcm.length);
    for (let start = samples.start; start < samples.end; start += FFT_SIZE) {
      const real = new Float32Array(FFT_SIZE);
      const imag = new Float32Array(FFT_SIZE);
      const available = Math.min(FFT_SIZE, samples.end - start);
      if (available <= 0) continue;
      for (let index = 0; index < available; index += 1) {
        real[index] = (pcm[start + index] ?? 0) * (window[index] ?? 0);
      }
      fftRadix2(real, imag);
      fftWindowCount += 1;
      for (let bin = 1; bin <= FFT_SIZE / 2; bin += 1) {
        const frequency = bin * sampleRate / FFT_SIZE;
        const power = (real[bin] ?? 0) ** 2 + (imag[bin] ?? 0) ** 2;
        for (let band = 0; band < bandCentersHz.length; band += 1) {
          const center = bandCentersHz[band] ?? 0;
          if (frequency >= center / THIRD_OCTAVE_EDGE_FACTOR
            && frequency < center * THIRD_OCTAVE_EDGE_FACTOR) {
            bandPowerSums[band] = (bandPowerSums[band] ?? 0) + power;
            bandBinCounts[band] = (bandBinCounts[band] ?? 0) + 1;
            break;
          }
        }
      }
    }
  }

  const bandAverageDb = bandCentersHz.map((_, index) => {
    const observations = bandBinCounts[index] ?? 0;
    if (fftWindowCount === 0 || observations === 0) return DB_FLOOR;
    return Math.max(DB_FLOOR, 10 * Math.log10((bandPowerSums[index] ?? 0) / observations + 1e-24));
  });
  return { bandCentersHz, bandAverageDb };
}

export function profileRoomTone(input: RoomToneProfilerInput): RoomToneProfileResult {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number.');
  }
  const offsetSeconds = input.offsetSeconds ?? 0;
  if (!Number.isFinite(offsetSeconds)) throw new Error('offsetSeconds must be finite.');
  const maxCandidates = input.maxCandidates ?? 5;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 0) {
    throw new Error('maxCandidates must be a non-negative integer.');
  }

  const signalEnd = offsetSeconds + input.pcm.length / input.sampleRate;
  const speech = normalizeSpeechRanges(input.vadSegments, offsetSeconds, signalEnd);
  const gaps = findNonSpeechRanges(speech, offsetSeconds, signalEnd);
  const allFrames = gaps.flatMap(range =>
    frameMeasurements(input.pcm, range, offsetSeconds, input.sampleRate).map(frame => frame.rmsDb));
  const sortedRms = allFrames.toSorted((a, b) => a - b);
  const noiseFloor: RoomToneNoiseFloor = {
    rmsDbMedian: percentile(sortedRms, 0.5),
    rmsDbP10: percentile(sortedRms, 0.1),
    rmsDbP90: percentile(sortedRms, 0.9),
  };
  const candidates = splitCandidateRanges(gaps)
    .map(range => measureCandidate(
      input.pcm, range, offsetSeconds, input.sampleRate, noiseFloor.rmsDbMedian,
    ))
    .toSorted((a, b) => b.candidate.score - a.candidate.score
      || a.transientCount - b.transientCount
      || a.candidate.start - b.candidate.start)
    .slice(0, maxCandidates)
    .map(measurement => measurement.candidate);
  const spectrum = computeThirdOctaveSpectrum(
    input.pcm, candidates, offsetSeconds, input.sampleRate,
  );
  return { candidates, noiseFloor, ...spectrum };
}
