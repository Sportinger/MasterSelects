import type { ClipTimeRemap } from '../../../types/timeline';

export type ClipWarp = Extract<ClipTimeRemap, { kind: 'warp' }>;
export type WarpPoint = ClipWarp['points'][number];

/** Strict at the mutation boundary; persisted JSON may be malformed or from a future version. */
export function validWarpPoints(value: unknown): value is WarpPoint[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= 256 &&
    Array.from(value).every((point, index) => point !== null && typeof point === 'object' &&
      Number.isFinite(point.time) && Number.isFinite(point.source) && point.time >= 0 &&
      (index === 0 || point.time > value[index - 1].time));
}

// Authored arrays are immutable. Validate once per revision, not once per audio sample.
const validArrays = new WeakMap<object, boolean>();
export function hasValidWarpPoints(value: unknown): value is WarpPoint[] {
  if (!Array.isArray(value)) return false;
  let valid = validArrays.get(value);
  if (valid === undefined) { valid = validWarpPoints(value); validArrays.set(value, valid); }
  return valid;
}

/** Raw interpolation deliberately precedes domain clamping (also used by edge edits). */
export function sampleWarp(points: readonly WarpPoint[], local: number) {
  const first = points[0], last = points[points.length - 1];
  if (local < first.time) return { sourceTime: first.source, sourceRate: 0 };
  if (local >= last.time) return { sourceTime: last.source, sourceRate: 0 };
  let low = 0, high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (points[middle].time <= local) low = middle; else high = middle;
  }
  const a = points[low], b = points[high];
  const span = b.time - a.time, fraction = (local - a.time) / span;
  const sourceRate = Number.isFinite(b.source - a.source)
    ? (b.source - a.source) / span : b.source / span - a.source / span;
  const interpolated = a.source + (local - a.time) * sourceRate;
  return { sourceTime: Number.isFinite(interpolated) ? interpolated
    : a.source * (1 - fraction) + b.source * fraction, sourceRate };
}

/** Keep the function, including clamp crossings, rather than interpolating clamped endpoints. */
export function sliceWarp(points: readonly WarpPoint[], start: number, end?: number): ClipWarp {
  const result = [{ time: 0, source: sampleWarp(points, start).sourceTime },
    ...points.filter(point => point.time > start && (end === undefined || point.time < end))
      .map(point => ({ time: point.time - start, source: point.source }))];
  if (end !== undefined) result.push({ time: end - start, source: sampleWarp(points, end).sourceTime });
  if (result.length === 1) result.push({ time: 1, source: result[0].source });
  // Implicit exterior holds can replace redundant boundary points at the 256-point cap.
  if (result.length > 256 && result[0].source === result[1].source) result.shift();
  if (result.length > 256 && result.at(-1)!.source === result.at(-2)!.source) result.pop();
  return { kind: 'warp', points: result };
}
