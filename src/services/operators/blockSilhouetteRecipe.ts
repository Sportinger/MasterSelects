import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { chance, indexKey, keyConstants, renderedPixels, roll, seedSalt } from './seededRecipeParts';
import { gridMarks } from './gridMarkNodes';
import { edgeDistance } from './objectMaskNodes';
import { BLOCK_SILHOUETTE_GRID_RANGE, BLOCK_SILHOUETTE_MARK_RANGE, BLOCK_SILHOUETTE_SIZE_RANGE } from '../../effects/analog/blockSilhouetteLimits';

/**
 * Block Silhouette recipe (see docs/Features/effects/block-silhouette.md): the picture as a flat two-colour
 * silhouette on a block grid, like a black object on a neon-yellow backdrop.
 * - Every block of Block Size pixels (1080p, centred grid) measures its brightness at five points (near its
 *   corners and its centre); transparency counts as light. Below Threshold the block takes Ink, else Paper.
 *   Measure: Differs from edge instead takes Ink where the block's colour differs from the frame edge in the
 *   same row by more than Threshold (objectMaskNodes.ts), for a render on a studio backdrop or gradient.
 *   Invert (0/1, keyframeable) swaps the two, for the white-on-black variant.
 * - Marks: dots or crosses on their own grid (Grid Size), Mark Size thick, at a seeded share of the grid
 *   points (Mark Amount) within Mark Area (only where the outline passes within a block, on Ink, on Paper
 *   or everywhere), each in the colour opposite to the block beneath it, at Mark Opacity.
 * - Amount mixes the result with the original; the result is opaque.
 */
const MASK_TAPS = [[.2, .2], [.8, .2], [.2, .8], [.8, .8], [.5, .5]] as const;
const SALT = { mark: 1 } as const;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5);
  g.splat2('half-vec2', 'half');
  g.splat2('uv-min-vec2', g.number('uv-min', .0005)); g.splat2('uv-max-vec2', g.number('uv-max', .9995));
  keyConstants(g);
  g.mul2('pixel', ['uv', 'uv'], ['resolution', 'value']);
  g.unary('origin', 'math.floor.vec2', g.mul2('origin-raw', ['resolution', 'value'], 'half-vec2'));
  g.sub2('from-origin', 'pixel', 'origin');
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('size', 'scale', g.number('size-min', BLOCK_SILHOUETTE_SIZE_RANGE[0]), g.number('size-max', BLOCK_SILHOUETTE_SIZE_RANGE[1]));
  g.clampedParam('threshold', 'threshold', 'zero', 'one');
  g.clampedParam('invert', 'invert', 'zero', 'one');
  // Measure: Brightness 0, Differs from edge 1. A tone of 1 − difference against 1 − Threshold keeps one comparison.
  g.bound('measure', 'measure', 'values.choice');
  g.add('measure-edge', 'math.step.scalar', { edge: 'half', value: 'measure' });
  g.mix('threshold-used', 'threshold-clamped', g.sub('threshold-flipped', 'one', 'threshold-clamped'), 'measure-edge');
  g.clampedParam('grid', 'gridSize', g.number('grid-min', BLOCK_SILHOUETTE_GRID_RANGE[0]), g.number('grid-max', BLOCK_SILHOUETTE_GRID_RANGE[1]));
  g.clampedParam('mark', 'markSize', g.number('mark-min', BLOCK_SILHOUETTE_MARK_RANGE[0]), g.number('mark-max', BLOCK_SILHOUETTE_MARK_RANGE[1]));
  g.clampedParam('mark-amount', 'markAmount', 'zero', 'one');
  g.clampedParam('mark-opacity', 'markOpacity', 'zero', 'one');
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('seed', 'seed', 'zero', g.number('seed-max', 9999));
  seedSalt(g);
  g.add('ink-rgb', 'convert.vec4-to-rgb', { value: g.bound('ink', 'colorA', 'values.color') });
  g.add('paper-rgb', 'convert.vec4-to-rgb', { value: g.bound('paper', 'colorB', 'values.color') });
  // Marks: None 0, Dots 1, Crosses 2.
  g.bound('marks', 'marks', 'values.choice');
  g.add('marks-on', 'math.step.scalar', { edge: 'half', value: 'marks' });
  g.add('marks-cross', 'math.step.scalar', { edge: g.number('marks-cross-edge', 1.5), value: 'marks' });
  // Mark Area: Edges 0, Ink 1, Paper 2, Everywhere 3.
  g.bound('mark-place', 'markArea', 'values.choice');
}

/** Brightness at `uv`, with transparency counted as light (white). */
function tone(g: AnalogRecipeBuilder, id: string, uv: GraphPort) {
  const clamped = g.add(`${id}-uv`, 'math.clamp.vec2', { value: uv, min: 'uv-min-vec2', max: 'uv-max-vec2' });
  g.add(`${id}-sample`, 'image.sample', { image: ['frame', 'image'], uv: clamped });
  g.add(`${id}-split`, 'vector.split.rgba', { image: [`${id}-sample`, 'image'] });
  const alpha = g.add(`${id}-alpha`, 'convert.alpha-to-scalar', { alpha: [`${id}-split`, 'alpha'] });
  const luma = g.add(`${id}-luma`, 'color.luminance-rec709.rgb', { rgb: [`${id}-split`, 'rgb'] });
  const brightness = g.plus(`${id}-brightness`, g.mul(`${id}-covered`, luma, alpha), g.sub(`${id}-clear`, 'one', alpha));
  // Differs from edge: transparency counts as backdrop (no difference).
  const difference = g.mul(`${id}-edge-covered`, edgeDistance(g, `${id}-edge`, [`${id}-split`, 'rgb'], clamped), alpha);
  return g.mix(`${id}-tone`, brightness, g.sub(`${id}-edge-tone`, 'one', difference), 'measure-edge');
}

/** `ink-on`: 1 where the block is Ink (below Threshold, or above it with Invert). */
function blocks(g: AnalogRecipeBuilder) {
  const block = renderedPixels(g, 'block-px', 'size-clamped');
  g.splat2('block-vec2', block);
  const index = g.unary('block-index', 'math.floor.vec2', g.binary('block-position', 'math.divide-ieee.vec2', 'from-origin', 'block-vec2'));
  const start = g.add2('block-start', 'origin', g.mul2('block-offset', index, 'block-vec2'));
  const tones = MASK_TAPS.map(([fx, fy], k) => tone(g, `tap${k}`, g.binary(`tap${k}-read-uv`, 'math.divide-ieee.vec2',
    g.add2(`tap${k}-pixel`, start, g.mul2(`tap${k}-offset`, 'block-vec2', g.vec2(`tap${k}-fraction`, g.number(`tap${k}-fx`, fx), g.number(`tap${k}-fy`, fy)))), ['resolution', 'value'])));
  const sum = tones.slice(1).reduce<GraphPort>((total, value, k) => g.plus(`tone-sum${k}`, total, value), tones[0]);
  const mean = g.div('block-tone', sum, g.number('tap-count', MASK_TAPS.length));
  const dark = g.sub('block-dark', 'one', g.add('block-light', 'math.step.scalar', { edge: 'threshold-used', value: mean }));
  // Invert ≥ 0.5 swaps Ink and Paper: |dark − swap|.
  g.add('invert-on', 'math.step.scalar', { edge: 'half', value: 'invert-clamped' });
  g.fn('ink-on', 'abs', g.sub('ink-swapped', dark, 'invert-on'));
}

/** `mark-on`: 1 on a dot or cross of the mark grid, at the grid points Mark Amount keeps. */
function marks(g: AnalogRecipeBuilder) {
  const grid = renderedPixels(g, 'grid-px', 'grid-clamped');
  const size = renderedPixels(g, 'mark-px', 'mark-clamped');
  // Grid points sit on the block grid's origin (gridMarkNodes.ts).
  const { shape, cell } = gridMarks(g, 'mark', 'from-origin', grid, size, 'marks-cross');
  const [cx, cy] = g.split2('mark-cell-split', cell);
  const kept = chance(g, 'mark-kept', roll(g, 'mark-roll', SALT.mark, indexKey(g, 'mark-key-x', cx), indexKey(g, 'mark-key-y', cy), 'zero'), 'mark-amount-clamped');
  // Mark Area: which grid points may carry a mark, judged at the grid point itself (Ink or Paper) and one
  // block to each side (Edges: the silhouette's outline passes within a block).
  const point = g.add2('mark-point', 'origin', g.mul2('mark-point-offset', cell, 'mark-grid-vec2'));
  const inkAt = (id: string, dx: number, dy: number) => {
    const at = dx || dy ? g.add2(`${id}-pixel`, point, g.scale2(`${id}-step`, g.vec2(`${id}-direction`, g.number(`${id}-dx`, dx), g.number(`${id}-dy`, dy)), 'block-px')) : point;
    const tone = pointTone(g, id, g.binary(`${id}-read-uv`, 'math.divide-ieee.vec2', at, ['resolution', 'value']));
    const dark = g.sub(`${id}-dark`, 'one', g.add(`${id}-light`, 'math.step.scalar', { edge: 'threshold-used', value: tone }));
    return g.fn(`${id}-ink`, 'abs', g.sub(`${id}-swapped`, dark, 'invert-on'));
  };
  const centre = inkAt('mark-here', 0, 0);
  const neighbours = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([x, y], k) => inkAt(`mark-near${k}`, x, y));
  const edge = neighbours.reduce<GraphPort>((any, ink, k) => g.max(`mark-edge${k}`, any, g.fn(`mark-differs${k}`, 'abs', g.sub(`mark-difference${k}`, ink, centre))), 'zero');
  const area = g.plus('mark-area', g.plus('mark-area-edges', g.mul('mark-area-edge', edge, g.sub('mark-is-edges', 'one', g.add('mark-not-edges', 'math.step.scalar', { edge: 'half', value: 'mark-place' }))),
    g.mul('mark-area-ink', centre, equalsChoice(g, 'mark-is-ink', 1))), g.plus('mark-area-rest', g.mul('mark-area-paper', g.sub('mark-paper', 'one', centre), equalsChoice(g, 'mark-is-paper', 2)),
    equalsChoice(g, 'mark-is-everywhere', 3)));
  g.mul('mark-on', g.mul('mark-shown', g.mul('mark-kept-area', shape, kept), area), 'marks-on');
}

/** 1 where the Mark Area choice is `index`. */
function equalsChoice(g: AnalogRecipeBuilder, id: string, index: number) {
  return g.sub(id, g.add(`${id}-low`, 'math.step.scalar', { edge: g.number(`${id}-from`, index - .5), value: 'mark-place' }),
    g.add(`${id}-high`, 'math.step.scalar', { edge: g.number(`${id}-to`, index + .5), value: 'mark-place' }));
}

/** Brightness at one point (one read), transparency counted as light. */
function pointTone(g: AnalogRecipeBuilder, id: string, uv: GraphPort) {
  return tone(g, id, uv);
}

export function createDefaultBlockSilhouetteGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g); blocks(g); marks(g);
  const base = g.mixRgb('silhouette-rgb', ['paper-rgb', 'rgb'], ['ink-rgb', 'rgb'], 'ink-on');
  // A mark takes the colour opposite to its block.
  const opposite = g.mixRgb('mark-rgb', ['ink-rgb', 'rgb'], ['paper-rgb', 'rgb'], 'ink-on');
  const rgb = g.mixRgb('effect-rgb', base, opposite, g.mul('mark-strength', 'mark-on', 'mark-opacity-clamped'));
  g.add('effect-image', 'vector.combine.rgba', { rgb, alpha: [g.unary('effect-alpha', 'convert.scalar-to-alpha', 'one'), 'alpha'] });
  g.add('effect-vec4', 'convert.image-to-vec4', { image: ['effect-image', 'image'] });
  // Amount mixes premultiplied with the original frame.
  g.add('original-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const originalAlpha = g.add('original-alpha', 'convert.alpha-to-scalar', { alpha: ['original-split', 'alpha'] });
  g.add('original-premultiplied', 'vector.combine.rgba', { rgb: g.scaleRgb('original-rgb', ['original-split', 'rgb'], originalAlpha), alpha: ['original-split', 'alpha'] });
  g.add('original-vec4', 'convert.image-to-vec4', { image: ['original-premultiplied', 'image'] });
  g.add('mixed', 'math.mix.vec4', { a: 'original-vec4', b: 'effect-vec4', t: 'amount-clamped' });
  g.add('mixed-image', 'convert.vec4-to-image', { value: 'mixed' });
  g.add('result-split', 'vector.split.rgba', { image: ['mixed-image', 'image'] });
  const resultAlpha = g.add('result-alpha', 'convert.alpha-to-scalar', { alpha: ['result-split', 'alpha'] });
  const straight = g.add('result-rgb', 'math.divide-ieee.rgb-scalar', { a: ['result-split', 'rgb'], b: g.max('result-safe-alpha', resultAlpha, g.number('coverage-floor', 1e-6)) });
  g.add('result', 'vector.combine.rgba', { rgb: straight, alpha: ['result-split', 'alpha'] });
  g.add('output', 'image.output', { image: ['result', 'image'] });
  return g.graph(10);
}
