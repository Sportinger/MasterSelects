// Tempo-driven grid geometry (issue #299, Packet 4).
//
// The lines BEHIND the clips, and the times they snap to, when a Bars+Beats
// ruler lane is enabled (§3.5 of the plan: an enabled bars ruler wins the grid).
// Unlike `createTimelineGridPlan` this cannot be expressed as a uniform
// interval — bar and beat spacing follows the tempo map and changes at every
// tempo/meter event — so the plan carries EXPLICIT line times and the canvas
// paints them individually.
//
// Pure and layer-neutral on purpose: the ruler (components), the body grid
// canvas (components) and both snapping paths (stores) all consume it, so it
// cannot live in any one of them. The pixel thresholds live here too, so the
// ruler ticks and the grid lines thin at exactly the same zoom levels and can
// never disagree on screen.

import type { TempoMap } from '../../types/timeline';
import { iterateBarBeatLines } from './TempoMap';

export type TimelineGridSubdivision = 'bar' | 'beat' | '1/8' | '1/16' | '1/8T' | '1/16T';

export const TIMELINE_GRID_SUBDIVISIONS: readonly TimelineGridSubdivision[] =
  ['bar', 'beat', '1/8', '1/16', '1/8T', '1/16T'];

export const TIMELINE_GRID_SUBDIVISION_LABELS: Record<TimelineGridSubdivision, string> = {
  bar: 'Bar',
  beat: 'Beat',
  '1/8': '1/8',
  '1/16': '1/16',
  '1/8T': '1/8 triplet',
  '1/16T': '1/16 triplet',
};

// Shared with the bars ruler lane so ticks and grid lines appear together.
export const MIN_BEAT_TICK_PX = 14;
export const MIN_BAR_TICK_PX = 4;
export const MIN_BAR_LABEL_PX = 36;
const MIN_SUBDIVISION_GRID_PX = 7;

const EPSILON = 1e-6;

function safeZoomOf(zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

// How many lines fall inside one metric beat. A beat is a 1/denominator note =
// 4/denominator quarters, and each subdivision is a fixed fraction of a quarter;
// triplets divide a quarter into 3 (1/8T) or 6 (1/16T).
const QUARTERS_PER_SUBDIVISION: Record<Exclude<TimelineGridSubdivision, 'bar' | 'beat'>, number> = {
  '1/8': 1 / 2,
  '1/16': 1 / 4,
  '1/8T': 1 / 3,
  '1/16T': 1 / 6,
};

export function subdivisionsPerBeat(
  subdivision: TimelineGridSubdivision,
  denominator: number,
): number {
  if (subdivision === 'bar' || subdivision === 'beat') return 1;
  const quartersPerBeat = 4 / Math.max(1, denominator);
  const perBeat = quartersPerBeat / QUARTERS_PER_SUBDIVISION[subdivision];
  // A subdivision coarser than the beat collapses to the beat itself.
  return Math.max(1, Math.round(perBeat));
}

// The meter in effect at `time` — subdivisions are relative to the beat, so they
// need the denominator of the segment they sit in.
function tempoDenominatorAt(tempoMap: TempoMap, time: number): number {
  let denominator = 4;
  for (const event of tempoMap.events) {
    if (event.time <= time + EPSILON) denominator = event.denominator;
    else break;
  }
  return denominator;
}

// The longest beat anywhere in the map — how far past the window we must look to
// find the beat line that closes the last visible one.
function longestBeatSeconds(tempoMap: TempoMap): number {
  let longest = 0;
  for (const event of tempoMap.events) {
    const beatSeconds = (60 / Math.max(1, event.bpm)) * (4 / Math.max(1, event.denominator));
    if (beatSeconds > longest) longest = beatSeconds;
  }
  return longest > 0 ? longest : 4;
}

export interface BarsGridPlanInput {
  tempoMap: TempoMap;
  zoom: number;
  startTime: number;
  endTime: number;
  subdivision?: TimelineGridSubdivision;
}

export interface BarsGridPlan {
  barTimes: number[];
  beatTimes: number[];
  subdivisionTimes: number[];
}

export function createBarsGridPlan(input: BarsGridPlanInput): BarsGridPlan {
  const empty: BarsGridPlan = { barTimes: [], beatTimes: [], subdivisionTimes: [] };
  const safeZoom = safeZoomOf(input.zoom);
  const from = Math.max(0, input.startTime);
  const to = input.endTime;
  if (to < from) return empty;

  const subdivision = input.subdivision ?? 'beat';

  // Overscan by one beat on BOTH sides: the last visible beat needs a closing
  // line to subdivide against, and the first one needs its opening line — a beat
  // straddling the left edge would otherwise lose all of its sub-beat lines.
  // The overscan lines themselves are filtered out when emitting.
  const overscan = longestBeatSeconds(input.tempoMap);
  const lines = iterateBarBeatLines(
    input.tempoMap,
    Math.max(0, from - overscan),
    to + overscan,
  );
  if (lines.length === 0) return empty;

  const beatPixels = lines.length >= 2
    ? Math.abs(lines[1].time - lines[0].time) * safeZoom
    : Number.POSITIVE_INFINITY;
  const barStarts = lines.filter(line => line.isBarStart);
  const barPixels = barStarts.length >= 2
    ? Math.abs(barStarts[1].time - barStarts[0].time) * safeZoom
    : beatPixels * 4;

  const showBeats = subdivision !== 'bar' && beatPixels >= MIN_BEAT_TICK_PX;
  const barStride = barPixels > 0 ? Math.max(1, Math.ceil(MIN_BAR_TICK_PX / barPixels)) : 1;

  const barTimes: number[] = [];
  const beatTimes: number[] = [];
  const subdivisionTimes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.time >= from && line.time <= to) {
      if (line.isBarStart) {
        if ((line.bar - 1) % barStride === 0) barTimes.push(line.time);
      } else if (showBeats && barStride === 1) {
        beatTimes.push(line.time);
      }
    }

    // Sub-beat lines are stepped between this line and the next, so they follow
    // the tempo map across a segment boundary instead of a global interval.
    if (!showBeats || barStride !== 1) continue;
    const next = lines[index + 1];
    if (!next) continue;

    const perBeat = subdivisionsPerBeat(subdivision, tempoDenominatorAt(input.tempoMap, line.time));
    if (perBeat <= 1) continue;

    const step = (next.time - line.time) / perBeat;
    if (step * safeZoom < MIN_SUBDIVISION_GRID_PX) continue;

    for (let part = 1; part < perBeat; part += 1) {
      const time = line.time + step * part;
      if (time < from || time > to) continue;
      subdivisionTimes.push(time);
    }
  }

  return { barTimes, beatTimes, subdivisionTimes };
}

/**
 * The bar line closest to `time`. Unlike the grid plan this ignores zoom: the
 * tempo editor snaps flags to musical positions, not to what happens to be drawn
 * at the current zoom.
 */
export function nearestBarTime(tempoMap: TempoMap, time: number): number {
  // A bar can be no longer than the slowest beat times the widest meter.
  const widestNumerator = tempoMap.events.reduce(
    (widest, event) => Math.max(widest, event.numerator),
    1,
  );
  const window = longestBeatSeconds(tempoMap) * widestNumerator;
  const lines = iterateBarBeatLines(
    tempoMap,
    Math.max(0, time - window),
    Math.max(0, time) + window,
  );

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line.isBarStart) continue;
    const distance = Math.abs(line.time - time);
    if (distance < bestDistance) {
      best = line.time;
      bestDistance = distance;
    }
  }
  return best ?? Math.max(0, time);
}

export interface BarsGridSnapTimesInput {
  tempoMap: TempoMap;
  zoom: number;
  /** Where the user is dragging; candidates are gathered around it. */
  centerTime: number;
  /** Half-width of the search window, seconds. */
  radiusSeconds: number;
  subdivision?: TimelineGridSubdivision;
}

/**
 * Snap candidates for a drag near `centerTime`. Returns exactly the lines the
 * grid DRAWS at this zoom — thinned identically — so you can only ever snap to
 * something you can see.
 */
export function collectBarsGridSnapTimes(input: BarsGridSnapTimesInput): number[] {
  const radius = Math.max(0, input.radiusSeconds);
  const plan = createBarsGridPlan({
    tempoMap: input.tempoMap,
    zoom: input.zoom,
    startTime: input.centerTime - radius,
    endTime: input.centerTime + radius,
    subdivision: input.subdivision,
  });
  return [...plan.barTimes, ...plan.beatTimes, ...plan.subdivisionTimes];
}
