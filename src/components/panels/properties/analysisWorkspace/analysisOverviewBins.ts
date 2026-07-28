import {
  ANALYSIS_OVERVIEW_LANE_KINDS,
  binAnalysisOverviewEvents,
  clampAnalysisOverviewScore,
  coalesceAnalysisOverviewEvents,
  coveredAnalysisOverviewPixelRange,
  normaliseAnalysisOverviewPixelWidth,
  type AnalysisOverviewCoalescedEvent,
  type AnalysisOverviewEvent,
  type AnalysisOverviewInput,
  type AnalysisOverviewLaneKind,
  type AnalysisOverviewLaneMap,
  type AnalysisOverviewPixelBin,
} from './analysisOverviewTypes';

export {
  binAnalysisOverviewEvents,
  coalesceAnalysisOverviewEvents,
  findAnalysisOverviewEventAtTime,
} from './analysisOverviewTypes';

/** Continuous 0..1 metrics drawn as overlaid envelopes in one shared plot. */
export type AnalysisOverviewEnvelopeLane = 'motion' | 'focus' | 'quality';
/** Interval signals drawn as labelled coverage rows under the envelope plot. */
export type AnalysisOverviewPresenceLane = 'speech' | 'people' | 'audio' | 'markers' | 'text';

const ENVELOPE_LANES: readonly AnalysisOverviewEnvelopeLane[] = ['motion', 'focus', 'quality'];
const PRESENCE_LANES: readonly AnalysisOverviewPresenceLane[] = ['speech', 'people', 'audio', 'markers', 'text'];

/** Score levels for the min/max sweep; sub-pixel precision at every plot height. */
const SCORE_LEVELS = 255;

export interface AnalysisOverviewSeriesBin {
  index: number;
  count: number;
  /** Exact mean of scored covering events; null where nothing is sampled. */
  average: number | null;
  /** Min/max are quantised to 1/255 so the sweep stays O(events + pixels). */
  min: number | null;
  max: number | null;
}

function isUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/**
 * Per-pixel count/avg/min/max for a scalar lane. Counts and averages use delta
 * accumulation; extremes use quantised level counts with monotone pointers, so
 * broad intervals never cost event-count × viewport-width work.
 */
export function binAnalysisOverviewSeries(
  events: readonly AnalysisOverviewEvent[],
  duration: number,
  pixelWidth: number,
  startTime = 0,
): readonly AnalysisOverviewSeriesBin[] {
  const width = normaliseAnalysisOverviewPixelWidth(pixelWidth);
  if (!isUsableDuration(duration)) {
    return Array.from({ length: width }, (_, index) => ({
      index, count: 0, average: null, min: null, max: null,
    }));
  }
  const rangeStart = Number.isFinite(startTime) ? startTime : 0;
  const countDelta = new Int32Array(width + 1);
  const scoreDelta = new Float64Array(width + 1);
  const scoredDelta = new Int32Array(width + 1);
  const added: Array<number[] | undefined> = new Array<number[] | undefined>(width + 1);
  const removed: Array<number[] | undefined> = new Array<number[] | undefined>(width + 1);

  for (const event of events) {
    if (!Number.isFinite(event.start) || (event.end !== undefined && !Number.isFinite(event.end))) {
      continue;
    }
    const pixels = coveredAnalysisOverviewPixelRange(event, rangeStart, duration, width);
    if (!pixels) continue;
    countDelta[pixels.startPixel] += 1;
    countDelta[pixels.endPixel + 1] -= 1;
    if (event.score === undefined || !Number.isFinite(event.score)) continue;
    const score = clampAnalysisOverviewScore(event.score);
    scoreDelta[pixels.startPixel] += score;
    scoreDelta[pixels.endPixel + 1] -= score;
    scoredDelta[pixels.startPixel] += 1;
    scoredDelta[pixels.endPixel + 1] -= 1;
    const level = Math.round(score * SCORE_LEVELS);
    (added[pixels.startPixel] ??= []).push(level);
    (removed[pixels.endPixel + 1] ??= []).push(level);
  }

  const levels = new Int32Array(SCORE_LEVELS + 1);
  let activeCount = 0;
  let activeScore = 0;
  let activeScored = 0;
  let lowest = SCORE_LEVELS;
  let highest = 0;
  return Array.from({ length: width }, (_, index) => {
    activeCount += countDelta[index] ?? 0;
    activeScore += scoreDelta[index] ?? 0;
    activeScored += scoredDelta[index] ?? 0;
    for (const level of removed[index] ?? []) levels[level] -= 1;
    for (const level of added[index] ?? []) {
      levels[level] += 1;
      if (level < lowest) lowest = level;
      if (level > highest) highest = level;
    }
    if (activeScored <= 0) {
      lowest = SCORE_LEVELS;
      highest = 0;
      return { index, count: activeCount, average: null, min: null, max: null };
    }
    while (levels[lowest] === 0) lowest += 1;
    while (levels[highest] === 0) highest -= 1;
    return {
      index,
      count: activeCount,
      average: activeScore / activeScored,
      min: lowest / SCORE_LEVELS,
      max: highest / SCORE_LEVELS,
    };
  });
}

export interface AnalysisOverviewBandRun {
  startPixel: number;
  endPixel: number;
  peakCount: number;
  meanScore: number | null;
}

/** Merges covered pixels into contiguous runs for rounded coverage bars. */
export function buildAnalysisOverviewBandRuns(
  bins: readonly AnalysisOverviewPixelBin[],
): readonly AnalysisOverviewBandRun[] {
  const runs: AnalysisOverviewBandRun[] = [];
  let run: AnalysisOverviewBandRun | null = null;
  let scoreSum = 0;
  let scored = 0;
  const finish = () => {
    if (!run) return;
    runs.push({ ...run, meanScore: scored > 0 ? scoreSum / scored : null });
    run = null;
    scoreSum = 0;
    scored = 0;
  };
  for (const bin of bins) {
    if (bin.eventCount <= 0) {
      finish();
      continue;
    }
    if (!run) {
      run = { startPixel: bin.index, endPixel: bin.index, peakCount: 0, meanScore: null };
    }
    run.endPixel = bin.index;
    run.peakCount = Math.max(run.peakCount, bin.eventCount);
    if (bin.averageScore !== null) {
      scoreSum += bin.averageScore;
      scored += 1;
    }
  }
  finish();
  return runs;
}

export interface AnalysisOverviewTick {
  time: number;
  fraction: number;
}

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Round-second interior ticks aligned to absolute source time, ~one per 72px. */
export function computeAnalysisOverviewTicks(
  startTime: number,
  duration: number,
  pixelWidth: number,
  targetSpacingPx = 72,
): readonly AnalysisOverviewTick[] {
  if (!isUsableDuration(duration) || !Number.isFinite(pixelWidth) || pixelWidth <= 0) return [];
  const start = Number.isFinite(startTime) ? startTime : 0;
  const maxTicks = Math.max(1, Math.floor(pixelWidth / Math.max(24, targetSpacingPx)));
  const rawStep = duration / maxTicks;
  const step = TICK_STEPS.find((candidate) => candidate >= rawStep)
    ?? Math.ceil(rawStep / 3600) * 3600;
  const ticks: AnalysisOverviewTick[] = [];
  for (let time = Math.ceil(start / step) * step; time < start + duration; time += step) {
    const fraction = (time - start) / duration;
    if (fraction > 0 && fraction < 1) ticks.push({ time, fraction });
  }
  return ticks;
}

export interface AnalysisOverviewLayoutRow {
  top: number;
  height: number;
}

export interface AnalysisOverviewMetricsRow extends AnalysisOverviewLayoutRow {
  lanes: readonly AnalysisOverviewEnvelopeLane[];
}

export interface AnalysisOverviewPresenceRow extends AnalysisOverviewLayoutRow {
  lane: AnalysisOverviewPresenceLane;
}

export interface AnalysisOverviewLayout {
  height: number;
  compact: boolean;
  scenes?: AnalysisOverviewLayoutRow;
  cuts?: AnalysisOverviewLayoutRow;
  metrics?: AnalysisOverviewMetricsRow;
  presence: readonly AnalysisOverviewPresenceRow[];
  present: readonly AnalysisOverviewLaneKind[];
  missing: readonly AnalysisOverviewLaneKind[];
}

export interface AnalysisOverviewLayoutOptions {
  compact?: boolean;
  /** Target graph height; the flexible metrics plot absorbs the difference. */
  graphHeight?: number;
}

/**
 * Stacks only lanes that actually carry events: structure (scenes + cuts),
 * the shared envelope plot, then presence rows. Empty lanes are reported in
 * `missing` so the component can state their absence instead of faking rows.
 */
export function buildAnalysisOverviewLayout(
  lanes: AnalysisOverviewLaneMap,
  options: AnalysisOverviewLayoutOptions = {},
): AnalysisOverviewLayout {
  const compact = options.compact === true;
  const hasEvents = (lane: AnalysisOverviewLaneKind): boolean => (lanes[lane]?.length ?? 0) > 0;
  const present = ANALYSIS_OVERVIEW_LANE_KINDS.filter(hasEvents);
  const missing = ANALYSIS_OVERVIEW_LANE_KINDS.filter((lane) => !hasEvents(lane));
  const envelopeLanes = ENVELOPE_LANES.filter(hasEvents);
  const presenceLanes = PRESENCE_LANES.filter(hasEvents);

  const sceneHeight = compact ? 16 : 20;
  const cutHeight = compact ? 9 : 11;
  const defaultMetricsHeight = compact ? 44 : 62;
  const rowHeight = (lane: AnalysisOverviewPresenceLane): number => (
    lane === 'audio' ? (compact ? 14 : 18) : (compact ? 13 : 15)
  );
  const groupGap = compact ? 5 : 7;
  const rowGap = 2;

  const structureHeight = (hasEvents('scenes') ? sceneHeight : 0)
    + (hasEvents('cuts') ? cutHeight : 0);
  const presenceHeight = presenceLanes.reduce(
    (total, lane, index) => total + rowHeight(lane) + (index > 0 ? rowGap : 0),
    0,
  );
  const groupCount = [structureHeight > 0, envelopeLanes.length > 0, presenceLanes.length > 0]
    .filter(Boolean).length;
  const gapHeight = Math.max(0, groupCount - 1) * groupGap;
  const naturalHeight = structureHeight
    + (envelopeLanes.length > 0 ? defaultMetricsHeight : 0)
    + presenceHeight
    + gapHeight;
  const graphHeight = options.graphHeight;
  const metricsHeight = envelopeLanes.length > 0
    && graphHeight !== undefined && Number.isFinite(graphHeight)
    ? Math.max(32, defaultMetricsHeight + Math.floor(graphHeight) - naturalHeight)
    : defaultMetricsHeight;

  let top = 0;
  const layout: {
    scenes?: AnalysisOverviewLayoutRow;
    cuts?: AnalysisOverviewLayoutRow;
    metrics?: AnalysisOverviewMetricsRow;
  } = {};
  if (hasEvents('scenes')) {
    layout.scenes = { top, height: sceneHeight };
    top += sceneHeight;
  }
  if (hasEvents('cuts')) {
    layout.cuts = { top, height: cutHeight };
    top += cutHeight;
  }
  if (structureHeight > 0 && (envelopeLanes.length > 0 || presenceLanes.length > 0)) {
    top += groupGap;
  }
  if (envelopeLanes.length > 0) {
    layout.metrics = { top, height: metricsHeight, lanes: envelopeLanes };
    top += metricsHeight;
    if (presenceLanes.length > 0) top += groupGap;
  }
  const presence = presenceLanes.map((lane, index) => {
    if (index > 0) top += rowGap;
    const row = { lane, top, height: rowHeight(lane) };
    top += row.height;
    return row;
  });

  return {
    ...layout,
    height: Math.max(24, top),
    compact,
    presence,
    present,
    missing,
  };
}

export interface AnalysisOverviewRenderModel {
  width: number;
  layout: AnalysisOverviewLayout;
  ticks: readonly AnalysisOverviewTick[];
  scenes: readonly AnalysisOverviewCoalescedEvent[];
  cuts: readonly AnalysisOverviewPixelBin[];
  envelopes: ReadonlyMap<AnalysisOverviewEnvelopeLane, readonly AnalysisOverviewSeriesBin[]>;
  bands: ReadonlyMap<AnalysisOverviewPresenceLane, readonly AnalysisOverviewBandRun[]>;
  audio: readonly AnalysisOverviewSeriesBin[] | null;
  markers: readonly AnalysisOverviewPixelBin[];
}

/** One derived, viewport-width-bounded model shared by canvas and DOM overlays. */
export function buildAnalysisOverviewRenderModel(
  input: AnalysisOverviewInput,
  pixelWidth: number,
  options: AnalysisOverviewLayoutOptions = {},
): AnalysisOverviewRenderModel {
  const width = normaliseAnalysisOverviewPixelWidth(pixelWidth);
  const startTime = Number.isFinite(input.startTime ?? 0) ? input.startTime ?? 0 : 0;
  const duration = isUsableDuration(input.duration) ? input.duration : 0;
  const layout = buildAnalysisOverviewLayout(input.lanes, options);
  const laneEvents = (lane: AnalysisOverviewLaneKind): readonly AnalysisOverviewEvent[] => (
    input.lanes[lane] ?? []
  );

  const envelopes = new Map<AnalysisOverviewEnvelopeLane, readonly AnalysisOverviewSeriesBin[]>();
  for (const lane of layout.metrics?.lanes ?? []) {
    envelopes.set(lane, binAnalysisOverviewSeries(laneEvents(lane), duration, width, startTime));
  }
  const bands = new Map<AnalysisOverviewPresenceLane, readonly AnalysisOverviewBandRun[]>();
  let audio: readonly AnalysisOverviewSeriesBin[] | null = null;
  let markers: readonly AnalysisOverviewPixelBin[] = [];
  for (const row of layout.presence) {
    if (row.lane === 'audio') {
      audio = binAnalysisOverviewSeries(laneEvents('audio'), duration, width, startTime);
      continue;
    }
    if (row.lane === 'markers') {
      markers = binAnalysisOverviewEvents(laneEvents('markers'), duration, width, startTime);
      continue;
    }
    bands.set(row.lane, buildAnalysisOverviewBandRuns(
      binAnalysisOverviewEvents(laneEvents(row.lane), duration, width, startTime),
    ));
  }

  return {
    width,
    layout,
    ticks: computeAnalysisOverviewTicks(startTime, duration, width),
    scenes: layout.scenes
      ? coalesceAnalysisOverviewEvents(laneEvents('scenes'), duration, width, startTime)
      : [],
    cuts: layout.cuts
      ? binAnalysisOverviewEvents(laneEvents('cuts'), duration, width, startTime)
      : [],
    envelopes,
    bands,
    audio,
    markers,
  };
}
