/** Exact adjacent source-frame intervals. Times are relative to the current
 * source clock before Float32 conversion, so long clips retain precision. */
export function motionSurfaceIntervals(pairs: readonly { sourceTime: number; targetTime: number; slot: number }[], now: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(now)) throw new Error('Motion geometry requires a finite source time.');
  const unique = new Map<string, { start: number; end: number; slot: number; reverse: number }>();
  for (const pair of pairs) {
    if (![pair.sourceTime, pair.targetTime].every(Number.isFinite) || !Number.isInteger(pair.slot) || pair.slot < 0) {
      throw new Error('Motion geometry has invalid source correspondences.');
    }
    const start = Math.min(pair.sourceTime, pair.targetTime), end = Math.max(pair.sourceTime, pair.targetTime);
    if (start === end) continue;
    const key = `${start}/${end}`;
    if (!unique.has(key)) unique.set(key, { start, end, slot: pair.slot, reverse: Number(pair.sourceTime > pair.targetTime) });
  }
  const intervals = [...unique.values()].toSorted((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start < intervals[i - 1].end) throw new Error('Motion geometry requires adjacent, non-overlapping source intervals.');
  }
  return new Float32Array(intervals.flatMap(p => [p.start - now, p.end - now, p.slot, p.reverse]));
}
