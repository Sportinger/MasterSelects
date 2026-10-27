// Pure planning of the trim modes sheet: which neighbours a clip touches, how far it can slip, slide
// or roll, and why a mode cannot run. Times are seconds; the sheet steps in frames of the composition.
// The limits mirror the editor's trim operations (trimOperations.ts) so the sheet can say "no room"
// instead of letting the editor clamp silently.

import type { TimelineClip } from '../../../types/timeline';
import { MIN_CLIP_DURATION } from '../../../stores/timeline/editOperations/trimOperations';

const TOUCH = 1e-3;

const endOf = (clip: Pick<TimelineClip, 'startTime' | 'duration'>) => clip.startTime + clip.duration;

/** Source length the editor allows for slipping (natural duration, else what the clip shows). */
export function phoneSourceDuration(clip: TimelineClip): number {
  const natural = clip.source?.naturalDuration;
  if (typeof natural === 'number' && Number.isFinite(natural) && natural > 0) return natural;
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, MIN_CLIP_DURATION);
}

export interface PhoneTrimNeighbours {
  /** The clip that ends exactly where this one starts, on the same track. */
  previous: TimelineClip | null;
  /** The clip that starts exactly where this one ends, on the same track. */
  next: TimelineClip | null;
}

export function phoneTrimNeighbours(clips: readonly TimelineClip[], clip: TimelineClip): PhoneTrimNeighbours {
  const lane = clips.filter((candidate) => candidate.trackId === clip.trackId && candidate.id !== clip.id);
  return {
    previous: lane.find((candidate) => Math.abs(endOf(candidate) - clip.startTime) <= TOUCH) ?? null,
    next: lane.find((candidate) => Math.abs(candidate.startTime - endOf(clip)) <= TOUCH) ?? null,
  };
}

export interface PhoneRange { min: number; max: number }

/** Source delta the slip can use: the unused footage before the in point and after the out point. */
export function phoneSlipRange(clip: TimelineClip): PhoneRange {
  return { min: -Math.max(0, clip.inPoint), max: Math.max(0, phoneSourceDuration(clip) - clip.outPoint) };
}

/** Timeline delta the slide can use: the neighbours keep at least the minimum clip length. */
export function phoneSlideRange(neighbours: PhoneTrimNeighbours): PhoneRange | null {
  if (!neighbours.previous || !neighbours.next) return null;
  return { min: -(neighbours.previous.duration - MIN_CLIP_DURATION), max: neighbours.next.duration - MIN_CLIP_DURATION };
}

/** Cut-time delta a roll can use without making either side shorter than the minimum. */
export function phoneRollRange(left: TimelineClip, right: TimelineClip): PhoneRange {
  return { min: -(left.duration - MIN_CLIP_DURATION), max: right.duration - MIN_CLIP_DURATION };
}

export function clampToRange(value: number, range: PhoneRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** Why "ripple trim start/end to the playhead" cannot run, or null when it can. */
export function phoneRippleTrimReason(clip: TimelineClip, playhead: number): string | null {
  if (playhead <= clip.startTime + MIN_CLIP_DURATION || playhead >= endOf(clip) - MIN_CLIP_DURATION) {
    return 'Move the playhead inside the selected clip first: the trim cuts the clip at the playhead and closes the gap.';
  }
  return null;
}

/** Frames as a signed label: "+12 f", "−3 f", "0 f". */
export function formatPhoneFrames(frames: number): string {
  if (frames === 0) return '0 f';
  return `${frames > 0 ? '+' : '−'}${Math.abs(frames)} f`;
}

/** The best clip to link a lone clip with: the most-overlapping unlinked clip of the other kind. */
export function phoneLinkCandidate(clips: readonly TimelineClip[], clip: TimelineClip, audioTrackIds: ReadonlySet<string>): TimelineClip | null {
  const clipIsAudio = audioTrackIds.has(clip.trackId);
  let best: TimelineClip | null = null;
  let bestOverlap = 0;
  for (const candidate of clips) {
    if (candidate.id === clip.id || candidate.linkedClipId || candidate.linkedGroupId) continue;
    if (audioTrackIds.has(candidate.trackId) === clipIsAudio) continue;
    const overlap = Math.min(endOf(candidate), endOf(clip)) - Math.max(candidate.startTime, clip.startTime);
    if (overlap > bestOverlap + TOUCH) { best = candidate; bestOverlap = overlap; }
  }
  return best;
}
