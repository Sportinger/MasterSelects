/**
 * Which decoded source frame shows at a requested source time.
 *
 * Three rules, chosen per media by the caller (presentationFrameRule()):
 *
 * 1. Grid (constant-rate media, also slightly jittery phone footage). A
 *    PresentationGrid recovers the nominal frame boundaries from the samples;
 *    the request is mapped to its nominal frame, floor((t - origin + 1 us) / d),
 *    and the frame containing the middle of that nominal frame is shown. That
 *    lookup is far from every stored boundary, so neither container rounding nor
 *    per-frame jitter can shift it:
 *    - Coarse timescales: an MP4 stores each timestamp in its timescale. With
 *      1/1000 or 1/600, a 30 fps frame k starts at round(k/30 s) on that tick,
 *      up to half a tick (500 us) away from k/30, so the stored boundary lies on
 *      either side of a request at or 10 us before k/30. No slack tells those apart.
 *    - Jitter: Android MediaMuxer writes 30 fps at 1/90000 or 1/1e6 with each
 *      frame 50-4000 us off k/30. derivePresentationGrid accepts such a grid while
 *      every timestamp stays within d/4 of it and they spread over at most d/4.
 *    A forward request k/fps lands in nominal frame k; a reversed clip's request
 *    10 us before that boundary (videoFrameSourceTime() subtracts
 *    BACKWARD_FRAME_EPSILON) lands in frame k - 1.
 *
 * 2. Nearest (no grid: real VFR media). The sample whose timestamp is nearest to
 *    the request wins, the proven forward behaviour from before the grid existed.
 *    Exception: when that nearest sample starts just after the request,
 *    slack + half a tick < ts - t <= REVERSE_REQUEST_WINDOW_US
 *    (2 x BACKWARD_FRAME_EPSILON = 20 us), the caller asked for "just before this
 *    boundary" (a reversed clip), and the previous sample is shown. A smaller
 *    lead may be the container's rounding of an exact forward hit. Limits, both
 *    inherent without a grid: a forward request at a frame that starts later
 *    than that rounding but at most 20 us late shows the previous frame; a
 *    reverse request at a nominal boundary that the stored frame misses by more
 *    than 10 us, or by less than its rounding, shows the frame at the boundary.
 *
 * 3. Half-open (exact timestamps, the default of the low-level helpers). The
 *    last frame starting at or before t, i.e. the frame whose interval
 *    [ts, next ts) contains t. Inside a VFR gap (target past the containing
 *    frame's own duration) the nearer of the two frames by start time wins. The
 *    preview's CodecFrameProviderBase uses the same rule. Product callers use
 *    a grid or nearest, because container timestamps are never exact.
 *
 * PRESENTATION_TIMESTAMP_SLACK_US only absorbs microsecond rounding of sample
 * timestamps (chunk timestamps are integers, targets are float seconds x 1e6).
 * It must stay well below BACKWARD_FRAME_EPSILON (10 us), otherwise the reverse
 * case breaks again (EXPORT_REVERSE_OFF_BY_ONE).
 */
export const PRESENTATION_TIMESTAMP_SLACK_US = 1;

/**
 * Nearest rule: a sample starting this little after the request means the caller
 * asked for the frame just before it (2 x BACKWARD_FRAME_EPSILON in us, kept as a
 * literal so the engine does not import the timeline retime module; a unit test
 * pins the relation).
 */
export const REVERSE_REQUEST_WINDOW_US = 20;

/** Exact nominal frame grid of constant-rate media: frame k covers [origin + k·d, origin + (k+1)·d). */
export interface PresentationGrid {
  originUs: number;
  frameDurationUs: number;
  /** Largest distance (us) of a stored timestamp from its grid point: container rounding or jitter. */
  maxResidualUs: number;
}

/** Nearest rule for media without a grid (VFR). */
export interface NearestFrameRule {
  kind: 'nearest';
  /** Half a container tick (us): how late rounding alone can store a timestamp. */
  roundingUs: number;
}

/** How a request is matched to a frame; see the header of this file. */
export type PresentationFrameRule = PresentationGrid | NearestFrameRule | 'half-open';

/** Rule for media whose grid was derived: the grid, or nearest when there is none (VFR). */
export function presentationFrameRule(grid: PresentationGrid | null | undefined, timescale: number): PresentationFrameRule {
  if (grid) return grid;
  return { kind: 'nearest', roundingUs: Number.isFinite(timescale) && timescale > 0 ? 500_000 / timescale : 0 };
}

function isNearestRule(rule: PresentationFrameRule): rule is NearestFrameRule {
  return typeof rule === 'object' && 'kind' in rule;
}

interface GridFit {
  maxResidualUs: number;
  /** Least-squares drift of the residuals across the clip (us): ~0 for the true rate. */
  driftUs: number;
  /** Standard error of driftUs (us): how much of it rounding or jitter explains. */
  driftErrorUs: number;
}

/**
 * How well a candidate grid (origin = first timestamp, which is source time 0)
 * fits, or null when it does not: the residuals must stay within d/4 of 0 and
 * spread over at most d/4. A container tick coarser than d/4 widens that to the
 * rounding it causes (half a tick from 0, one tick of spread), never to d/2:
 * below d/2 the middle-of-frame lookup is provably inside the right sample.
 */
function fitGrid(sortedTimestampsUs: readonly number[], originUs: number, frameDurationUs: number, tickUs: number): GridFit | null {
  const hardLimitUs = frameDurationUs / 2 - 1;
  const spreadToleranceUs = Math.min(Math.max(frameDurationUs / 4, tickUs + 1), hardLimitUs);
  const toleranceUs = Math.min(Math.max(frameDurationUs / 4, tickUs / 2 + 1), hardLimitUs);
  let minSigned = 0;
  let maxSigned = 0;
  let n = 0;
  let sumK = 0;
  let sumR = 0;
  let sumKK = 0;
  let sumKR = 0;
  let sumRR = 0;
  for (const timestamp of sortedTimestampsUs) {
    const offset = timestamp - originUs;
    const k = Math.round(offset / frameDurationUs);
    const signed = offset - k * frameDurationUs;
    if (signed < minSigned) minSigned = signed;
    if (signed > maxSigned) maxSigned = signed;
    if (maxSigned - minSigned > spreadToleranceUs || Math.max(maxSigned, -minSigned) > toleranceUs) return null;
    n++;
    sumK += k;
    sumR += signed;
    sumKK += k * k;
    sumKR += k * signed;
    sumRR += signed * signed;
  }
  const varK = sumKK - (sumK * sumK) / n;
  const covKR = sumKR - (sumK * sumR) / n;
  const slope = varK > 0 ? covKR / varK : 0;
  const residualSquares = Math.max(0, sumRR - (sumR * sumR) / n - slope * covKR);
  const slopeError = varK > 0 && n > 2 ? Math.sqrt(residualSquares / (n - 2) / varK) : Infinity;
  const lastK = Math.round((sortedTimestampsUs[sortedTimestampsUs.length - 1] - originUs) / frameDurationUs);
  return {
    maxResidualUs: Math.max(maxSigned, -minSigned),
    driftUs: Math.abs(slope) * lastK,
    driftErrorUs: slopeError * lastK,
  };
}

/** One rate is an integer multiple of the other (2.5 and 5 fps). */
function isHarmonic(durationA: number, durationB: number): boolean {
  const ratio = Math.max(durationA, durationB) / Math.min(durationA, durationB);
  return Math.round(ratio) >= 2 && Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

function candidateFrameRates(estimatesUs: readonly number[]): number[] {
  const integers: number[] = [];
  const halves: number[] = [];
  const ntsc: number[] = [];
  for (const estimate of estimatesUs) {
    if (!(estimate > 0)) continue;
    const rounded = Math.round(1_000_000 / estimate);
    for (let rate = rounded - 2; rate <= rounded + 2; rate++) {
      // Half-integer rates: 7.5, 12.5 (timelapse, security), 2.5, 0.5.
      const half = rate - 0.5;
      if (half > 0 && !halves.includes(half)) halves.push(half);
      if (rate <= 0 || integers.includes(rate)) continue;
      integers.push(rate);
      ntsc.push((rate * 1000) / 1001);
    }
  }
  return [...integers, ...halves, ...ntsc];
}

/**
 * Derive the nominal frame grid from ascending, de-duplicated presentation
 * timestamps (us) stored at the given container timescale. The frame duration
 * is snapped to an integer, half-integer or 1000/1001 rate, because a measured
 * duration is only accurate to a fraction of a tick and k frames multiply that
 * error past the 10 us reverse margin. A candidate fits when every timestamp lies
 * within d/4 of its grid point and the residuals spread over at most d/4, or the
 * container's rounding when its tick is coarser (fitGrid). That covers rounding
 * (half a tick, also 240 fps at 1/600 where a tick is 0.4 frames) and
 * phone-muxer jitter (up to about 4 ms at 30 fps, frame 0 included), and it
 * rejects VFR media, which gets null and the nearest rule.
 * Dropped frames are fine.
 *
 * Among fitting candidates the one whose residuals do not drift wins: a near
 * rate (240 vs 239.76 fps at 1/600) can fit a short clip, but its residuals grow
 * linearly. Only a drift beyond three standard errors counts; otherwise the
 * earlier candidate (integer, then half-integer, then 1000/1001) stays, and of
 * two harmonics (a 2.5 fps clip also fits 5 fps with every other frame
 * "dropped") the longer frame wins.
 */
export function derivePresentationGrid(sortedTimestampsUs: readonly number[], timescale: number): PresentationGrid | null {
  const count = sortedTimestampsUs.length;
  if (count < 2 || !Number.isFinite(timescale) || timescale <= 0) return null;
  const originUs = sortedTimestampsUs[0];
  const diffs: number[] = [];
  for (let index = 1; index < count; index++) {
    const diff = sortedTimestampsUs[index] - sortedTimestampsUs[index - 1];
    if (diff > 0) diffs.push(diff);
  }
  if (diffs.length === 0) return null;
  const medianDiff = diffs.toSorted((a, b) => a - b)[diffs.length >> 1];
  const spanDiff = (sortedTimestampsUs[count - 1] - originUs) / (count - 1);
  let best: (PresentationGrid & GridFit) | null = null;
  for (const rate of candidateFrameRates([medianDiff, spanDiff])) {
    const frameDurationUs = 1_000_000 / rate;
    const fit = fitGrid(sortedTimestampsUs, originUs, frameDurationUs, 1_000_000 / timescale);
    if (!fit) continue;
    let better = !best;
    if (best) {
      const noiseUs = 3 * Math.max(fit.driftErrorUs, best.driftErrorUs, 1);
      if (fit.driftUs < best.driftUs - noiseUs) better = true;
      else if (fit.driftUs <= best.driftUs + noiseUs) {
        better = isHarmonic(frameDurationUs, best.frameDurationUs) && frameDurationUs > best.frameDurationUs;
      }
    }
    if (better) best = { originUs, frameDurationUs, ...fit };
  }
  return best ? { originUs, frameDurationUs: best.frameDurationUs, maxResidualUs: best.maxResidualUs } : null;
}

const sampleGridCache = new WeakMap<readonly unknown[], { count: number; offset: number; grid: PresentationGrid | null }>();

/**
 * derivePresentationGrid for a sample table, cached per table (and its length
 * and presentation offset): frame selection runs per exported frame, the grid
 * derivation sorts the whole table once.
 */
export function getSamplePresentationGrid<T>(
  samples: readonly T[],
  presentationOffset: number,
  timestampUsOf: (sample: T) => number,
  timescale: number,
): PresentationGrid | null {
  const cached = sampleGridCache.get(samples);
  if (cached && cached.count === samples.length && cached.offset === presentationOffset) return cached.grid;
  const timestamps = [...new Set(samples.map(timestampUsOf).filter(Number.isFinite))].toSorted((a, b) => a - b);
  const grid = derivePresentationGrid(timestamps, timescale);
  sampleGridCache.set(samples, { count: samples.length, offset: presentationOffset, grid });
  return grid;
}

/**
 * Middle of the nominal frame that contains targetUs on the grid. The 1 us slack
 * keeps an exact forward boundary request (float k/fps) in frame k; a reverse
 * request 10 us before it stays in frame k - 1.
 */
export function snapToPresentationGrid(grid: PresentationGrid, targetUs: number): number {
  const frame = Math.floor((targetUs - grid.originUs + PRESENTATION_TIMESTAMP_SLACK_US) / grid.frameDurationUs);
  return grid.originUs + (frame + 0.5) * grid.frameDurationUs;
}

/**
 * Nearest rule: the nearest sample starts so shortly after the request that the
 * frame before it was meant. A lead within half a tick (+ the 1 us slack) may be
 * rounding alone, so it stays a forward hit; on a timescale coarser than about
 * 1/26000 the window is empty and the nearest frame always wins.
 */
function isReverseBoundaryRequest(nearestTs: number, requestedUs: number, roundingUs: number): boolean {
  // Whole microseconds like the decoded chunk timestamps, so float (export
  // planning) and rounded (parallel decode) sample tables decide alike.
  const lead = Math.round(nearestTs) - requestedUs;
  return lead > PRESENTATION_TIMESTAMP_SLACK_US + roundingUs && lead <= REVERSE_REQUEST_WINDOW_US;
}

function resolveGap(
  targetUs: number,
  containingTs: number,
  containingDurationUs: number | undefined,
  nextTs: number,
): 'containing' | 'next' {
  if (!Number.isFinite(nextTs) || !(containingDurationUs !== undefined && containingDurationUs > 0)) return 'containing';
  if (targetUs <= containingTs + containingDurationUs + PRESENTATION_TIMESTAMP_SLACK_US) return 'containing';
  return targetUs - containingTs <= nextTs - targetUs ? 'containing' : 'next';
}

function findNearestPresentationIndex(
  count: number,
  timestampUsAt: (index: number) => number,
  requestedUs: number,
  roundingUs: number,
): number {
  let nearest = -1;
  let nearestTs = NaN;
  let nearestDiff = Infinity;
  for (let index = 0; index < count; index++) {
    const ts = timestampUsAt(index);
    if (!Number.isFinite(ts)) continue;
    const diff = Math.abs(ts - requestedUs);
    if (diff < nearestDiff) {
      nearestDiff = diff;
      nearestTs = ts;
      nearest = index;
    }
  }
  if (nearest < 0 || !isReverseBoundaryRequest(nearestTs, requestedUs, roundingUs)) return nearest;
  let previous = -1;
  let previousTs = -Infinity;
  for (let index = 0; index < count; index++) {
    const ts = timestampUsAt(index);
    if (Number.isFinite(ts) && ts < nearestTs && ts > previousTs) {
      previousTs = ts;
      previous = index;
    }
  }
  return previous >= 0 ? previous : nearest;
}

/**
 * Index (0..count-1) of the frame shown at requestedUs under the given rule
 * (default half-open; product callers pass presentationFrameRule(grid)).
 * Timestamps may come in any order (decode order with B-frames). A target before
 * the first frame selects the earliest frame; ties keep the first index. Returns
 * -1 only for count 0.
 */
export function findContainingPresentationIndex(
  count: number,
  timestampUsAt: (index: number) => number,
  requestedUs: number,
  durationUsAt?: (index: number) => number,
  rule: PresentationFrameRule = 'half-open',
): number {
  if (isNearestRule(rule)) return findNearestPresentationIndex(count, timestampUsAt, requestedUs, rule.roundingUs);
  const targetUs = rule === 'half-open' ? requestedUs : snapToPresentationGrid(rule, requestedUs);
  const limit = targetUs + PRESENTATION_TIMESTAMP_SLACK_US;
  let containing = -1;
  let containingTs = -Infinity;
  let next = -1;
  let nextTs = Infinity;
  for (let index = 0; index < count; index++) {
    const ts = timestampUsAt(index);
    if (!Number.isFinite(ts)) continue;
    if (ts <= limit) {
      if (ts > containingTs) {
        containingTs = ts;
        containing = index;
      }
    } else if (ts < nextTs) {
      nextTs = ts;
      next = index;
    }
  }
  if (containing < 0) return next;
  return resolveGap(targetUs, containingTs, durationUsAt?.(containing), nextTs) === 'next' ? next : containing;
}

/**
 * Timestamp of the frame shown at requestedUs in an ascending, de-duplicated
 * list of frame timestamps (binary search), under the given rule (default
 * half-open). undefined only for an empty list.
 */
export function findContainingSortedTimestamp(
  sortedTimestampsUs: readonly number[],
  requestedUs: number,
  durationUsOf?: (timestampUs: number) => number | undefined,
  rule: PresentationFrameRule = 'half-open',
): number | undefined {
  if (sortedTimestampsUs.length === 0) return undefined;
  const targetUs = rule === 'half-open' || isNearestRule(rule) ? requestedUs : snapToPresentationGrid(rule, requestedUs);
  const limit = targetUs + PRESENTATION_TIMESTAMP_SLACK_US;
  let left = 0;
  let right = sortedTimestampsUs.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (sortedTimestampsUs[mid] <= limit) left = mid + 1;
    else right = mid;
  }
  if (isNearestRule(rule)) {
    // left is the first timestamp after the request (+ slack); left - 1 the last one at or before it.
    const before = left > 0 ? left - 1 : -1;
    const after = left < sortedTimestampsUs.length ? left : -1;
    let nearest = before;
    if (after >= 0 && (before < 0 || sortedTimestampsUs[after] - requestedUs < requestedUs - sortedTimestampsUs[before])) {
      nearest = after;
    }
    if (nearest > 0 && isReverseBoundaryRequest(sortedTimestampsUs[nearest], requestedUs, rule.roundingUs)) nearest -= 1;
    return sortedTimestampsUs[nearest];
  }
  if (left === 0) return sortedTimestampsUs[0];
  const containingTs = sortedTimestampsUs[left - 1];
  const nextTs = sortedTimestampsUs[left] ?? Infinity;
  return resolveGap(targetUs, containingTs, durationUsOf?.(containingTs), nextTs) === 'next' ? nextTs : containingTs;
}
