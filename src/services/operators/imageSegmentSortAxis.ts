/**
 * Segment Sort (image.segment-sort-axis): sorts runs of pixels along every column or row of the frame.
 * This module is the shared definition of the operation: the plan compiler reads the node settings from
 * here, the software renderer and the tests run `segmentSortSourceMap`, and the GPU pass
 * (src/effects/ImageGraphSegmentSortPass.ts) implements the same rules in one compute workgroup per line.
 *
 * - Lines: with Direction Columns a line is a column, with Rows a row. Angle (degrees, −45..45) slants the
 *   lines: pixel (x, y) of a column line `l` sits at x = l + round(y · tan(angle)) (rows: y = l + round(x · tan)),
 *   rounding half up. Every pixel lies on exactly one line; the slanted lines are clipped to the frame.
 * - Runs: a run starts at the first pixel of a line, wherever Run Start ≥ 0.5, and every SEGMENT_SORT_CHUNK
 *   pixels along a line (the GPU workgroup holds that many). Pixels of one run are reordered by Key (clamped
 *   to 0..1, quantized to 256 levels); equal keys keep their order (stable). Descending flips the key.
 * - The colour of the Image input moves with its key; the output has the frame size.
 * - Angle is read once per frame, from the control value of the first pixel (0, 0).
 */
export const SEGMENT_SORT_CHUNK = 4096;
export const SEGMENT_SORT_MAX_ANGLE = 45;
export const SEGMENT_SORT_KEY_LEVELS = 256;
export const SEGMENT_SORT_AXIS_OPTIONS = [
  { value: 'columns', label: 'Columns (vertical)' },
  { value: 'rows', label: 'Rows (horizontal)' },
] as const;
export const SEGMENT_SORT_ORDER_OPTIONS = [
  { value: 'ascending', label: 'Ascending' },
  { value: 'descending', label: 'Descending' },
] as const;
export type SegmentSortAxis = typeof SEGMENT_SORT_AXIS_OPTIONS[number]['value'];
export type SegmentSortOrder = typeof SEGMENT_SORT_ORDER_OPTIONS[number]['value'];
export interface SegmentSortSettings { axis: SegmentSortAxis; order: SegmentSortOrder }

export const SEGMENT_SORT_OPERATOR = 'image.segment-sort-axis';

/** Node settings: a constant, or an effect parameter bound to the setting (read once per compile). */
export function segmentSortSettings(node: { bindings?: Record<string, unknown>; constants?: Record<string, unknown> }, params: Record<string, unknown>): SegmentSortSettings {
  const read = (id: string) => { const binding = node.bindings?.[id]; return typeof binding === 'string' ? params[binding] : node.constants?.[id]; };
  return { axis: read('axis') === 'rows' ? 'rows' : 'columns', order: read('order') === 'descending' ? 'descending' : 'ascending' };
}

/** tan of the clamped angle; a non-finite angle sorts straight along the axis. The GPU uses f32 `tan`, so a line
 * boundary that falls exactly on a rounding tie may land one pixel apart between the GPU and this reference. */
export function segmentSortSlope(angleDegrees: number): number {
  if (!Number.isFinite(angleDegrees)) return 0;
  const clamped = Math.min(SEGMENT_SORT_MAX_ANGLE, Math.max(-SEGMENT_SORT_MAX_ANGLE, angleDegrees));
  return Math.tan(clamped * Math.PI / 180);
}

/**
 * Sideways shift of a slanted line at `position` along it (rounded half up, like the GPU's floor(v + 0.5)).
 * Plain JS numbers, like the CPU graph evaluator, so a recipe's line coordinate and the CPU sort agree; the
 * GPU computes both in f32.
 */
export function segmentSortShift(position: number, slope: number): number {
  return Math.floor(position * slope + 0.5);
}

/** Key → 0..255; NaN counts as 0. */
export function segmentSortKeyLevel(key: number, order: SegmentSortOrder): number {
  const level = Math.floor(Math.min(1, Math.max(0, Number.isNaN(key) ? 0 : key)) * (SEGMENT_SORT_KEY_LEVELS - 1) + 0.5);
  return order === 'descending' ? SEGMENT_SORT_KEY_LEVELS - 1 - level : level;
}

/**
 * For every output pixel (index y·width + x) the index of the source pixel whose colour it shows.
 * `control(index)` returns [key, run start, angle] of a pixel.
 */
export function segmentSortSourceMap(width: number, height: number, control: (index: number) => readonly [number, number, number],
  settings: SegmentSortSettings): Int32Array {
  const map = new Int32Array(width * height);
  for (let index = 0; index < map.length; index++) map[index] = index;
  if (!map.length) return map;
  const slope = segmentSortSlope(control(0)[2]);
  const columns = settings.axis === 'columns';
  const along = columns ? height : width, across = columns ? width : height;
  const pixel = (line: number, position: number) => {
    const offset = line + segmentSortShift(position, slope);
    return offset < 0 || offset >= across ? -1 : columns ? position * width + offset : offset * width + position;
  };
  const last = segmentSortShift(along - 1, slope);
  const lowest = -Math.max(0, last), highest = across - 1 - Math.min(0, last);
  const run: Array<{ pixel: number; level: number }> = [];
  const flush = (targets: number[]) => {
    if (run.length > 1) {
      // Array.prototype.sort is stable: equal levels keep their order along the line.
      const sorted = run.slice().sort((a, b) => a.level - b.level);
      sorted.forEach((item, rank) => { map[targets[rank]] = item.pixel; });
    }
    run.length = 0; targets.length = 0;
  };
  for (let line = lowest; line <= highest; line++) {
    const targets: number[] = [];
    let previousValid = false;
    for (let position = 0; position < along; position++) {
      const at = pixel(line, position);
      if (at < 0) { if (previousValid) flush(targets); previousValid = false; continue; }
      const [key, start] = control(at);
      if (!previousValid || position % SEGMENT_SORT_CHUNK === 0 || start >= 0.5) flush(targets);
      run.push({ pixel: at, level: segmentSortKeyLevel(key, settings.order) }); targets.push(at);
      previousValid = true;
    }
    flush(targets);
  }
  return map;
}
