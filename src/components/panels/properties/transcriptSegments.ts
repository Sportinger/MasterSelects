import type { TranscriptWord } from '../../../types/clipMetadata';
import { effectiveWordTiming } from '../../../services/transcription/effectiveWordTiming';

const SEGMENT_GAP_SECONDS = 1.5;
const TARGET_SEGMENT_SECONDS = 12;
const TARGET_SEGMENT_WORDS = 14;
const MAX_SEGMENT_WORDS = 44;
const SENTENCE_END_PATTERN = /(?:[.!?]|\.\.\.)["')\]]?$/u;

export interface TranscriptSpeakerSegment {
  endTime: number;
  endWordIndex: number;
  id: string;
  speaker: string;
  startTime: number;
  startWordIndex: number;
  words: TranscriptWord[];
}

function getSpeakerLabel(word: TranscriptWord): string {
  return word.speaker?.trim() || 'Speaker 1';
}

function endsSentence(word: TranscriptWord): boolean {
  return SENTENCE_END_PATTERN.test(word.text.trim());
}

export function buildTranscriptSpeakerSegments(
  transcript: readonly TranscriptWord[],
): TranscriptSpeakerSegment[] {
  if (transcript.length === 0) return [];

  const orderedWords = transcript.toSorted((left, right) =>
    effectiveWordTiming(left).start - effectiveWordTiming(right).start);
  const segments: TranscriptSpeakerSegment[] = [];
  let current: TranscriptSpeakerSegment | null = null;

  for (const [wordIndex, word] of orderedWords.entries()) {
    const timing = effectiveWordTiming(word);
    const speaker = getSpeakerLabel(word);
    const previousWord = current?.words.at(-1);
    const speakerChanged = current !== null && current.speaker !== speaker;
    const gapExceeded = current !== null && timing.start - current.endTime > SEGMENT_GAP_SECONDS;
    const reachedHardLimit = current !== null && current.words.length >= MAX_SEGMENT_WORDS;
    const reachedReadableBoundary = current !== null
      && previousWord !== undefined
      && current.words.length >= TARGET_SEGMENT_WORDS
      && timing.start - current.startTime >= TARGET_SEGMENT_SECONDS
      && endsSentence(previousWord);

    if (!current || speakerChanged || gapExceeded || reachedHardLimit || reachedReadableBoundary) {
      if (current) segments.push(current);
      current = {
        endTime: timing.end,
        endWordIndex: wordIndex,
        id: `segment-${wordIndex}-${timing.start}`,
        speaker,
        startTime: timing.start,
        startWordIndex: wordIndex,
        words: [word],
      };
      continue;
    }

    current.words.push(word);
    current.endTime = Math.max(current.endTime, timing.end);
    current.endWordIndex = wordIndex;
  }

  if (current) segments.push(current);
  return segments;
}

export function findActiveTranscriptWordIndex(
  orderedTranscript: readonly TranscriptWord[],
  sourceTime: number,
): number | null {
  if (!Number.isFinite(sourceTime) || sourceTime < 0 || orderedTranscript.length === 0) {
    return null;
  }

  let left = 0;
  let right = orderedTranscript.length - 1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const word = orderedTranscript[middle];
    const timing = effectiveWordTiming(word);
    if (sourceTime < timing.start) {
      right = middle - 1;
    } else if (sourceTime > timing.end) {
      left = middle + 1;
    } else {
      return middle;
    }
  }

  return null;
}

export function getTranscriptSpeakerTone(speaker: string): number {
  let hash = 0;
  for (const character of speaker) {
    hash = ((hash << 5) - hash + (character.codePointAt(0) ?? 0)) | 0;
  }
  return Math.abs(hash) % 6;
}

export function findTranscriptTimelineOffset(
  sourceTime: number,
  sourceStart: number,
  clipDuration: number,
  getSourceOffset: (timelineOffset: number) => number,
): number {
  if (!Number.isFinite(sourceTime) || !Number.isFinite(sourceStart) || clipDuration <= 0) {
    return 0;
  }

  const targetOffset = sourceTime - sourceStart;
  const distanceAt = (timelineOffset: number) =>
    Math.abs(getSourceOffset(timelineOffset) - targetOffset);
  const sampleCount = 96;
  let bestTimelineOffset = 0;
  let bestDistance = distanceAt(0);

  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const timelineOffset = clipDuration * (sample / sampleCount);
    const distance = distanceAt(timelineOffset);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTimelineOffset = timelineOffset;
    }
  }

  let radius = clipDuration / sampleCount;
  for (let pass = 0; pass < 14; pass += 1) {
    const left = Math.max(0, bestTimelineOffset - radius);
    const right = Math.min(clipDuration, bestTimelineOffset + radius);
    for (const candidate of [left, right]) {
      const distance = distanceAt(candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTimelineOffset = candidate;
      }
    }
    radius /= 2;
  }

  return bestTimelineOffset;
}

export function formatTranscriptTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalTenths = Math.floor(safeSeconds * 10);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const clock = hours > 0
    ? `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${clock}.${tenths}`;
}
