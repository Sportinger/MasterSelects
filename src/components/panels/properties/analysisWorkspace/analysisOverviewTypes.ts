/**
 * Serializable, runtime-handle-free facts consumed by the compact overview.
 * Times are source times. `duration` is the visible span, not an absolute end.
 */
export const ANALYSIS_OVERVIEW_LANE_KINDS = [
  'scenes',
  'cuts',
  'speech',
  'people',
  'motion',
  'focus',
  'quality',
  'audio',
  'markers',
  'text',
] as const;

export type AnalysisOverviewLaneKind = (typeof ANALYSIS_OVERVIEW_LANE_KINDS)[number];

export interface AnalysisOverviewEvent {
  id: string;
  start: number;
  /** Missing (or equal-to-start) end means a point event. Ranges are half-open. */
  end?: number;
  label?: string;
  /** Optional normalized metric. Out-of-range values are clamped for display. */
  score?: number;
}

export type AnalysisOverviewLaneMap = Partial<Record<
  AnalysisOverviewLaneKind,
  readonly AnalysisOverviewEvent[]
>>;

export interface AnalysisOverviewInput {
  /** First source second represented by the overview. Defaults to zero. */
  startTime?: number;
  /** Length of the represented source range in seconds. */
  duration: number;
  lanes: AnalysisOverviewLaneMap;
}

export interface AnalysisOverviewPixelBin {
  index: number;
  eventCount: number;
  averageScore: number | null;
}

export interface AnalysisOverviewCoalescedEvent {
  /** Inclusive pixel bounds occupied by the interactive scene overlay. */
  startPixel: number;
  endPixel: number;
  eventCount: number;
  start: number;
  end: number;
  label: string | undefined;
  sourceEvent: AnalysisOverviewEvent;
  sourceEventIds: string[];
}

export interface AnalysisOverviewCanvasSize {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  devicePixelRatio: number;
}

export const ANALYSIS_OVERVIEW_MAX_BACKING_SIZE = 8192;

function isUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Clamps a viewport width to at least one and at most one bin per backing pixel. */
export function normaliseAnalysisOverviewPixelWidth(width: number): number {
  if (!Number.isFinite(width)) return 1;
  return Math.min(ANALYSIS_OVERVIEW_MAX_BACKING_SIZE, Math.max(1, Math.floor(width)));
}

function normaliseStartTime(startTime: number): number {
  return Number.isFinite(startTime) ? startTime : 0;
}

export function clampAnalysisOverviewScore(score: number): number {
  return Math.min(1, Math.max(0, score));
}

function pointPixel(
  time: number,
  startTime: number,
  duration: number,
  pixelWidth: number,
): number {
  const ratio = (time - startTime) / duration;
  return Math.min(pixelWidth - 1, Math.max(0, Math.floor(ratio * pixelWidth)));
}

/** Projects one event onto covered pixels; null when it misses the window. */
export function coveredAnalysisOverviewPixelRange(
  event: AnalysisOverviewEvent,
  startTime: number,
  duration: number,
  width: number,
): { startPixel: number; endPixel: number; start: number; end: number } | null {
  const windowEnd = startTime + duration;
  const rawEnd = event.end ?? event.start;
  const rangeStart = Math.min(event.start, rawEnd);
  const rangeEnd = Math.max(event.start, rawEnd);
  const isPoint = rangeStart === rangeEnd;

  if (isPoint) {
    if (rangeStart < startTime || rangeStart >= windowEnd) return null;
    const pixel = pointPixel(rangeStart, startTime, duration, width);
    return { startPixel: pixel, endPixel: pixel, start: rangeStart, end: rangeStart };
  }

  const clippedStart = Math.max(startTime, rangeStart);
  const clippedEnd = Math.min(windowEnd, rangeEnd);
  if (clippedStart >= clippedEnd) return null;

  const startPixel = pointPixel(clippedStart, startTime, duration, width);
  // A half-open end covers the pixel immediately before its boundary.
  const endRatio = ((clippedEnd - startTime) / duration) * width;
  const endPixel = Math.min(width - 1, Math.max(startPixel, Math.ceil(endRatio) - 1));
  return { startPixel, endPixel, start: clippedStart, end: clippedEnd };
}

/**
 * Aggregates ranges in O(events + pixels). Delta accumulation prevents broad
 * intervals from turning into event-count × viewport-width work.
 */
export function binAnalysisOverviewEvents(
  events: readonly AnalysisOverviewEvent[],
  duration: number,
  pixelWidth: number,
  startTime = 0,
): readonly AnalysisOverviewPixelBin[] {
  const width = normaliseAnalysisOverviewPixelWidth(pixelWidth);
  const counts = new Int32Array(width + 1);
  const scoreSums = new Float64Array(width + 1);
  const scoredCounts = new Int32Array(width + 1);
  const rangeStart = normaliseStartTime(startTime);

  if (!isUsableDuration(duration)) {
    return Array.from({ length: width }, (_, index) => ({
      index,
      eventCount: 0,
      averageScore: null,
    }));
  }

  for (const event of events) {
    if (!Number.isFinite(event.start) || (event.end !== undefined && !Number.isFinite(event.end))) {
      continue;
    }
    const pixels = coveredAnalysisOverviewPixelRange(event, rangeStart, duration, width);
    if (!pixels) continue;
    counts[pixels.startPixel] += 1;
    counts[pixels.endPixel + 1] -= 1;

    if (event.score !== undefined && Number.isFinite(event.score)) {
      const score = clampAnalysisOverviewScore(event.score);
      scoreSums[pixels.startPixel] += score;
      scoreSums[pixels.endPixel + 1] -= score;
      scoredCounts[pixels.startPixel] += 1;
      scoredCounts[pixels.endPixel + 1] -= 1;
    }
  }

  let activeCount = 0;
  let activeScoreSum = 0;
  let activeScoredCount = 0;
  return Array.from({ length: width }, (_, index) => {
    activeCount += counts[index] ?? 0;
    activeScoreSum += scoreSums[index] ?? 0;
    activeScoredCount += scoredCounts[index] ?? 0;
    return {
      index,
      eventCount: activeCount,
      averageScore: activeScoredCount > 0 ? activeScoreSum / activeScoredCount : null,
    };
  });
}

/** Bounds the scene overlay to one interactive item per viewport pixel. */
export function coalesceAnalysisOverviewEvents(
  events: readonly AnalysisOverviewEvent[],
  duration: number,
  pixelWidth: number,
  startTime = 0,
): readonly AnalysisOverviewCoalescedEvent[] {
  if (!isUsableDuration(duration)) return [];
  const width = normaliseAnalysisOverviewPixelWidth(pixelWidth);
  const rangeStart = normaliseStartTime(startTime);
  const perPixel = new Map<number, AnalysisOverviewCoalescedEvent>();

  for (const event of events) {
    if (!Number.isFinite(event.start) || (event.end !== undefined && !Number.isFinite(event.end))) {
      continue;
    }
    const pixels = coveredAnalysisOverviewPixelRange(event, rangeStart, duration, width);
    if (!pixels) continue;
    const existing = perPixel.get(pixels.startPixel);
    if (existing) {
      existing.eventCount += 1;
      existing.end = Math.max(existing.end, pixels.end);
      existing.endPixel = Math.max(existing.endPixel, pixels.endPixel);
      existing.sourceEventIds.push(event.id);
      continue;
    }
    perPixel.set(pixels.startPixel, {
      startPixel: pixels.startPixel,
      endPixel: pixels.endPixel,
      eventCount: 1,
      start: pixels.start,
      end: pixels.end,
      label: event.label,
      sourceEvent: event,
      sourceEventIds: [event.id],
    });
  }

  return Array.from(perPixel.values()).toSorted((a, b) => a.startPixel - b.startPixel);
}

/** Keeps both backing-store dimensions below the Mesa-safe ceiling. */
export function getAnalysisOverviewCanvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxBackingDimension = ANALYSIS_OVERVIEW_MAX_BACKING_SIZE,
): AnalysisOverviewCanvasSize {
  const width = Math.max(1, Math.floor(Number.isFinite(cssWidth) ? cssWidth : 1));
  const height = Math.max(1, Math.floor(Number.isFinite(cssHeight) ? cssHeight : 1));
  const requestedDpr = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  const maxDimension = Math.max(1, Math.floor(maxBackingDimension));
  const safeDpr = Math.max(
    1 / Math.max(width, height),
    Math.min(requestedDpr, maxDimension / width, maxDimension / height),
  );

  return {
    cssWidth: width,
    cssHeight: height,
    backingWidth: Math.min(maxDimension, Math.max(1, Math.floor(width * safeDpr))),
    backingHeight: Math.min(maxDimension, Math.max(1, Math.floor(height * safeDpr))),
    devicePixelRatio: safeDpr,
  };
}

/**
 * Finds a range using half-open semantics, or a point within `pointTolerance`.
 * Point events are evaluated first so cut markers win over broad intervals.
 */
export function findAnalysisOverviewEventAtTime(
  events: readonly AnalysisOverviewEvent[],
  time: number,
  pointTolerance = 0,
): AnalysisOverviewEvent | undefined {
  if (!Number.isFinite(time)) return undefined;
  const tolerance = Math.max(0, Number.isFinite(pointTolerance) ? pointTolerance : 0);
  const point = events.find((event) => {
    const end = event.end ?? event.start;
    return Number.isFinite(event.start) && Number.isFinite(end)
      && event.start === end
      && Math.abs(time - event.start) <= tolerance;
  });
  if (point) return point;

  return events.find((event) => {
    const end = event.end ?? event.start;
    if (!Number.isFinite(event.start) || !Number.isFinite(end) || event.start === end) return false;
    const start = Math.min(event.start, end);
    const rangeEnd = Math.max(event.start, end);
    return time >= start && time < rangeEnd;
  });
}
