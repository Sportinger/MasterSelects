import type { TranscriptWord } from '../../types/clipMetadata';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { effectiveWordTiming } from './effectiveWordTiming';
import { resolveClipTranscriptWords } from './clipTranscriptResolver';

const MAX_WORD_TEXT_CHARACTERS = 500;
const MAX_SEGMENT_WORDS = 40;
const SEGMENT_GAP_SECONDS = 1.2;

export interface TimelineSpeechWord {
  audioClipId?: string;
  clipId: string;
  mediaFileId?: string;
  sourceEnd: number;
  sourceStart: number;
  speaker?: string;
  text: string;
  timelineEnd: number;
  timelineStart: number;
  trackId: string;
  wordId: string;
}

export interface TimelineSpeechSegment {
  audioClipId?: string;
  clipId: string;
  mediaFileId?: string;
  sourceEnd: number;
  sourceStart: number;
  speaker?: string;
  text: string;
  timelineEnd: number;
  timelineStart: number;
  trackId: string;
  wordCount: number;
}

export interface TimelineSpeechProjection {
  audibleClipCount: number;
  clipWordCounts: ReadonlyMap<string, { returnedWords: number; totalWords: number }>;
  excluded: {
    linkedDuplicateClipCount: number;
    mutedOrUnsoloedClipCount: number;
  };
  overlappingWordCount: number;
  range: { end: number; start: number };
  segments: TimelineSpeechSegment[];
  sourceClipCount: number;
  text: string;
  timebase: 'timeline-seconds';
  totalWords: number;
  truncated: boolean;
  words: TimelineSpeechWord[];
}

export interface BuildTimelineSpeechProjectionInput {
  clips: readonly TimelineClip[];
  endTime?: number;
  maximumWords: number;
  startTime?: number;
  tracks: readonly TimelineTrack[];
}

interface TimelineSpeechCandidate {
  audibleClip: TimelineClip;
  audibleTrack?: TimelineTrack;
  canonicalClip: TimelineClip;
  transcript: readonly TranscriptWord[];
}

function roundedTime(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sourceTimeToTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const sourceStart = Math.min(clip.inPoint, clip.outPoint);
  const sourceEnd = Math.max(clip.inPoint, clip.outPoint);
  const sourceSpan = Math.max(0.000001, sourceEnd - sourceStart);
  const sourceRatio = Math.min(1, Math.max(0, (sourceTime - sourceStart) / sourceSpan));
  const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
  const timelineRatio = reversed ? 1 - sourceRatio : sourceRatio;
  return roundedTime(clip.startTime + timelineRatio * clip.duration);
}

function mediaFileId(clip: TimelineClip): string | undefined {
  return clip.mediaFileId ?? clip.source?.mediaFileId;
}

function effectiveTrackMuted(track: TimelineTrack): boolean {
  return track.audioState?.muted ?? track.muted === true;
}

function effectiveTrackSolo(track: TimelineTrack): boolean {
  return track.audioState?.solo ?? track.solo === true;
}

function isAudibleTrack(track: TimelineTrack): boolean {
  return track.type === 'audio' || track.type === 'midi';
}

function readableTokenText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_WORD_TEXT_CHARACTERS);
}

function sentenceEnds(text: string): boolean {
  return /[.!?…]["')\]}]*$/u.test(text);
}

function appendToken(text: string, token: string): string {
  if (text.length === 0) return token;
  if (/^[,.;:!?%…)\]}]/u.test(token)) return `${text}${token}`;
  if (/[([{]$/u.test(text)) return `${text}${token}`;
  return `${text} ${token}`;
}

export function joinTimelineSpeechWords(words: readonly Pick<TimelineSpeechWord, 'text'>[]): string {
  return words.reduce((text, word) => appendToken(text, word.text), '');
}

export function buildTimelineSpeechSegments(
  words: readonly TimelineSpeechWord[],
): TimelineSpeechSegment[] {
  const segments: TimelineSpeechSegment[] = [];
  let current: TimelineSpeechSegment | undefined;
  let previousWord: TimelineSpeechWord | undefined;

  for (const word of words) {
    const startsNewSegment = current === undefined
      || previousWord === undefined
      || current.clipId !== word.clipId
      || current.trackId !== word.trackId
      || current.speaker !== word.speaker
      || current.wordCount >= MAX_SEGMENT_WORDS
      || word.timelineStart - previousWord.timelineEnd > SEGMENT_GAP_SECONDS
      || sentenceEnds(previousWord.text);

    if (startsNewSegment) {
      current = {
        ...(word.audioClipId === undefined ? {} : { audioClipId: word.audioClipId }),
        clipId: word.clipId,
        ...(word.mediaFileId === undefined ? {} : { mediaFileId: word.mediaFileId }),
        sourceEnd: word.sourceEnd,
        sourceStart: word.sourceStart,
        ...(word.speaker === undefined ? {} : { speaker: word.speaker }),
        text: word.text,
        timelineEnd: word.timelineEnd,
        timelineStart: word.timelineStart,
        trackId: word.trackId,
        wordCount: 1,
      };
      segments.push(current);
    } else {
      if (current === undefined) {
        throw new Error('Timeline speech segment state is missing');
      }
      current.sourceEnd = Math.max(current.sourceEnd, word.sourceEnd);
      current.sourceStart = Math.min(current.sourceStart, word.sourceStart);
      current.text = appendToken(current.text, word.text);
      current.timelineEnd = Math.max(current.timelineEnd, word.timelineEnd);
      current.timelineStart = Math.min(current.timelineStart, word.timelineStart);
      current.wordCount += 1;
    }
    previousWord = word;
  }

  return segments;
}

function normalizedRange(input: BuildTimelineSpeechProjectionInput): { end: number; start: number } {
  const timelineEnd = input.clips.reduce(
    (maximum, clip) => Math.max(maximum, clip.startTime + clip.duration),
    0,
  );
  const requestedStart = Number.isFinite(input.startTime) ? input.startTime as number : 0;
  const requestedEnd = Number.isFinite(input.endTime) ? input.endTime as number : timelineEnd;
  return {
    start: roundedTime(Math.max(0, Math.min(requestedStart, requestedEnd))),
    end: roundedTime(Math.max(0, Math.max(requestedStart, requestedEnd))),
  };
}

function collectCandidates(input: BuildTimelineSpeechProjectionInput): {
  candidates: TimelineSpeechCandidate[];
  linkedDuplicateClipCount: number;
  mutedOrUnsoloedClipCount: number;
  sourceClipCount: number;
} {
  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const tracksById = new Map(input.tracks.map((track) => [track.id, track]));
  const hasAudibleSolo = input.tracks.some((track) => (
    isAudibleTrack(track) && effectiveTrackSolo(track)
  ));
  const candidates: TimelineSpeechCandidate[] = [];
  let linkedDuplicateClipCount = 0;
  let mutedOrUnsoloedClipCount = 0;
  let sourceClipCount = 0;

  for (const clip of input.clips) {
    const track = tracksById.get(clip.trackId);
    const linkedClip = clip.linkedClipId ? clipsById.get(clip.linkedClipId) : undefined;
    const linkedTrack = linkedClip ? tracksById.get(linkedClip.trackId) : undefined;
    if (track?.type === 'audio' && linkedTrack?.type === 'video') {
      linkedDuplicateClipCount += 1;
      continue;
    }

    const audibleClip = track?.type === 'video' && linkedTrack?.type === 'audio' && linkedClip
      ? linkedClip
      : clip;
    const audibleTrack = tracksById.get(audibleClip.trackId);
    const transcript = resolveClipTranscriptWords(clip)
      ?? (audibleClip === clip ? undefined : resolveClipTranscriptWords(audibleClip));
    if (!transcript?.length) continue;
    sourceClipCount += 1;

    const clipMuted = audibleClip.audioState?.muted === true;
    const trackMuted = audibleTrack ? effectiveTrackMuted(audibleTrack) : false;
    const excludedBySolo = hasAudibleSolo
      && audibleClip.audioState?.soloSafe !== true
      && (!audibleTrack || !isAudibleTrack(audibleTrack) || !effectiveTrackSolo(audibleTrack));
    if (clipMuted || trackMuted || excludedBySolo) {
      mutedOrUnsoloedClipCount += 1;
      continue;
    }

    candidates.push({ audibleClip, audibleTrack, canonicalClip: clip, transcript });
  }

  return {
    candidates,
    linkedDuplicateClipCount,
    mutedOrUnsoloedClipCount,
    sourceClipCount,
  };
}

export function buildTimelineSpeechProjection(
  input: BuildTimelineSpeechProjectionInput,
): TimelineSpeechProjection {
  const range = normalizedRange(input);
  const trackOrder = new Map(input.tracks.map((track, index) => [track.id, index]));
  const collected = collectCandidates(input);
  const allWords = collected.candidates.flatMap((candidate) => {
    const clip = candidate.canonicalClip;
    const sourceRangeStart = Math.min(clip.inPoint, clip.outPoint);
    const sourceRangeEnd = Math.max(clip.inPoint, clip.outPoint);
    return candidate.transcript.flatMap((word) => {
      const timing = effectiveWordTiming(word);
      const text = readableTokenText(word.text);
      if (
        !Number.isFinite(timing.start)
        || !Number.isFinite(timing.end)
        || timing.end <= timing.start
        || timing.end < sourceRangeStart
        || timing.start > sourceRangeEnd
        || text.length === 0
      ) return [];

      const timelineA = sourceTimeToTimelineTime(clip, Math.max(sourceRangeStart, timing.start));
      const timelineB = sourceTimeToTimelineTime(clip, Math.min(sourceRangeEnd, timing.end));
      const timelineStart = Math.min(timelineA, timelineB);
      const timelineEnd = Math.max(timelineA, timelineB);
      if (timelineEnd < range.start || timelineStart > range.end) return [];

      return [{
        ...(candidate.audibleClip.id === clip.id ? {} : { audioClipId: candidate.audibleClip.id }),
        clipId: clip.id,
        ...(mediaFileId(clip) === undefined ? {} : { mediaFileId: mediaFileId(clip)! }),
        sourceEnd: roundedTime(Math.min(sourceRangeEnd, timing.end)),
        sourceStart: roundedTime(Math.max(sourceRangeStart, timing.start)),
        ...(word.speaker === undefined ? {} : { speaker: word.speaker }),
        text,
        timelineEnd,
        timelineStart,
        trackId: candidate.audibleTrack?.id ?? clip.trackId,
        wordId: word.id,
      } satisfies TimelineSpeechWord];
    });
  }).sort((left, right) => (
    left.timelineStart - right.timelineStart
    || left.timelineEnd - right.timelineEnd
    || (trackOrder.get(left.trackId) ?? Number.MAX_SAFE_INTEGER)
      - (trackOrder.get(right.trackId) ?? Number.MAX_SAFE_INTEGER)
    || left.clipId.localeCompare(right.clipId)
    || left.sourceStart - right.sourceStart
    || left.wordId.localeCompare(right.wordId)
  ));

  const maximumWords = Math.max(0, Math.floor(input.maximumWords));
  const words = allWords.slice(0, maximumWords);
  const totalByClipId = new Map<string, number>();
  const returnedByClipId = new Map<string, number>();
  for (const word of allWords) {
    totalByClipId.set(word.clipId, (totalByClipId.get(word.clipId) ?? 0) + 1);
  }
  for (const word of words) {
    returnedByClipId.set(word.clipId, (returnedByClipId.get(word.clipId) ?? 0) + 1);
  }
  const clipWordCounts = new Map([...totalByClipId].map(([clipId, totalWords]) => [
    clipId,
    { returnedWords: returnedByClipId.get(clipId) ?? 0, totalWords },
  ]));
  let overlappingWordCount = 0;
  let latestTimelineEnd = Number.NEGATIVE_INFINITY;
  for (const word of words) {
    if (word.timelineStart < latestTimelineEnd - 0.000001) overlappingWordCount += 1;
    latestTimelineEnd = Math.max(latestTimelineEnd, word.timelineEnd);
  }

  return {
    audibleClipCount: collected.candidates.length,
    clipWordCounts,
    excluded: {
      linkedDuplicateClipCount: collected.linkedDuplicateClipCount,
      mutedOrUnsoloedClipCount: collected.mutedOrUnsoloedClipCount,
    },
    overlappingWordCount,
    range,
    segments: buildTimelineSpeechSegments(words),
    sourceClipCount: collected.sourceClipCount,
    text: joinTimelineSpeechWords(words),
    timebase: 'timeline-seconds',
    totalWords: allWords.length,
    truncated: words.length < allWords.length,
    words,
  };
}
