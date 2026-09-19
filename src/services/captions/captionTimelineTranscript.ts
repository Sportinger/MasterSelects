import type { TranscriptWord } from '../../types/clipMetadata';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { getClipSourceRate } from '../../utils/clipPlaybackTiming';
import {
  getCaptionSourceCandidates,
  resolveTranscriptSourceAtTime,
} from './captionRuntime';

const TIME_EPSILON = 1e-6;
export const DEFAULT_VISIBLE_PAUSE_SECONDS = 0.3;

export interface CaptionTimelineWordEvent {
  kind: 'word';
  key: string;
  sourceClipId: string;
  sourceEnd: number;
  sourceStart: number;
  text: string;
  timelineEnd: number;
  timelineStart: number;
  wordId: string;
}

export interface CaptionTimelinePauseEvent {
  kind: 'pause';
  key: string;
  sourceClipId: string;
  timelineEnd: number;
  timelineStart: number;
}

export type CaptionTimelineTranscriptEvent =
  | CaptionTimelineWordEvent
  | CaptionTimelinePauseEvent;

function wordStart(word: TranscriptWord): number {
  return word.alignedStart ?? word.start;
}

function wordEnd(word: TranscriptWord): number {
  return word.alignedEnd ?? word.end;
}

function playsInReverse(clip: TimelineClip): boolean {
  return Boolean(clip.reversed) !== ((clip.speed ?? 1) < 0);
}

export function sourceTimeToCaptionTimelineTime(
  clip: TimelineClip,
  sourceTime: number,
): number {
  const rate = getClipSourceRate(clip);
  const sourceOffset = playsInReverse(clip)
    ? clip.outPoint - sourceTime
    : sourceTime - clip.inPoint;
  return clip.startTime + sourceOffset / rate;
}

function createWordEvents(input: {
  clips: readonly TimelineClip[];
  sourceClipId?: string | null;
  timelineEnd: number;
  timelineStart: number;
  tracks: readonly TimelineTrack[];
}): CaptionTimelineWordEvent[] {
  const events: CaptionTimelineWordEvent[] = [];

  for (const candidate of getCaptionSourceCandidates(input.clips)) {
    const clipStart = candidate.clip.startTime;
    const clipEnd = clipStart + candidate.clip.duration;
    for (const word of candidate.words) {
      const sourceStart = wordStart(word);
      const sourceEnd = wordEnd(word);
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) continue;
      const mappedA = sourceTimeToCaptionTimelineTime(candidate.clip, sourceStart);
      const mappedB = sourceTimeToCaptionTimelineTime(candidate.clip, sourceEnd);
      const timelineStart = Math.max(input.timelineStart, clipStart, Math.min(mappedA, mappedB));
      const timelineEnd = Math.min(input.timelineEnd, clipEnd, Math.max(mappedA, mappedB));
      if (timelineEnd - timelineStart <= TIME_EPSILON) continue;

      const selectedSource = resolveTranscriptSourceAtTime({
        clips: input.clips,
        sourceClipId: input.sourceClipId,
        tracks: input.tracks,
        timelineTime: (timelineStart + timelineEnd) / 2,
      });
      if (selectedSource?.clip.id !== candidate.clip.id) continue;
      events.push({
        kind: 'word',
        key: `word:${candidate.clip.id}:${word.id}:${timelineStart.toFixed(6)}`,
        sourceClipId: candidate.clip.id,
        sourceEnd,
        sourceStart,
        text: word.text,
        timelineEnd,
        timelineStart,
        wordId: word.id,
      });
    }
  }

  return events.toSorted((left, right) =>
    left.timelineStart - right.timelineStart
    || left.timelineEnd - right.timelineEnd
    || left.key.localeCompare(right.key)
  );
}

export function createCaptionTimelineTranscript(input: {
  captionClip: TimelineClip;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  pauseThreshold?: number;
}): CaptionTimelineTranscriptEvent[] {
  return createTimelineTranscript({
    clips: input.clips.filter(clip => clip.id !== input.captionClip.id),
    pauseThreshold: input.pauseThreshold,
    sourceClipId: input.captionClip.captionProperties?.sourceClipId,
    timelineEnd: input.captionClip.startTime + input.captionClip.duration,
    timelineStart: input.captionClip.startTime,
    tracks: input.tracks,
  });
}

export function createTimelineTranscript(input: {
  clips: readonly TimelineClip[];
  pauseThreshold?: number;
  sourceClipId?: string | null;
  timelineEnd: number;
  timelineStart?: number;
  tracks: readonly TimelineTrack[];
}): CaptionTimelineTranscriptEvent[] {
  const words = createWordEvents({
    ...input,
    timelineStart: input.timelineStart ?? 0,
  });
  const threshold = Math.max(0, input.pauseThreshold ?? DEFAULT_VISIBLE_PAUSE_SECONDS);
  const events: CaptionTimelineTranscriptEvent[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const previous = words[index - 1];
    if (
      previous
      && previous.sourceClipId === word.sourceClipId
      && word.timelineStart - previous.timelineEnd >= threshold
    ) {
      events.push({
        kind: 'pause',
        key: `pause:${word.sourceClipId}:${previous.timelineEnd.toFixed(6)}:${word.timelineStart.toFixed(6)}`,
        sourceClipId: word.sourceClipId,
        timelineStart: previous.timelineEnd,
        timelineEnd: word.timelineStart,
      });
    }
    events.push(word);
  }
  return events;
}
