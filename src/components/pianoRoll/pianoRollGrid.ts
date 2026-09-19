// Piano-roll ruler + grid adapter (issue #249, Phase 1).
//
// The piano-roll x-axis is CLIP-LOCAL content time (pixel 0 = the clip window's
// left edge). Bars and timecodes, however, are GLOBAL: they must read identical
// to the main timeline at the same musical position. This pure adapter is the
// bridge. It generates ruler ticks and gridlines over the clip's ABSOLUTE-time
// window `[clipStartTime, clipStartTime + clipDuration]` using the very same pure
// generators the timeline uses (`createBarsGridPlan`, `createBarsLaneTicks`,
// `createLinearLaneTicks`), then maps each absolute time back to a clip-local
// pixel with `(time - clipStartTime) * pxPerSec`. The labels match the timeline
// by construction; an independent piano-roll zoom only changes spacing.
//
// Pure (time-domain only, no runtime handles). The bar/beat/sub line TIMES come
// from `createBarsGridPlan` — the same generator the main timeline's body grid
// uses — so a subdivision means the identical thing on both surfaces and both
// thin at the same zoom levels. This adapter only maps those times to pixels.

import type { TempoMap } from '../../types/timeline';
import {
  createBarsGridPlan,
  type TimelineGridSubdivision,
} from '../../timeline/tempo/barsGrid';
import {
  createBarsLaneTicks,
  createLinearLaneTicks,
  formatTimelineClock,
  type RulerTick,
} from '../timeline/utils/timelineGrid';

/** A single gridline, positioned in clip-local pixels and tagged with its
 *  absolute timeline time (so callers can correlate with the playhead). */
export interface GridLine {
  /** Clip-local pixel X — 0 is the clip window's left edge. */
  pixelX: number;
  /** Absolute timeline time in seconds. */
  time: number;
}

export interface PianoRollGrid {
  /** Bar starts — strong tier. */
  barLines: GridLine[];
  /** Beat lines (non-bar-start) — medium tier. */
  beatLines: GridLine[];
  /** Sub-beat lines for the chosen subdivision — faint tier (empty for
   *  'bar'/'beat', and whenever the zoom is too tight to draw them). */
  subLines: GridLine[];
  /** Ruler ticks, with ABSOLUTE-time `.time`; convert with `(time - clipStartTime) * pxPerSec`. */
  rulerTicks: { bars: RulerTick[]; time: RulerTick[] };
}

export interface BuildPianoRollGridInput {
  tempoMap: TempoMap;
  /** Absolute timeline time of the clip window's left edge (= pixel 0). */
  clipStartTime: number;
  /** Visible/playable window length in seconds. */
  clipDuration: number;
  /** Piano-roll horizontal zoom — pixels per second. Independent of the timeline. */
  pxPerSec: number;
  /** Left edge of the visible pixel window, clip-local (0 = clip start). */
  visibleStartPx: number;
  /** Width of the visible pixel window in pixels. */
  visibleWidthPx: number;
  /** Musical division the grid draws and snaps to. Defaults to 'beat'. */
  subdivision?: TimelineGridSubdivision;
  /**
   * Seconds of "outside the clip" margin shown on each side (#249 clip-resize).
   * When > 0, bars/beats/ticks are generated `marginSec` beyond each window edge
   * so the grid keeps going under the dimmed margins. Defaults to 0 (window only).
   */
  marginSec?: number;
}

function sanitizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Build the piano-roll Bars+Time ruler ticks and bar/beat/sub gridlines for the
 * currently visible window. See module header for the clip-local ↔ absolute
 * mapping that keeps labels identical to the main timeline.
 */
export function buildPianoRollGrid({
  tempoMap,
  clipStartTime,
  clipDuration,
  pxPerSec,
  visibleStartPx,
  visibleWidthPx,
  subdivision = 'beat',
  marginSec = 0,
}: BuildPianoRollGridInput): PianoRollGrid {
  const safePxPerSec = sanitizePositive(pxPerSec, 1);
  const safeMargin = Math.max(0, marginSec);

  // Absolute end of the clip window — the duration the timeline generators clamp
  // to. MUST be the absolute end (clipStartTime + clipDuration), not the clip-local
  // length, or every tick past the clip length is silently dropped (plan §5).
  const clipEndAbs = clipStartTime + Math.max(0, clipDuration);
  // Generation span extends `safeMargin` past each window edge so the grid keeps
  // going under the dimmed margins (#249). The generators themselves clamp the
  // low end to absolute time 0, so the part of the left margin before t=0 stays
  // blank (no musical time there) — that's correct, not a bug.
  const rangeStartAbs = clipStartTime - safeMargin;
  const rangeEndAbs = clipEndAbs + safeMargin;

  // Visible pixel window → absolute-time window, clamped to the (margin-widened) span.
  const fromAbs = Math.max(rangeStartAbs, clipStartTime + visibleStartPx / safePxPerSec);
  const toAbs = Math.min(rangeEndAbs, clipStartTime + (visibleStartPx + visibleWidthPx) / safePxPerSec);

  const toPixel = (time: number): number => (time - clipStartTime) * safePxPerSec;

  const barLines: GridLine[] = [];
  const beatLines: GridLine[] = [];
  const subLines: GridLine[] = [];

  if (toAbs >= fromAbs) {
    // Bar/beat/sub lines never exist before absolute time 0 (the plan clamps
    // there itself). Sub-beat lines step per tempo segment, so they stay correct
    // across a tempo or meter change instead of drifting off a global interval.
    const plan = createBarsGridPlan({
      tempoMap,
      zoom: safePxPerSec,
      startTime: fromAbs,
      endTime: toAbs,
      subdivision,
    });
    const toLine = (time: number): GridLine => ({ pixelX: toPixel(time), time });
    for (const time of plan.barTimes) barLines.push(toLine(time));
    for (const time of plan.beatTimes) beatLines.push(toLine(time));
    for (const time of plan.subdivisionTimes) subLines.push(toLine(time));
  }

  const rulerTicks = {
    bars: createBarsLaneTicks({
      tempoMap,
      zoom: safePxPerSec,
      startTime: fromAbs,
      endTime: toAbs,
      duration: rangeEndAbs,
    }),
    time: createLinearLaneTicks({
      format: 'time',
      zoom: safePxPerSec,
      startTime: fromAbs,
      endTime: toAbs,
      duration: rangeEndAbs,
      formatTime: formatTimelineClock,
    }),
  };

  return { barLines, beatLines, subLines, rulerTicks };
}
