import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import type { TimelineClip } from '../../types';
import { getClipAudioSourceRange } from './audioRepairSuggestionOperations';

export interface AudioTransientDetectionOptions {
  crestThresholdDb?: number;
  minPeakDb?: number;
  windowSeconds?: number;
  hopSeconds?: number;
  paddingSeconds?: number;
  mergeGapSeconds?: number;
  maxRanges?: number;
}

export interface AudioTransientRange {
  start: number;
  end: number;
  duration: number;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  strength: number;
}

export interface ClipTransientDetectionOptions extends AudioTransientDetectionOptions {
  sourceOffsetSeconds?: number;
}

const DEFAULT_CREST_THRESHOLD_DB = 18;
const DEFAULT_MIN_PEAK_DB = -8;
const DEFAULT_WINDOW_SECONDS = 0.012;
const DEFAULT_HOP_SECONDS = 0.004;
const DEFAULT_PADDING_SECONDS = 0.014;
const DEFAULT_MERGE_GAP_SECONDS = 0.035;
const DEFAULT_MAX_RANGES = 64;
const FLOOR_DB = -120;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function amplitudeToDb(value: number): number {
  return value > 0.000001 ? 20 * Math.log10(value) : FLOOR_DB;
}

function windowStats(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
): {
  peak: number;
  peakSample: number;
  rms: number;
} {
  let peak = 0;
  let peakSample = startSample;
  let sumSquares = 0;
  let count = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let sample = startSample; sample < endSample; sample += 1) {
      const value = data[sample] ?? 0;
      const abs = Math.abs(value);
      if (abs > peak) {
        peak = abs;
        peakSample = sample;
      }
      sumSquares += value * value;
      count += 1;
    }
  }

  let backgroundSumSquares = 0;
  let backgroundCount = 0;
  const peakExclusionThreshold = peak * 0.5;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let sample = startSample; sample < endSample; sample += 1) {
      const value = data[sample] ?? 0;
      if (Math.abs(value) >= peakExclusionThreshold && peakExclusionThreshold > 0) continue;
      backgroundSumSquares += value * value;
      backgroundCount += 1;
    }
  }

  return {
    peak,
    peakSample,
    rms: backgroundCount > 0
      ? Math.sqrt(backgroundSumSquares / backgroundCount)
      : count > 0 ? Math.sqrt(sumSquares / count) : 0,
  };
}

function mergeTransientRanges(
  ranges: AudioTransientRange[],
  mergeGapSeconds: number,
): AudioTransientRange[] {
  const merged: AudioTransientRange[] = [];
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start - previous.end <= mergeGapSeconds) {
      previous.end = Math.max(previous.end, range.end);
      previous.duration = previous.end - previous.start;
      previous.peakDb = Math.max(previous.peakDb, range.peakDb);
      previous.rmsDb = Math.min(previous.rmsDb, range.rmsDb);
      previous.crestDb = Math.max(previous.crestDb, range.crestDb);
      previous.strength = Math.max(previous.strength, range.strength);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function detectAudioTransientRanges(
  buffer: AudioBuffer,
  options: AudioTransientDetectionOptions = {},
): AudioTransientRange[] {
  if (buffer.length <= 0 || buffer.numberOfChannels <= 0 || buffer.sampleRate <= 0) {
    return [];
  }

  const crestThresholdDb = clamp(options.crestThresholdDb ?? DEFAULT_CREST_THRESHOLD_DB, 6, 60);
  const minPeakDb = clamp(options.minPeakDb ?? DEFAULT_MIN_PEAK_DB, -60, 0);
  const windowSeconds = clamp(options.windowSeconds ?? DEFAULT_WINDOW_SECONDS, 0.002, 0.12);
  const hopSeconds = clamp(options.hopSeconds ?? DEFAULT_HOP_SECONDS, 0.001, windowSeconds);
  const paddingSeconds = clamp(options.paddingSeconds ?? DEFAULT_PADDING_SECONDS, 0.001, 0.25);
  const mergeGapSeconds = clamp(options.mergeGapSeconds ?? DEFAULT_MERGE_GAP_SECONDS, 0, 0.5);
  const maxRanges = Math.max(1, Math.min(512, Math.round(options.maxRanges ?? DEFAULT_MAX_RANGES)));
  const windowSamples = Math.max(2, Math.round(windowSeconds * buffer.sampleRate));
  const hopSamples = Math.max(1, Math.round(hopSeconds * buffer.sampleRate));
  const paddingSamples = Math.max(1, Math.round(paddingSeconds * buffer.sampleRate));
  const candidates: AudioTransientRange[] = [];

  for (let startSample = 0; startSample < buffer.length; startSample += hopSamples) {
    const endSample = Math.min(buffer.length, startSample + windowSamples);
    if (endSample - startSample < 2) continue;

    const stats = windowStats(buffer, startSample, endSample);
    const peakDb = amplitudeToDb(stats.peak);
    const rmsDb = amplitudeToDb(stats.rms);
    const crestDb = peakDb - rmsDb;
    if (peakDb < minPeakDb || crestDb < crestThresholdDb) continue;

    const start = Math.max(0, (stats.peakSample - paddingSamples) / buffer.sampleRate);
    const end = Math.min(buffer.duration, (stats.peakSample + paddingSamples + 1) / buffer.sampleRate);
    const peakLift = Math.max(0, peakDb - minPeakDb);
    candidates.push({
      start,
      end,
      duration: Math.max(0, end - start),
      peakDb,
      rmsDb,
      crestDb,
      strength: Math.max(0, crestDb - crestThresholdDb) + peakLift * 0.2,
    });
  }

  return mergeTransientRanges(candidates, mergeGapSeconds)
    .toSorted((a, b) => b.strength - a.strength || a.start - b.start)
    .slice(0, maxRanges)
    .toSorted((a, b) => a.start - b.start);
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

export async function detectClipTransientRanges(
  clip: TimelineClip,
  options: ClipTransientDetectionOptions = {},
  extractor: Pick<AudioExtractor, 'extractAudio' | 'trimBuffer'> = audioExtractor,
): Promise<AudioTransientRange[]> {
  const sourceRange = getClipAudioSourceRange(clip);
  if (sourceRange.end - sourceRange.start <= 0.0005) {
    return [];
  }

  const sourceBuffer = await extractor.extractAudio(
    clip.file,
    getClipMediaFileId(clip) ?? clip.id,
  );
  const clipBuffer = extractor.trimBuffer(sourceBuffer, sourceRange.start, sourceRange.end);
  const sourceOffsetSeconds = options.sourceOffsetSeconds ?? sourceRange.start;

  return detectAudioTransientRanges(clipBuffer, options).map(range => ({
    ...range,
    start: sourceOffsetSeconds + range.start,
    end: sourceOffsetSeconds + range.end,
  }));
}
