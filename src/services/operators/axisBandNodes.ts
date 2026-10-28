import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/** Reads per band and pixel row at most (Kernel Sum (Rect) runs 1..64 taps); wider bands are read at 64 evenly spaced points. */
export const BAND_TAPS_MAX = 64;

/**
 * Line coordinates of a Segment Sort (image.segment-sort-axis, imageSegmentSortAxis.ts), shared by the sort
 * recipes (Pixel Sort Bands): for the pixel `pixel` (whole pixel indices, vec2) and Direction `rows` (0 columns,
 * 1 rows) returns `${p}-along` (position along the line), `${p}-shift` (the slant's sideways shift there,
 * floor(along · slope + 0.5), as the sort pass rounds) and `${p}-line` (the line index, across − shift).
 * Needs the constants `half` and `one`.
 */
export function axisLine(g: AnalogRecipeBuilder, p: string, pixel: GraphPort, rows: GraphPort, slope: GraphPort) {
  const [x, y] = g.split2(`${p}-pixel-split`, pixel);
  const along = g.mix(`${p}-along`, y, x, rows);
  const across = g.mix(`${p}-across`, x, y, rows);
  const shift = g.fn(`${p}-shift`, 'floor', g.plus(`${p}-shift-rounded`, g.mul(`${p}-shift-raw`, along, slope), 'half'));
  const line = g.sub(`${p}-line`, across, shift);
  return { along, shift, line };
}

/** The pixel (vec2) at `across` pixels sideways and `along` along a line, for Direction `rows`. */
export function axisPixel(g: AnalogRecipeBuilder, id: string, across: GraphPort, along: GraphPort, rows: GraphPort) {
  return g.vec2(id, g.mix(`${id}-x`, across, along, rows), g.mix(`${id}-y`, along, across, rows));
}

/**
 * Band average across a sort line: the lines are grouped into bands `width` lines wide (fractional widths
 * alternate between whole widths), starting at `offset` lines; every pixel gets the alpha-weighted mean colour
 * of its band in `source` at the same position along, read at up to BAND_TAPS_MAX points. Returns `${p}-index`
 * (the band) and `${p}-image` (straight RGB of the band, alpha = the band's coverage). Needs `half`, `one`, `zero`,
 * `resolution`, `coverage-floor` and the outputs of `axisLine`.
 */
export function bandAverage(g: AnalogRecipeBuilder, p: string, source: GraphPort, line: { along: GraphPort; shift: GraphPort; line: GraphPort },
  width: GraphPort, offset: GraphPort, rows: GraphPort) {
  const index = g.fn(`${p}-index`, 'floor', g.div(`${p}-position`, g.sub(`${p}-from-offset`, line.line, offset), width));
  const start = g.plus(`${p}-start`, offset, g.mul(`${p}-start-offset`, index, width));
  const taps = g.min(`${p}-taps`, g.unary(`${p}-taps-needed`, 'math.ceil.scalar', width), g.number(`${p}-taps-limit`, BAND_TAPS_MAX));
  const [k] = g.split2(`${p}-tap-split`, g.add(`${p}-tap-index`, 'image.kernel-index'));
  // Tap k sits at the centre of the k-th of `taps` equal parts of the band.
  const tapLine = g.fn(`${p}-tap-line`, 'floor', g.plus(`${p}-tap-at`, start,
    g.mul(`${p}-tap-offset`, g.plus(`${p}-tap-centre`, k, 'half'), g.div(`${p}-tap-step`, width, taps))));
  const tapPixel = axisPixel(g, `${p}-tap-pixel`, g.plus(`${p}-tap-across`, tapLine, line.shift), line.along, rows);
  const lastPixel = g.sub2(`${p}-last-pixel`, ['resolution', 'value'], g.splat2(`${p}-one-vec2`, 'one'));
  const clamped = g.add(`${p}-tap-clamped`, 'math.clamp.vec2', { value: tapPixel, min: g.splat2(`${p}-zero-vec2`, 'zero'), max: lastPixel });
  const uv = g.binary(`${p}-tap-uv`, 'math.divide-ieee.vec2', g.add2(`${p}-tap-centred`, clamped, g.splat2(`${p}-half-vec2`, 'half')), ['resolution', 'value']);
  g.add(`${p}-tap`, 'image.sample', { image: source, uv });
  g.add(`${p}-tap-split-rgba`, 'vector.split.rgba', { image: [`${p}-tap`, 'image'] });
  const alpha = g.add(`${p}-tap-alpha`, 'convert.alpha-to-scalar', { alpha: [`${p}-tap-split-rgba`, 'alpha'] });
  g.add(`${p}-tap-premultiplied`, 'vector.combine.rgba', { rgb: g.scaleRgb(`${p}-tap-rgb`, [`${p}-tap-split-rgba`, 'rgb'], alpha), alpha: [`${p}-tap-split-rgba`, 'alpha'] });
  const reduce = g.add(`${p}-reduce`, 'image.kernel-rect-reduce', { sample: [`${p}-tap-premultiplied`, 'image'], weight: 'one', width: taps, height: 'one' });
  const mean = g.add(`${p}-mean`, 'math.divide-ieee.vec4', { a: [reduce, 'sum'], b: g.add(`${p}-taps-vec4`, 'convert.scalar-to-vec4', { value: taps }) });
  g.add(`${p}-mean-image`, 'convert.vec4-to-image', { value: mean });
  g.add(`${p}-mean-split`, 'vector.split.rgba', { image: [`${p}-mean-image`, 'image'] });
  const coverage = g.add(`${p}-coverage`, 'convert.alpha-to-scalar', { alpha: [`${p}-mean-split`, 'alpha'] });
  const rgb = g.add(`${p}-rgb`, 'math.divide-ieee.rgb-scalar', { a: [`${p}-mean-split`, 'rgb'], b: g.max(`${p}-safe-coverage`, coverage, 'coverage-floor') });
  g.add(`${p}-image`, 'vector.combine.rgba', { rgb, alpha: [`${p}-mean-split`, 'alpha'] });
  return { index, image: [`${p}-image`, 'image'] as const };
}
