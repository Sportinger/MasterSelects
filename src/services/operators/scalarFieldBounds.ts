type Range = [number, number];
const LIMIT = 10000;
const bounded = (values: number[]): Range => {
  if (values.some(value => Number.isNaN(value))) return [-LIMIT, LIMIT];
  return [Math.min(LIMIT, Math.max(-LIMIT, Math.min(...values))), Math.max(-LIMIT, Math.min(LIMIT, Math.max(...values)))];
};

/** Conservative geometry bounds keep ray traversal valid after arbitrary math edits. */
export function scalarFieldBounds(operations: readonly [number, number, number, number][], output: number): Range {
  const ranges: Range[] = [];
  for (const [op, ai, bi, ci] of operations) {
    const a = ranges[ai] ?? [0, 0], b = ranges[bi] ?? [0, 0], c = ranges[ci] ?? [0, 0];
    let range: Range;
    switch (op) {
      case 0: range = bounded([ci]); break;
      case 1: range = [0, 1]; break;
      case 2: range = bounded([a[0] + b[0], a[1] + b[1]]); break;
      case 3: range = bounded([a[0] - b[1], a[1] - b[0]]); break;
      case 4: range = bounded(a.flatMap(x => b.map(y => x * y))); break;
      case 5: range = b[0] <= 0 && b[1] >= 0 ? [-LIMIT, LIMIT] : bounded(a.flatMap(x => b.map(y => x / y))); break;
      case 6: range = bounded([...(a.map(x => Math.max(x, 0))).flatMap(x => b.map(y => Math.pow(x, y))), ...(a[0] <= 1 && a[1] >= 1 ? [1] : [])]); break;
      case 7: range = [Math.min(a[0], b[0]), Math.min(a[1], b[1])]; break;
      case 8: range = [Math.max(a[0], b[0]), Math.max(a[1], b[1])]; break;
      case 9: range = [a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(...a.map(Math.abs)), Math.max(...a.map(Math.abs))]; break;
      case 10: range = [-1, 1]; break;
      case 11: range = [Math.min(b[0], c[0]), Math.max(b[1], c[1])]; break;
      default: range = [-LIMIT, LIMIT];
    }
    ranges.push(range);
  }
  return ranges[output] ?? [0, 0];
}
