import type { AlignedWordTiming } from '../../transcriptTimingManifest';
import type { AudioSpan } from '../../voiceActivityManifest';
import { yinPitchFrame } from './yinPitch';

export interface ProsodyAnalysisInput {
  pcm: Float32Array;
  sampleRate: number;
  hopSeconds: number;
  vadSegments?: readonly AudioSpan[];
  alignedWords?: readonly AlignedWordTiming[];
  offsetSeconds?: number;
}

export interface ProsodyAnalysisResult {
  hopSeconds: number;
  windowSeconds: number;
  f0Hz: Float32Array;
  voicing: Float32Array;
  energyRmsDb: Float32Array;
  speechRateSps: Float32Array;
  summary: {
    medianF0Hz?: number;
    f0RangeSemitones?: number;
    meanSpeechRateSps?: number;
  };
  wordEmphasis?: { wordId: string; emphasis: number; f0MeanHz?: number }[];
}

const WINDOW_SECONDS = 0.04;
const ENERGY_FLOOR_DB = -90;

function quantile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const mix = position - lower;
  return (sorted[lower] ?? 0) * (1 - mix) + (sorted[upper] ?? 0) * mix;
}

function mean(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isInVad(time: number, segments: readonly AudioSpan[] | undefined): boolean {
  return !segments || segments.some((segment) => time >= segment.start && time < segment.end);
}

function zScores(values: readonly number[]): number[] {
  const average = mean(values) ?? 0;
  const variance = mean(values.map((value) => (value - average) ** 2)) ?? 0;
  const standardDeviation = Math.sqrt(variance);
  return values.map((value) => standardDeviation > 1e-9
    ? (value - average) / standardDeviation
    : 0);
}

function calculateSpeechRate(
  energy: Float32Array,
  voicing: Float32Array,
  hopSeconds: number,
): Float32Array {
  const output = new Float32Array(energy.length);
  const radius = Math.max(1, Math.round(0.5 / hopSeconds));
  for (let index = 0; index < energy.length; index += 1) {
    const start = Math.max(0, index - radius);
    const end = Math.min(energy.length - 1, index + radius);
    const windowEnergy: number[] = [];
    for (let cursor = start; cursor <= end; cursor += 1) {
      windowEnergy.push(energy[cursor] ?? ENERGY_FLOOR_DB);
    }
    const medianEnergy = quantile(windowEnergy, 0.5);
    if (medianEnergy === undefined) continue;

    let peaks = 0;
    for (let cursor = Math.max(start + 1, 1); cursor < Math.min(end, energy.length - 1); cursor += 1) {
      const value = energy[cursor] ?? ENERGY_FLOOR_DB;
      if (
        (voicing[cursor] ?? 0) > 0.5
        && value > medianEnergy + 3
        && value > (energy[cursor - 1] ?? value)
        && value >= (energy[cursor + 1] ?? value)
      ) peaks += 1;
    }
    const surroundingSeconds = Math.min(1, Math.max(hopSeconds, (end - start + 1) * hopSeconds));
    output[index] = peaks / surroundingSeconds;
  }
  return output;
}

function calculateWordEmphasis(
  words: readonly AlignedWordTiming[],
  frameTimes: Float64Array,
  energy: Float32Array,
  f0: Float32Array,
  voicing: Float32Array,
): { wordId: string; emphasis: number; f0MeanHz?: number }[] {
  const features = words.map((word) => {
    const energyValues: number[] = [];
    const pitchValues: number[] = [];
    for (let index = 0; index < frameTimes.length; index += 1) {
      const time = frameTimes[index] ?? 0;
      if (time < word.alignedStart || time >= word.alignedEnd) continue;
      energyValues.push(energy[index] ?? ENERGY_FLOOR_DB);
      if ((voicing[index] ?? 0) > 0.5 && (f0[index] ?? 0) > 0) pitchValues.push(f0[index] ?? 0);
    }
    return {
      energy: mean(energyValues) ?? ENERGY_FLOOR_DB,
      f0: mean(pitchValues),
      duration: Math.max(0, word.alignedEnd - word.alignedStart),
    };
  });
  const energyZ = zScores(features.map((feature) => feature.energy));
  const voicedPitchAverage = mean(features.flatMap(
    (feature) => feature.f0 === undefined ? [] : [feature.f0],
  )) ?? 0;
  const pitchZ = zScores(features.map((feature) => feature.f0 ?? voicedPitchAverage));
  const durationZ = zScores(features.map((feature) => feature.duration));

  return words.map((word, index) => {
    const score = 0.5 * (energyZ[index] ?? 0)
      + 0.3 * (pitchZ[index] ?? 0)
      + 0.2 * (durationZ[index] ?? 0);
    const f0MeanHz = features[index]?.f0;
    return {
      wordId: word.wordId,
      emphasis: 1 / (1 + Math.exp(-score)),
      ...(f0MeanHz === undefined ? {} : { f0MeanHz }),
    };
  });
}

export function analyzeProsody(input: ProsodyAnalysisInput): ProsodyAnalysisResult {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number.');
  }
  const hopSeconds = Math.min(
    0.1,
    Math.max(0.01, Number.isFinite(input.hopSeconds) ? input.hopSeconds : 0.01),
  );
  const hopSamples = Math.max(1, Math.round(hopSeconds * input.sampleRate));
  const windowSamples = Math.max(1, Math.round(WINDOW_SECONDS * input.sampleRate));
  const pointCount = input.pcm.length === 0 ? 0 : Math.ceil(input.pcm.length / hopSamples);
  const f0Hz = new Float32Array(pointCount);
  const voicing = new Float32Array(pointCount);
  const energyRmsDb = new Float32Array(pointCount);
  const frameTimes = new Float64Array(pointCount);
  const frame = new Float32Array(windowSamples);
  const offsetSeconds = input.offsetSeconds ?? 0;

  for (let index = 0; index < pointCount; index += 1) {
    const sampleStart = index * hopSamples;
    frame.fill(0);
    frame.set(input.pcm.subarray(sampleStart, Math.min(input.pcm.length, sampleStart + windowSamples)));
    let squareSum = 0;
    for (const sample of frame) squareSum += sample * sample;
    energyRmsDb[index] = Math.max(
      ENERGY_FLOOR_DB,
      20 * Math.log10(Math.max(
        10 ** (ENERGY_FLOOR_DB / 20),
        Math.sqrt(squareSum / frame.length),
      )),
    );

    const frameTime = offsetSeconds + (sampleStart + windowSamples / 2) / input.sampleRate;
    frameTimes[index] = frameTime;
    const pitch = yinPitchFrame(frame, input.sampleRate);
    if (isInVad(frameTime, input.vadSegments)) {
      f0Hz[index] = pitch.f0Hz;
      voicing[index] = pitch.probability;
    }
  }

  const speechRateSps = calculateSpeechRate(energyRmsDb, voicing, hopSeconds);
  const voicedPitch = Array.from(f0Hz).filter((value, index) =>
    value > 0 && (voicing[index] ?? 0) > 0.5);
  const p10 = quantile(voicedPitch, 0.1);
  const p90 = quantile(voicedPitch, 0.9);
  const speechRates = Array.from(speechRateSps).filter((_, index) =>
    isInVad(frameTimes[index] ?? 0, input.vadSegments)
      && (input.vadSegments ? true : (voicing[index] ?? 0) > 0.5));
  const medianF0Hz = quantile(voicedPitch, 0.5);
  const meanSpeechRateSps = mean(speechRates);

  return {
    hopSeconds,
    windowSeconds: WINDOW_SECONDS,
    f0Hz,
    voicing,
    energyRmsDb,
    speechRateSps,
    summary: {
      ...(medianF0Hz === undefined ? {} : { medianF0Hz }),
      ...(p10 && p90 ? { f0RangeSemitones: 12 * Math.log2(p90 / p10) } : {}),
      ...(meanSpeechRateSps === undefined ? {} : { meanSpeechRateSps }),
    },
    ...(input.alignedWords
      ? { wordEmphasis: calculateWordEmphasis(input.alignedWords, frameTimes, energyRmsDb, f0Hz, voicing) }
      : {}),
  };
}
