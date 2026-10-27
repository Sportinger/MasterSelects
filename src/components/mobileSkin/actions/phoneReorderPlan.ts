// Pure placement planning for a phone clip drag (long-press + drag).
//
// The editor's `move-clips` operation moves clips but does not resolve collisions, so the phone
// decides the final positions before it submits ONE operation:
// - a drop on the main track that overlaps other clips reorders the sequence: the clips between
//   the old and the new slot are laid back to back (explicit reorder, never automatic magnetism);
// - a drop from another lane between main-track clips inserts it and shifts the following clips
//   just far enough to make room;
// - a drop into free space (any lane) keeps the dropped position; a drop that overlaps a clip on
//   a secondary lane snaps to the nearest free start.

export interface PhoneSequenceClip {
  id: string;
  startTime: number;
  duration: number;
}

export interface PhoneSequenceMove {
  clipId: string;
  startTime: number;
}

export interface PhoneMainTrackDropInput {
  /** Clips on the main track. May include the dragged clip at its original position. */
  trackClips: readonly PhoneSequenceClip[];
  draggedClipId: string;
  /** Start time where the dragged clip was dropped (seconds). */
  dropStart: number;
  draggedDuration: number;
}

export type PhoneMainTrackDropPlan =
  /** The drop overlaps nothing: move the clip to `startTime` as dropped. */
  | { kind: 'free'; startTime: number }
  /** Back-to-back order of the main track after the drop and every start that changes. */
  | { kind: 'reorder'; order: string[]; moves: PhoneSequenceMove[] };

const EPSILON = 1e-4;

const clipEnd = (clip: PhoneSequenceClip) => clip.startTime + clip.duration;
const byStart = (a: PhoneSequenceClip, b: PhoneSequenceClip) => a.startTime - b.startTime || a.id.localeCompare(b.id);

function overlaps(clips: readonly PhoneSequenceClip[], start: number, end: number): boolean {
  return clips.some((clip) => clip.startTime < end - EPSILON && clipEnd(clip) > start + EPSILON);
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Plans a drop onto the main track: free placement, reorder or insert. */
export function planPhoneMainTrackDrop(input: PhoneMainTrackDropInput): PhoneMainTrackDropPlan {
  const duration = Math.max(EPSILON, finite(input.draggedDuration, EPSILON));
  const dropStart = Math.max(0, finite(input.dropStart));
  const sorted = input.trackClips.toSorted(byStart);
  const others = sorted.filter((clip) => clip.id !== input.draggedClipId);

  if (!overlaps(others, dropStart, dropStart + duration)) return { kind: 'free', startTime: dropStart };

  // Slot = number of other clips whose centre lies before the dropped clip's centre.
  const dropCentre = dropStart + duration / 2;
  const slot = others.filter((clip) => clip.startTime + clip.duration / 2 < dropCentre).length;
  const dragged: PhoneSequenceClip = { id: input.draggedClipId, startTime: dropStart, duration };
  const order = [...others.slice(0, slot), dragged, ...others.slice(slot)];
  const originalIndex = sorted.findIndex((clip) => clip.id === input.draggedClipId);
  const nextStarts = new Map<string, number>();

  if (originalIndex >= 0) {
    // Same-track reorder: only the clips between the old and the new slot change. They are laid
    // back to back from the first start of that range; clips outside it keep their positions.
    const low = Math.min(originalIndex, slot);
    const high = Math.max(originalIndex, slot);
    let cursor = sorted[low].startTime;
    for (let index = low; index <= high; index += 1) {
      const clip = order[index];
      nextStarts.set(clip.id, cursor);
      cursor += clip.duration;
    }
  } else {
    // Insert from another lane: place after the previous clip (or at the first clip's start) and
    // shift every following clip by the same minimal amount, keeping their gaps.
    const anchor = slot > 0 ? clipEnd(others[slot - 1]) : others[0].startTime;
    nextStarts.set(dragged.id, anchor);
    const following = others.slice(slot);
    const shift = following.length > 0 ? Math.max(0, anchor + duration - following[0].startTime) : 0;
    if (shift > EPSILON) for (const clip of following) nextStarts.set(clip.id, clip.startTime + shift);
  }

  const originalStart = new Map(sorted.map((clip) => [clip.id, clip.startTime]));
  const moves: PhoneSequenceMove[] = [];
  for (const clip of order) {
    const next = nextStarts.get(clip.id);
    if (next === undefined) continue;
    const before = originalStart.get(clip.id);
    if (clip.id === input.draggedClipId || before === undefined || Math.abs(before - next) > EPSILON) {
      moves.push({ clipId: clip.id, startTime: Math.max(0, next) });
    }
  }
  return { kind: 'reorder', order: order.map((clip) => clip.id), moves };
}

/**
 * Nearest start time to `desiredStart` where a clip of `duration` overlaps none of `trackClips`
 * (which must not contain the dragged clip). There is always room after the last clip.
 */
export function findNearestFreeStart(trackClips: readonly PhoneSequenceClip[], duration: number, desiredStart: number): number {
  const safeDuration = Math.max(EPSILON, finite(duration, EPSILON));
  const desired = Math.max(0, finite(desiredStart));
  if (!overlaps(trackClips, desired, desired + safeDuration)) return desired;
  const candidates = trackClips.flatMap((clip) => [clipEnd(clip), clip.startTime - safeDuration]);
  let best: number | null = null;
  for (const candidate of candidates) {
    if (candidate < -EPSILON) continue;
    const start = Math.max(0, candidate);
    if (overlaps(trackClips, start, start + safeDuration)) continue;
    if (best === null || Math.abs(start - desired) < Math.abs(best - desired)) best = start;
  }
  return best ?? Math.max(0, ...trackClips.map(clipEnd));
}
