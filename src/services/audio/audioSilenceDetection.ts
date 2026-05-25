import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import type { TimelineClip } from '../../types';
import { getClipAudioSourceRange } from './audioRepairSuggestionOperations';

export interface AudioSilenceDetectionOptions {
  thresholdDb?: number;
  minSilenceSeconds?: number;
  windowSeconds?: number;
  hopSeconds?: number;
  paddingSeconds?: number;
  mergeGapSeconds?: number;
  maxRanges?: number;
}

export interface AudioSilenceRange {
  start: number;
  end: number;
  duration: number;
  rmsDb: number;
}

export interface ClipSilenceDetectionOptions extends AudioSilenceDetectionOptions {
  sourceOffsetSeconds?: number;
}

const DEFAULT_THRESHOLD_DB = -50;
const DEFAULT_MIN_SILENCE_SECONDS = 0.32;
const DEFAULT_WINDOW_SECONDS = 0.05;
const DEFAULT_HOP_SECONDS = 0.025;
const DEFAULT_PADDING_SECONDS = 0.025;
const DEFAULT_MERGE_GAP_SECONDS = 0.12;
const DEFAULT_MAX_RANGES = 96;
const SILENCE_FLOOR_DB = -120;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function linearToDb(value: number): number {
  if (value <= 0.000001) return SILENCE_FLOOR_DB;
  return 20 * Math.log10(value);
}

function windowRmsDb(buffer: AudioBuffer, startSample: number, endSample: number): number {
  let sum = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let sample = startSample; sample < endSample; sample += 1) {
      const value = data[sample] ?? 0;
      sum += value * value;
      count += 1;
    }
  }

  return count > 0 ? linearToDb(Math.sqrt(sum / count)) : SILENCE_FLOOR_DB;
}

function rangeRmsDb(buffer: AudioBuffer, startSeconds: number, endSeconds: number): number {
  const startSample = Math.max(0, Math.min(buffer.length, Math.floor(startSeconds * buffer.sampleRate)));
  const endSample = Math.max(startSample, Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate)));
  return windowRmsDb(buffer, startSample, endSample);
}

function mergeSilenceRanges(
  ranges: AudioSilenceRange[],
  mergeGapSeconds: number,
): AudioSilenceRange[] {
  const merged: AudioSilenceRange[] = [];
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start - previous.end <= mergeGapSeconds) {
      previous.end = Math.max(previous.end, range.end);
      previous.duration = previous.end - previous.start;
      previous.rmsDb = Math.min(previous.rmsDb, range.rmsDb);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export function detectAudioSilenceRanges(
  buffer: AudioBuffer,
  options: AudioSilenceDetectionOptions = {},
): AudioSilenceRange[] {
  if (buffer.length <= 0 || buffer.numberOfChannels <= 0 || buffer.sampleRate <= 0) {
    return [];
  }

  const thresholdDb = clamp(options.thresholdDb ?? DEFAULT_THRESHOLD_DB, -100, -12);
  const minSilenceSeconds = clamp(options.minSilenceSeconds ?? DEFAULT_MIN_SILENCE_SECONDS, 0.05, 30);
  const windowSeconds = clamp(options.windowSeconds ?? DEFAULT_WINDOW_SECONDS, 0.01, 0.5);
  const hopSeconds = clamp(options.hopSeconds ?? DEFAULT_HOP_SECONDS, 0.005, windowSeconds);
  const paddingSeconds = clamp(options.paddingSeconds ?? DEFAULT_PADDING_SECONDS, 0, 1);
  const mergeGapSeconds = clamp(options.mergeGapSeconds ?? DEFAULT_MERGE_GAP_SECONDS, 0, 2);
  const maxRanges = Math.max(1, Math.min(512, Math.round(options.maxRanges ?? DEFAULT_MAX_RANGES)));

  const windowSamples = Math.max(1, Math.round(windowSeconds * buffer.sampleRate));
  const hopSamples = Math.max(1, Math.round(hopSeconds * buffer.sampleRate));
  const ranges: AudioSilenceRange[] = [];
  let activeStartSample: number | null = null;
  let activeWorstRmsDb = 0;

  for (let startSample = 0; startSample < buffer.length; startSample += hopSamples) {
    const endSample = Math.min(buffer.length, startSample + windowSamples);
    const rmsDb = windowRmsDb(buffer, startSample, endSample);
    if (rmsDb <= thresholdDb) {
      if (activeStartSample === null) {
        activeStartSample = startSample;
        activeWorstRmsDb = rmsDb;
      } else {
        activeWorstRmsDb = Math.min(activeWorstRmsDb, rmsDb);
      }
      continue;
    }

    if (activeStartSample !== null) {
      const startSeconds = Math.max(0, activeStartSample / buffer.sampleRate - paddingSeconds);
      const endSeconds = Math.min(buffer.duration, startSample / buffer.sampleRate + paddingSeconds);
      if (endSeconds - startSeconds >= minSilenceSeconds) {
        ranges.push({
          start: startSeconds,
          end: endSeconds,
          duration: endSeconds - startSeconds,
          rmsDb: rangeRmsDb(buffer, startSeconds, endSeconds) || activeWorstRmsDb,
        });
      }
      activeStartSample = null;
      activeWorstRmsDb = 0;
    }
  }

  if (activeStartSample !== null) {
    const startSeconds = Math.max(0, activeStartSample / buffer.sampleRate - paddingSeconds);
    const endSeconds = buffer.duration;
    if (endSeconds - startSeconds >= minSilenceSeconds) {
      ranges.push({
        start: startSeconds,
        end: endSeconds,
        duration: endSeconds - startSeconds,
        rmsDb: rangeRmsDb(buffer, startSeconds, endSeconds) || activeWorstRmsDb,
      });
    }
  }

  return mergeSilenceRanges(ranges, mergeGapSeconds)
    .filter(range => range.duration >= minSilenceSeconds)
    .slice(0, maxRanges);
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

export async function detectClipSilenceRanges(
  clip: TimelineClip,
  options: ClipSilenceDetectionOptions = {},
  extractor: Pick<AudioExtractor, 'extractAudio' | 'trimBuffer'> = audioExtractor,
): Promise<AudioSilenceRange[]> {
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

  return detectAudioSilenceRanges(clipBuffer, options).map(range => ({
    ...range,
    start: sourceOffsetSeconds + range.start,
    end: sourceOffsetSeconds + range.end,
  }));
}
