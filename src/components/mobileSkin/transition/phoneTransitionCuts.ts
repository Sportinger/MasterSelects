// Cuts of the phone timeline: two clips on the same track where the first ends exactly where the
// second starts. That is the editor's own adjacency rule for transitions
// (transitionOperations.ts areTransitionClipsAdjacent, 1e-4 s); a transition between clips that
// are not adjacent is pruned by the editor, so the phone offers transitions only at such cuts.
// Pure functions over the timeline store's clips: no second timeline model.

import type { TimelineClip } from '../../../types/timeline';
import type { TimelineTransition } from '../../../types/timelineCore';

/** Same epsilon as the editor's TRANSITION_JUNCTION_EPSILON. */
export const PHONE_CUT_EPSILON = 1e-4;

type CutClip = Pick<TimelineClip, 'id' | 'trackId' | 'startTime' | 'duration' | 'name'> & {
  transitionOut?: TimelineTransition;
  transitionIn?: TimelineTransition;
};

export interface PhoneCut {
  trackId: string;
  /** Outgoing clip (ends at the cut). */
  clipAId: string;
  /** Incoming clip (starts at the cut). */
  clipBId: string;
  /** Timeline time of the cut in seconds. */
  time: number;
  /** The transition at this cut, when the outgoing clip's transitionOut links to the incoming clip. */
  transition: TimelineTransition | null;
}

export interface PhoneCutTarget {
  trackId: string;
  clipAId: string;
  clipBId: string;
}

export function phoneCutKey(cut: Pick<PhoneCut, 'clipAId' | 'clipBId'>): string {
  return `${cut.clipAId}>${cut.clipBId}`;
}

function transitionBetween(a: CutClip, b: CutClip): TimelineTransition | null {
  const out = a.transitionOut;
  return out && out.linkedClipId === b.id ? out : null;
}

/** Every cut of one track, in time order. */
export function findPhoneCutsOnTrack(clips: readonly CutClip[], trackId: string): PhoneCut[] {
  const ordered = clips.filter((clip) => clip.trackId === trackId).toSorted((x, y) => x.startTime - y.startTime);
  const cuts: PhoneCut[] = [];
  for (let index = 0; index < ordered.length - 1; index++) {
    const a = ordered[index];
    const end = a.startTime + a.duration;
    // The next clip that starts at a's end (clips that overlap a are skipped, they form no cut).
    for (let next = index + 1; next < ordered.length; next++) {
      const b = ordered[next];
      if (b.startTime > end + PHONE_CUT_EPSILON) break;
      if (Math.abs(b.startTime - end) <= PHONE_CUT_EPSILON) {
        cuts.push({ trackId, clipAId: a.id, clipBId: b.id, time: end, transition: transitionBetween(a, b) });
        break;
      }
    }
  }
  return cuts;
}

/** Cuts of every track, grouped by track id. */
export function findPhoneCuts(clips: readonly CutClip[]): Map<string, PhoneCut[]> {
  const trackIds = new Set(clips.map((clip) => clip.trackId));
  const map = new Map<string, PhoneCut[]>();
  for (const trackId of trackIds) {
    const cuts = findPhoneCutsOnTrack(clips, trackId);
    if (cuts.length > 0) map.set(trackId, cuts);
  }
  return map;
}

/** Resolves a remembered target against the current clips (the cut may be gone after an edit). */
export function resolvePhoneCut(clips: readonly CutClip[], target: PhoneCutTarget | null): PhoneCut | null {
  if (!target) return null;
  const a = clips.find((clip) => clip.id === target.clipAId);
  if (!a) return null;
  return findPhoneCutsOnTrack(clips, a.trackId).find((cut) => cut.clipAId === a.id && cut.clipBId === target.clipBId) ?? null;
}

/**
 * The cut the Transition tool means for a selected clip: the cut after it, otherwise the cut
 * before it. Null when the clip touches no neighbour on its track.
 */
export function phoneCutForClip(clips: readonly CutClip[], clipId: string): PhoneCut | null {
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip) return null;
  const cuts = findPhoneCutsOnTrack(clips, clip.trackId);
  return cuts.find((cut) => cut.clipAId === clipId) ?? cuts.find((cut) => cut.clipBId === clipId) ?? null;
}
