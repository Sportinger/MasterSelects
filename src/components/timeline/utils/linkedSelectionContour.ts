export interface SelectionRect { left: number; right: number; top: number; bottom: number }
type Interval = [number, number];

function mergeIntervals(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of intervals.toSorted((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function subtractIntervals(source: Interval[], mask: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const [left, right] of source) {
    let cursor = left;
    for (const [start, end] of mask) {
      if (end <= cursor || start >= right) continue;
      if (start > cursor) result.push([cursor, Math.min(start, right)]);
      cursor = Math.max(cursor, end);
      if (cursor >= right) break;
    }
    if (cursor < right) result.push([cursor, right]);
  }
  return result;
}

// Draw the union boundary, omitting shared interior edges even for staggered clips.
export function getLinkedSelectionContour(rects: readonly SelectionRect[]): string {
  const rows = [...new Set(rects.flatMap(rect => [rect.top, rect.bottom]))].toSorted((a, b) => a - b);
  const segments: string[] = [];
  let previous: Interval[] = [];
  for (let index = 0; index < rows.length; index++) {
    const y = rows[index];
    const bottom = rows[index + 1];
    const current = bottom === undefined ? [] : mergeIntervals(rects
      .filter(rect => rect.top <= y && rect.bottom >= bottom)
      .map(rect => [rect.left, rect.right]));
    for (const [left, right] of [...subtractIntervals(current, previous), ...subtractIntervals(previous, current)]) {
      segments.push(`M${left},${y}H${right}`);
    }
    if (bottom !== undefined) {
      for (const [left, right] of current) segments.push(`M${left},${y}V${bottom}`, `M${right},${y}V${bottom}`);
    }
    previous = current;
  }
  return segments.join(' ');
}
