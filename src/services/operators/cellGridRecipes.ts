import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { BlurGraphBuilder, normalizeNodes, premultipliedSourceCache, unpremultiplyNodes, type GraphPort } from './blurGraphBuilder';

/**
 * Pixelate, Blockify and Block Mosaic recipes (see docs/Features/Effects-Mirror-Pixel.md).
 *
 * - Cell size: pixels of a 1080p frame (shorter side 1080 px), rounded to whole rendered pixels
 *   (at least 1), so preview, export and 4K compositions show the same blocks relative to the
 *   picture and every cell is equally wide.
 * - Grid: anchored at the frame centre, so cells grow and shrink about the middle when the size is
 *   animated; cells at the frame edges are cut by the frame.
 * - Colour: each cell shows the average of its pixels. Two cached passes average a cell's row
 *   and then its column (exact for cells up to 2 × CELL_MAX_PAIRS rendered pixels; larger cells
 *   average CELL_MAX_PAIRS evenly spread pixel pairs per row and column). The average reads the
 *   premultiplied rgba16float copy of the frame and is unpremultiplied, so transparent pixels
 *   never darken a cell.
 * - Blockify posterizes the cell colour to Levels steps per channel; Block Mosaic merges some
 *   2 × 2 groups of tiles into one large tile (re-chosen Speed times per second) and draws grout
 *   lines between tiles. Amount mixes the result with the original (premultiplied, so alpha
 *   follows).
 */
export const CELL_REFERENCE_HEIGHT = 1080;
/** Pair taps per pass: cells up to 128 rendered pixels wide are averaged exactly. */
export const CELL_MAX_PAIRS = 64;
export const BLOCKIFY_MIN_LEVELS = 2;
export const BLOCKIFY_MAX_LEVELS = 64;
/** Share of 2 × 2 tile groups merged into one large tile (the original 0.68 hash threshold). */
export const MOSAIC_LARGE_THRESHOLD = .68;

function sources(g: BlurGraphBuilder): void {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5);
  g.unary('zero-vec2', 'convert.scalar-to-vec2', 'zero');
  g.unary('half-vec2', 'convert.scalar-to-vec2', 'half');
  g.binary('pixel', 'math.multiply.vec2', ['uv', 'uv'], ['resolution', 'value']);
  // The grid origin: the whole pixel at (or just before) the frame centre.
  g.binary('origin-raw', 'math.multiply.vec2', ['resolution', 'value'], 'half-vec2');
  g.unary('origin', 'math.floor.vec2', 'origin-raw');
  g.binary('from-origin', 'math.subtract.vec2', 'pixel', 'origin');
  premultipliedSourceCache(g);
}

/** A 1080p-pixel size → whole rendered pixels, at least `minimum` (node id of a constant). */
function renderedPixels(g: BlurGraphBuilder, id: string, size: GraphPort, minimum: string): string {
  if (!g.nodes.some(node => node.id === 'pixel-scale')) {
    g.number('reference-height', CELL_REFERENCE_HEIGHT);
    g.add('short-side', 'vector.reduce-min.vec2', { value: ['resolution', 'value'] });
    g.binary('pixel-scale', 'math.divide-ieee.scalar', 'short-side', 'reference-height');
  }
  g.binary(`${id}-scaled`, 'math.multiply.scalar', size, 'pixel-scale');
  g.binary(`${id}-shifted`, 'math.add.scalar', `${id}-scaled`, 'half');
  g.unary(`${id}-rounded`, 'math.floor.scalar', `${id}-shifted`);
  return g.binary(id, 'math.max.scalar', `${id}-rounded`, minimum);
}

/** The centred grid cell of every pixel for a cell size in rendered pixels: start/end and the part inside the frame. */
function cellGrid(g: BlurGraphBuilder, cell: GraphPort): void {
  g.unary('grid-cell', 'convert.scalar-to-vec2', cell);
  g.binary('grid-position', 'math.divide-ieee.vec2', 'from-origin', 'grid-cell');
  g.unary('grid-index', 'math.floor.vec2', 'grid-position');
  g.binary('grid-offset', 'math.multiply.vec2', 'grid-index', 'grid-cell');
  g.binary('grid-start', 'math.add.vec2', 'origin', 'grid-offset');
  g.binary('grid-end', 'math.add.vec2', 'grid-start', 'grid-cell');
  g.add('grid-low', 'math.clamp.vec2', { value: 'grid-start', min: 'zero-vec2', max: ['resolution', 'value'] });
  g.add('grid-high', 'math.clamp.vec2', { value: 'grid-end', min: 'zero-vec2', max: ['resolution', 'value'] });
  g.add('grid-low-split', 'vector.split.vec2', { value: 'grid-low' });
  g.add('grid-high-split', 'vector.split.vec2', { value: 'grid-high' });
}

/**
 * One averaging pass along an axis of the cell: tap k reads texels low + 2k and low + 2k + 1 with
 * one linear-filtered read at their shared edge (weight 2), or the last odd texel at its centre
 * (weight 1). Past CELL_MAX_PAIRS pairs the taps spread evenly over the cell, each on a texel edge.
 */
function averagePass(g: BlurGraphBuilder, prefix: 'row' | 'column', image: GraphPort): GraphPort {
  const axis = prefix === 'row' ? 'x' : 'y', other = prefix === 'row' ? 'y' : 'x';
  const id = (name: string) => `${prefix}-${name}`;
  const low: GraphPort = ['grid-low-split', axis], high: GraphPort = ['grid-high-split', axis];
  g.binary(id('count'), 'math.subtract.scalar', high, low);
  g.binary(id('half-count'), 'math.multiply.scalar', id('count'), 'half');
  g.unary(id('pairs'), 'math.ceil.scalar', id('half-count'));
  g.binary(id('taps'), 'math.min.scalar', id('pairs'), 'pairs-limit');
  g.add(id('strided'), 'compare.greater.scalar', { a: id('pairs'), b: 'pairs-limit' });
  g.add(id('sequence'), 'image.sequence-index');
  // Exact: the pair starting at texel low + 2k, one or two texels wide.
  g.binary(id('pair-offset'), 'math.multiply.scalar', [id('sequence'), 'index'], 'two');
  g.binary(id('pair-start'), 'math.add.scalar', low, id('pair-offset'));
  g.binary(id('remaining'), 'math.subtract.scalar', high, id('pair-start'));
  g.binary(id('covered'), 'math.min.scalar', id('remaining'), 'two');
  g.binary(id('covered-half'), 'math.multiply.scalar', id('covered'), 'half');
  g.binary(id('exact-position'), 'math.add.scalar', id('pair-start'), id('covered-half'));
  // Strided: tap k on the texel edge nearest low + (k + 0.5) × count / taps.
  g.binary(id('spacing'), 'math.divide-ieee.scalar', id('count'), id('taps'));
  g.binary(id('tap-centre'), 'math.add.scalar', [id('sequence'), 'index'], 'half');
  g.binary(id('tap-offset'), 'math.multiply.scalar', id('tap-centre'), id('spacing'));
  g.binary(id('tap-position'), 'math.add.scalar', low, id('tap-offset'));
  g.binary(id('tap-shifted'), 'math.add.scalar', id('tap-position'), 'half');
  g.unary(id('strided-position'), 'math.floor.scalar', id('tap-shifted'));
  g.add(id('position'), 'select.scalar', { condition: [id('strided'), 'condition'], falseValue: id('exact-position'), trueValue: id('strided-position') });
  g.add(id('weight'), 'select.scalar', { condition: [id('strided'), 'condition'], falseValue: id('covered'), trueValue: 'one' });
  g.binary(id('position-uv'), 'math.divide-ieee.scalar', id('position'), ['resolution-split', axis]);
  g.add(id('sample-uv'), 'vector.combine.vec2', axis === 'x' ? { x: id('position-uv'), y: ['uv-split', other] } : { x: ['uv-split', other], y: id('position-uv') });
  g.add(id('sample'), 'image.sample', { image, uv: id('sample-uv') });
  g.add(id('reduce'), 'image.sequence-reduce', { sample: [id('sample'), 'image'], weight: id('weight'), count: id('taps') });
  return normalizeNodes(g, prefix, id('reduce'));
}

/** Premultiplied average colour of every pixel's cell (row pass cached, then the column pass). */
function cellAverage(g: BlurGraphBuilder): GraphPort {
  g.number('pairs-limit', CELL_MAX_PAIRS);
  g.add('uv-split', 'vector.split.vec2', { value: ['uv', 'uv'] });
  g.add('resolution-split', 'vector.split.vec2', { value: ['resolution', 'value'] });
  const rows = averagePass(g, 'row', ['source-cache', 'image']);
  g.add('row-cache', 'image.materialize', { image: rows });
  return averagePass(g, 'column', ['row-cache', 'image']);
}

/** Straight colour of a premultiplied image (alpha floored, as in the final unpremultiply). */
function straightColour(g: BlurGraphBuilder, prefix: string, image: GraphPort): { rgb: string; alpha: GraphPort } {
  g.add(`${prefix}-split`, 'vector.split.rgba', { image });
  g.add(`${prefix}-alpha`, 'convert.alpha-to-scalar', { alpha: [`${prefix}-split`, 'alpha'] });
  g.number(`${prefix}-alpha-floor`, 1e-6);
  g.binary(`${prefix}-safe-alpha`, 'math.max.scalar', `${prefix}-alpha`, `${prefix}-alpha-floor`);
  const rgb = g.add(`${prefix}-rgb`, 'math.divide-ieee.rgb-scalar', { a: [`${prefix}-split`, 'rgb'], b: `${prefix}-safe-alpha` });
  return { rgb, alpha: `${prefix}-alpha` };
}

/** Straight rgb + alpha → premultiplied, mixed with the original by Amount (0…1), then the output. */
function mixWithOriginal(g: BlurGraphBuilder, rgb: GraphPort, alpha: string): void {
  g.add('effect-rgb', 'math.multiply.rgb-scalar', { a: rgb, b: alpha });
  g.add('effect-alpha', 'convert.scalar-to-alpha', { value: alpha });
  g.add('effect-image', 'vector.combine.rgba', { rgb: 'effect-rgb', alpha: ['effect-alpha', 'alpha'] });
  g.add('effect-vec4', 'convert.image-to-vec4', { image: ['effect-image', 'image'] });
  g.add('original', 'image.sample', { image: ['source-cache', 'image'], uv: ['uv', 'uv'] });
  g.add('original-vec4', 'convert.image-to-vec4', { image: ['original', 'image'] });
  g.bound('amount', 'amount');
  g.add('mix-amount', 'math.clamp.scalar', { value: 'amount', min: 'zero', max: 'one' });
  g.add('mixed', 'math.mix.vec4', { a: 'original-vec4', b: 'effect-vec4', t: 'mix-amount' });
  g.add('mixed-image', 'convert.vec4-to-image', { value: 'mixed' });
  unpremultiplyNodes(g, ['mixed-image', 'image']);
}

export function createDefaultPixelateGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  g.bound('size', 'size');
  const cell = renderedPixels(g, 'cell-px', 'size', 'one');
  cellGrid(g, cell);
  unpremultiplyNodes(g, cellAverage(g));
  return g.graph();
}

export function createDefaultBlockifyGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  g.bound('scale', 'scale');
  const cell = renderedPixels(g, 'cell-px', 'scale', 'one');
  cellGrid(g, cell);
  const { rgb, alpha } = straightColour(g, 'cell', cellAverage(g));
  // Levels steps per channel: round(c × (L − 1)) / (L − 1).
  g.bound('levels', 'levels');
  g.binary('levels-shifted', 'math.add.scalar', 'levels', 'half');
  g.unary('levels-rounded', 'math.floor.scalar', 'levels-shifted');
  g.number('levels-minimum', BLOCKIFY_MIN_LEVELS); g.number('levels-maximum', BLOCKIFY_MAX_LEVELS);
  g.add('levels-count', 'math.clamp.scalar', { value: 'levels-rounded', min: 'levels-minimum', max: 'levels-maximum' });
  g.binary('poster-steps', 'math.subtract.scalar', 'levels-count', 'one');
  g.add('poster-scaled', 'math.multiply.rgb-scalar', { a: rgb, b: 'poster-steps' });
  g.unary('poster-half', 'convert.scalar-to-rgb', 'half');
  g.binary('poster-shifted', 'math.add.rgb', 'poster-scaled', ['poster-half', 'rgb']);
  g.unary('poster-floor', 'math.floor.rgb', 'poster-shifted');
  g.add('poster', 'math.divide-ieee.rgb-scalar', { a: 'poster-floor', b: 'poster-steps' });
  mixWithOriginal(g, 'poster', alpha as string);
  return g.graph();
}

export function createDefaultBlockMosaicGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  g.bound('scale', 'scale');
  const tile = renderedPixels(g, 'tile-px', 'scale', 'two');
  // Large tiles: a 2 × 2 group of tiles, picked per group by a hash that changes Speed times per second.
  g.binary('large-px', 'math.multiply.scalar', tile, 'two');
  g.unary('large-cell', 'convert.scalar-to-vec2', 'large-px');
  g.binary('large-position', 'math.divide-ieee.vec2', 'from-origin', 'large-cell');
  g.unary('large-index', 'math.floor.vec2', 'large-position');
  g.add('time', 'image.timeline-time');
  g.bound('speed', 'speed');
  g.binary('time-speed', 'math.multiply.scalar', ['time', 'value'], 'speed');
  g.unary('time-step', 'math.floor.scalar', 'time-speed');
  g.unary('time-step-vec2', 'convert.scalar-to-vec2', 'time-step');
  g.binary('hash-input', 'math.add.vec2', 'large-index', 'time-step-vec2');
  g.add('hash', 'noise.hash2d.vec2', { value: 'hash-input' });
  g.number('large-threshold', MOSAIC_LARGE_THRESHOLD);
  g.add('is-large', 'compare.greater.scalar', { a: 'hash', b: 'large-threshold' });
  g.add('tile-size', 'select.scalar', { condition: ['is-large', 'condition'], falseValue: tile, trueValue: 'large-px' });
  cellGrid(g, 'tile-size');
  const { rgb, alpha } = straightColour(g, 'cell', cellAverage(g));
  // Grout: Grout Width (1080p px) split over both sides of every tile edge, one pixel soft.
  g.bound('grout', 'grout');
  g.binary('grout-scaled', 'math.multiply.scalar', 'grout', 'pixel-scale');
  g.binary('grout-px', 'math.max.scalar', 'grout-scaled', 'zero');
  g.binary('grout-half', 'math.multiply.scalar', 'grout-px', 'half');
  g.binary('edge-from-start', 'math.subtract.vec2', 'pixel', 'grid-start');
  g.binary('edge-to-end', 'math.subtract.vec2', 'grid-end', 'pixel');
  g.add('edge-start-min', 'vector.reduce-min.vec2', { value: 'edge-from-start' });
  g.add('edge-end-min', 'vector.reduce-min.vec2', { value: 'edge-to-end' });
  g.binary('edge-distance', 'math.min.scalar', 'edge-start-min', 'edge-end-min');
  g.binary('tile-inside', 'math.subtract.scalar', 'edge-distance', 'grout-half');
  g.binary('tile-inside-centered', 'math.add.scalar', 'tile-inside', 'half');
  g.add('tile-coverage', 'math.clamp.scalar', { value: 'tile-inside-centered', min: 'zero', max: 'one' });
  g.bound('grout-color', 'colorA', 'values.color');
  g.add('grout-rgb', 'convert.vec4-to-rgb', { value: 'grout-color' });
  g.add('mosaic', 'math.mix.rgb', { a: ['grout-rgb', 'rgb'], b: rgb, t: 'tile-coverage' });
  mixWithOriginal(g, 'mosaic', alpha as string);
  return g.graph();
}
