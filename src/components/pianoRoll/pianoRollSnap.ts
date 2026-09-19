// Piano-roll grid snapping.
//
// Notes live in CONTENT time; the tempo grid lives in ABSOLUTE timeline time.
// This module owns the round trip between the two so every drag path snaps
// through exactly one place:
//
//   content ──(− inPoint)──▶ clip-local ──(+ clipStartTime)──▶ absolute
//
// Candidates come from `collectBarsGridSnapTimes` — the SAME generator the body
// grid draws from, thinned by the same pixel thresholds — so you can only ever
// snap to a line you can actually see, exactly like the main timeline
// (docs/Features/Tempo-And-Metronome.md §"Grid and snapping").
//
// Unlike the timeline, snapping here is a QUANTIZER, not a magnet: with the
// toggle on, a dragged time always lands on the nearest line. A piano roll is a
// notation surface — "1/16" means notes sit on 1/16 boundaries — whereas the
// timeline's pixel-threshold magnet exists to leave free placement between
// clips intact. Alt bypasses; Shift force-enables while the toggle is off.
//
// Pure (time-domain only, no runtime handles).

import type { TempoMap } from '../../types/timeline';
import {
  barsGridSnapRadiusSeconds,
  collectBarsGridSnapTimes,
  type TimelineGridSubdivision,
} from '../../timeline/tempo/barsGrid';

const EPSILON = 1e-6;

export interface PianoRollSnapContext {
  tempoMap: TempoMap;
  /** Absolute timeline time of the clip window's left edge (grid pixel 0). */
  clipStartTime: number;
  /** Content time of that same left edge (`clip.inPoint`; may be negative). */
  inPoint: number;
  /** Piano-roll horizontal zoom — decides which lines exist at this zoom. */
  pxPerSec: number;
  subdivision: TimelineGridSubdivision;
}

function contentToAbsolute(context: PianoRollSnapContext, contentTime: number): number {
  return context.clipStartTime + (contentTime - context.inPoint);
}

function absoluteToContent(context: PianoRollSnapContext, absoluteTime: number): number {
  return context.inPoint + (absoluteTime - context.clipStartTime);
}

function candidatesAround(context: PianoRollSnapContext, absoluteTime: number): number[] {
  return collectBarsGridSnapTimes({
    tempoMap: context.tempoMap,
    zoom: context.pxPerSec,
    centerTime: absoluteTime,
    radiusSeconds: barsGridSnapRadiusSeconds(context.tempoMap),
    subdivision: context.subdivision,
  });
}

/**
 * The nearest grid line to `contentTime`, in content time. Returns the input
 * UNCHANGED when the current zoom draws no lines to snap to — at that point
 * there is nothing visible to quantize against, and silently jumping the note to
 * a line the user cannot see would be worse than leaving it free.
 */
export function snapContentTime(context: PianoRollSnapContext, contentTime: number): number {
  const absolute = contentToAbsolute(context, contentTime);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidatesAround(context, absolute)) {
    const distance = Math.abs(candidate - absolute);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best === null ? contentTime : absoluteToContent(context, best);
}

/**
 * Spacing of the grid around `contentTime` — the smallest gap between the lines
 * near it. Drives the length of a click-drawn note and the minimum length of a
 * snapped drag, so a 2 px twitch produces one grid unit instead of a sliver.
 * Null when the current zoom draws fewer than two lines.
 */
export function gridStepSeconds(context: PianoRollSnapContext, contentTime: number): number | null {
  const absolute = contentToAbsolute(context, contentTime);
  // collectBarsGridSnapTimes concatenates the bar/beat/sub tiers, so the times
  // arrive interleaved — sort before measuring gaps.
  const times = candidatesAround(context, absolute).toSorted((a, b) => a - b);
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index] - times[index - 1];
    if (gap > EPSILON && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : null;
}

/**
 * Snap the END of a note (create-drag, resize) and return the resulting
 * duration, never shorter than one grid unit. `minDuration` is the un-snapped
 * floor used when the zoom draws no grid.
 */
export function snapNoteDuration(
  context: PianoRollSnapContext,
  start: number,
  end: number,
  minDuration: number,
): number {
  const snappedEnd = snapContentTime(context, end);
  const step = gridStepSeconds(context, start);
  const floor = step ?? minDuration;
  return Math.max(floor, snappedEnd - start);
}

/**
 * Whether this pointer event should snap. Mirrors the timeline's modifiers:
 * Alt always bypasses, Shift temporarily enables while the toggle is off.
 */
export function shouldSnap(
  enabled: boolean,
  event: Pick<MouseEvent, 'altKey' | 'shiftKey'>,
): boolean {
  if (event.altKey) return false;
  return enabled || event.shiftKey;
}
