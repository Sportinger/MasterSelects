import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder, straightSample } from './analogRecipeBuilder';
import { objectAt, objectMap, objectMaskControls } from './objectMaskNodes';
import { chance, indexKey, keyConstants, modulo, renderedPixels, roll, seedSalt } from './seededRecipeParts';
import { gridMarks } from './gridMarkNodes';
import {
  BLOCK_DISSOLVE_DITHER_SIZE_RANGE, BLOCK_DISSOLVE_EDGE_WIDTH_RANGE, BLOCK_DISSOLVE_MARK_GRID_RANGE, BLOCK_DISSOLVE_MARK_SIZE_RANGE, BLOCK_DISSOLVE_DISPLACE_REACH, BLOCK_DISSOLVE_HOLE_SIZE_RANGE, BLOCK_DISSOLVE_SEED_RANGE,
  BLOCK_DISSOLVE_SIZE_RANGE,
} from '../../effects/analog/blockDissolveLimits';

/**
 * Block Dissolve recipe (see docs/Features/effects/block-dissolve.md). An object breaks into blocks of
 * different shapes, the way a product render dissolves in a data glitch:
 * - Blocks: a grid of Block Size squares. Groups of 4 × 4 squares are split, by Variation, into
 *   blocks 1, 2 or 4 squares wide and high (squares, bars and slivers), redrawn with the structure clock.
 * - Mask: every pixel is object or background, by brightness (Dark on light, Light on dark, against
 *   Threshold) or by alpha. Each block reads the mask at five points (near its corners and its centre):
 *   all five object = inside, none = outside, some = an edge block.
 * - Holes: rectangles of Hole Size, twice and four times Hole Size squares are removed at each
 *   structure state (Holes sets how many), so whole parts of the object vanish at once.
 * - At each flicker state every other block is drawn as the original, flat Ink (Solid, inside blocks, held
 *   with the structure clock), a 1-bit ordered dither of its brightness, dots in the pixel's own colour
 *   or Ink (Dot Colour) on Paper (Dither, Edge
 *   Dither for edge blocks), shifted sideways by one to BLOCK_DISSOLVE_DISPLACE_REACH block widths
 *   (Displace, only blocks with object) or, outside the object and for some edge blocks, removed. Edge
 *   blocks thereby flicker between a smooth outline, a staircase and dither, but only along the stretches
 *   of the outline Edge Amount picks (block groups, held with the structure clock); the rest of the outline
 *   stays smooth. A dithered edge block dithers
 *   the band just outside the real outline (Edge Width), and by Slant only one side of a diagonal cut, so
 *   straight outlines break into slanted pieces too. The background (every
 *   pixel that is not object) is always removed, so the glitch stays on the object.
 * - Removed pixels and Paper dots take the Paper colour or turn transparent (Removed), with Paper Marks (dots
 *   or crosses on a Mark Grid, in Mark Colour) drawn over them. Amount mixes the
 *   result with the original.
 * - Two clocks: Structure Rate redraws blocks, holes and the inside blocks; Flicker Rate redraws the edge
 *   blocks, each at its own tempo and phase so they never change all at once; both per second of
 *   timeline time (0 freezes). Seed picks another pattern.
 * Random keys are exact integers below 2^24 (square indices and states folded by integer modulo,
 * integer salts), so the GPU (f32) and the CPU worker path (f64) hash the same bits.
 */
/** Distinct roll kinds (integer salts below SALT_KINDS, seededRecipeParts.ts). */
const SALT = {
  splitX: 1, splitY: 2, holeShiftX: 3, holeShiftY: 4, holeA: 5, holeB: 6, holeC: 7,
  choice: 8, displace: 9, displaceShift: 10, solid: 11, tempo: 12, phase: 13, slant: 14, slantSide: 15,
} as const;
/** Squares per block group: blocks are 1, 2 or 4 squares wide and high inside it. */
const GROUP_SQUARES = 4;
/** Share of Holes for the three hole sizes (1, 2 and 4 × Hole Size). */
const HOLE_SHARES = [.5, .3, .1] as const;
/** The slowest block flickers at this share of Flicker Rate; the others are spread up to the full rate. */
const FLICKER_TEMPO_MIN = .35;
/** Edge blocks that are not dithered: this share keeps the original, the rest is removed. */
const EDGE_ORIGINAL_SHARE = .6;
/** Mask points inside a block (fractions of the block). */
const MASK_TAPS = [[.2, .2], [.8, .2], [.2, .8], [.8, .8], [.5, .5]] as const;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5); g.number('coverage-floor', 1e-6);
  g.splat2('half-vec2', 'half');
  g.splat2('uv-min-vec2', g.number('uv-min', .0005)); g.splat2('uv-max-vec2', g.number('uv-max', .9995));
  keyConstants(g);
  // The premultiplied frame: bilinear reads never darken an alpha edge.
  g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  g.add('source-alpha', 'convert.alpha-to-scalar', { alpha: ['source-split', 'alpha'] });
  g.scaleRgb('source-rgb-premultiplied', ['source-split', 'rgb'], 'source-alpha');
  g.add('source-premultiplied', 'vector.combine.rgba', { rgb: 'source-rgb-premultiplied', alpha: ['source-split', 'alpha'] });
  g.add('source-cache', 'image.materialize', { image: ['source-premultiplied', 'image'] });
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('size', 'scale', g.number('size-min', BLOCK_DISSOLVE_SIZE_RANGE[0]), g.number('size-max', BLOCK_DISSOLVE_SIZE_RANGE[1]));
  g.clampedParam('variation', 'variation', 'zero', 'one');
  g.clampedParam('holes', 'holes', 'zero', 'one');
  g.clampedParam('hole-size', 'holeSize', g.number('hole-size-min', BLOCK_DISSOLVE_HOLE_SIZE_RANGE[0]), g.number('hole-size-max', BLOCK_DISSOLVE_HOLE_SIZE_RANGE[1]));
  g.clampedParam('dither', 'dither', 'zero', 'one');
  g.clampedParam('edge-dither', 'edgeDither', 'zero', 'one');
  g.clampedParam('edge-amount', 'edgeAmount', 'zero', 'one');
  g.clampedParam('displace', 'displace', 'zero', 'one');
  g.clampedParam('solid', 'solid', 'zero', 'one');
  g.clampedParam('slant', 'slant', 'zero', 'one');
  g.clampedParam('edge-width', 'edgeWidth', g.number('edge-width-min', BLOCK_DISSOLVE_EDGE_WIDTH_RANGE[0]), g.number('edge-width-max', BLOCK_DISSOLVE_EDGE_WIDTH_RANGE[1]));
  g.clampedParam('dither-size', 'ditherSize', g.number('dither-size-min', BLOCK_DISSOLVE_DITHER_SIZE_RANGE[0]), g.number('dither-size-max', BLOCK_DISSOLVE_DITHER_SIZE_RANGE[1]));
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('seed', 'seed', g.number('seed-min', BLOCK_DISSOLVE_SEED_RANGE[0]), g.number('seed-max', BLOCK_DISSOLVE_SEED_RANGE[1]));
  g.bound('fill', 'fill', 'values.choice');
  // Pattern: Checker 0 (a fixed half-and-half checker), Bayer 1 (ordered dither of the brightness), Diagonal 2
  // (the checker turned by 45°: rows of diamonds that read as slanted hatching).
  g.bound('pattern', 'pattern', 'values.choice');
  g.add('pattern-diagonal', 'math.step.scalar', { edge: g.number('pattern-diagonal-edge', 1.5), value: 'pattern' });
  g.sub('pattern-bayer', g.add('pattern-bayer-or-diagonal', 'math.step.scalar', { edge: 'half', value: 'pattern' }), 'pattern-diagonal');
  // Hole placement: Edges 0 (holes bite in from the outline), Anywhere 1.
  g.add('holes-anywhere', 'math.step.scalar', { edge: 'half', value: g.bound('placement', 'holePlacement', 'values.choice') });
  // Dot Colour: Original 0 (each dot keeps its pixel's colour), Ink 1.
  // Dot Colour: Original 0, Ink 1, Mark Colour 2.
  g.add('dots-ink', 'math.step.scalar', { edge: 'half', value: g.bound('dot-colour', 'dotColor', 'values.choice') });
  g.add('dots-mark', 'math.step.scalar', { edge: g.number('dots-mark-edge', 1.5), value: 'dot-colour' });
  g.add('ink-rgb', 'convert.vec4-to-rgb', { value: g.bound('ink', 'colorA', 'values.color') });
  g.add('paper-rgb', 'convert.vec4-to-rgb', { value: g.bound('paper', 'colorB', 'values.color') });
  // Paper Marks: None 0, Dots 1, Crosses 2.
  g.bound('paper-marks', 'paperMarks', 'values.choice');
  g.add('paper-marks-on', 'math.step.scalar', { edge: 'half', value: 'paper-marks' });
  g.add('paper-marks-cross', 'math.step.scalar', { edge: g.number('paper-marks-cross-edge', 1.5), value: 'paper-marks' });
  g.clampedParam('paper-mark-grid', 'markGrid', g.number('paper-mark-grid-min', BLOCK_DISSOLVE_MARK_GRID_RANGE[0]), g.number('paper-mark-grid-max', BLOCK_DISSOLVE_MARK_GRID_RANGE[1]));
  g.clampedParam('paper-mark-size', 'markSize', g.number('paper-mark-size-min', BLOCK_DISSOLVE_MARK_SIZE_RANGE[0]), g.number('paper-mark-size-max', BLOCK_DISSOLVE_MARK_SIZE_RANGE[1]));
  g.add('paper-mark-rgb', 'convert.vec4-to-rgb', { value: g.bound('paper-mark-colour', 'markColor', 'values.color') });
  objectMaskControls(g);
  // Removed (Paper 0, Transparent 1) as a 0/1 weight.
  g.add('fill-transparent', 'math.step.scalar', { edge: 'half', value: 'fill' });
  g.sub('fill-paper', 'one', 'fill-transparent');
}

/** Whole state counters of both clocks, folded into the key range, and the seed's share of the salt. */
function clocks(g: AnalogRecipeBuilder) {
  for (const [clock, parameter] of [['structure', 'structureRate'], ['flicker', 'flickerRate']] as const) {
    // Time × Rate directly, so a keyframed rate moves by its travelled distance (imageRateTravel.ts).
    const elapsed = g.max(`${clock}-elapsed`, g.mul(`${clock}-time`, 'time', g.bound(`${clock}-rate`, parameter)), 'zero');
    if (clock === 'structure') modulo(g, `${clock}-state`, g.fn(`${clock}-step`, 'floor', elapsed), 'key-range');
  }
  seedSalt(g);
}

/** 1, 2 or 4 squares along one axis of a block group: a split below Variation, half of them to 4. */
function splitFactor(g: AnalogRecipeBuilder, axis: 'x' | 'y') {
  const rolled = roll(g, `split-${axis}-roll`, axis === 'x' ? SALT.splitX : SALT.splitY, 'group-key-x', 'group-key-y', 'structure-state');
  const split = chance(g, `split-${axis}`, rolled, 'variation-clamped');
  const large = chance(g, `split-${axis}-large`, rolled, g.mul(`split-${axis}-half`, 'variation-clamped', 'half'));
  return g.plus(`split-${axis}-factor`, g.plus(`split-${axis}-base`, 'one', split), g.mul(`split-${axis}-extra`, large, 'two'));
}

/**
 * The block grid, centred on the frame: squares of `square-px` in groups of GROUP_SQUARES, each group
 * split into blocks of `block-size` pixels. `block-start` is the block's first pixel, `block-key-x/y`
 * the key of its first square.
 */
function grid(g: AnalogRecipeBuilder) {
  g.mul2('pixel', ['uv', 'uv'], ['resolution', 'value']);
  g.unary('origin', 'math.floor.vec2', g.mul2('origin-raw', ['resolution', 'value'], 'half-vec2'));
  g.sub2('from-origin', 'pixel', 'origin');
  const square = renderedPixels(g, 'square-px', 'size-clamped');
  const group = g.mul('group-px', square, g.number('group-squares', GROUP_SQUARES));
  g.split2('group-split', g.unary('group-index', 'math.floor.vec2', g.binary('group-position', 'math.divide-ieee.vec2', 'from-origin', g.splat2('group-vec2', group))));
  indexKey(g, 'group-key-x', ['group-split', 'x']); indexKey(g, 'group-key-y', ['group-split', 'y']);
  g.vec2('block-squares', splitFactor(g, 'x'), splitFactor(g, 'y'));
  g.scale2('block-size', 'block-squares', square);
  g.unary('block-index', 'math.floor.vec2', g.binary('block-position', 'math.divide-ieee.vec2', 'from-origin', 'block-size'));
  g.add2('block-start', 'origin', g.mul2('block-offset', 'block-index', 'block-size'));
  const first = g.split2('block-square', g.mul2('block-first-square', 'block-index', 'block-squares'));
  indexKey(g, 'block-key-x', first[0]); indexKey(g, 'block-key-y', first[1]);
  g.split2('block-size-split', 'block-size');
}

/**
 * The flicker clock of the block (`flicker-state`): every block runs at its own share of Flicker Rate
 * (FLICKER_TEMPO_MIN to 1) from its own phase, so blocks never change all at once and the flicker reads
 * organic instead of a uniform beat. Inside blocks use the structure clock instead (see choices).
 */
function blockFlicker(g: AnalogRecipeBuilder) {
  const tempo = g.plus('flicker-tempo', g.number('flicker-tempo-min', FLICKER_TEMPO_MIN), g.mul('flicker-tempo-spread',
    roll(g, 'flicker-tempo-roll', SALT.tempo, 'block-key-x', 'block-key-y', 'zero'), g.number('flicker-tempo-range', 1 - FLICKER_TEMPO_MIN)));
  const local = g.plus('flicker-local', g.mul('flicker-paced', 'flicker-elapsed', tempo), roll(g, 'flicker-phase-roll', SALT.phase, 'block-key-x', 'block-key-y', 'zero'));
  modulo(g, 'flicker-state', g.fn('flicker-step', 'floor', local), 'key-range');
  // Edge blocks flicker; inside blocks only change with the structure clock.
  g.mix('choice-state', 'structure-state', 'flicker-state', 'block-edge');
}

/** Straight read at a UV clamped inside the frame. */
function read(g: AnalogRecipeBuilder, id: string, uv: GraphPort) {
  return straightSample(g, id, 'source-cache', g.add(`${id}-uv`, 'math.clamp.vec2', { value: uv, min: 'uv-min-vec2', max: 'uv-max-vec2' }));
}

/** Mask coverage of the block: `block-inside` and `block-edge` (0 or 1). */
function blockMask(g: AnalogRecipeBuilder) {
  const weights = MASK_TAPS.map(([fx, fy], index) => {
    const id = `tap${index}`;
    const offset = g.mul2(`${id}-offset`, 'block-size', g.vec2(`${id}-fraction`, g.number(`${id}-fx`, fx), g.number(`${id}-fy`, fy)));
    return objectAt(g, id, g.binary(`${id}-uv`, 'math.divide-ieee.vec2', g.add2(`${id}-pixel`, 'block-start', offset), ['resolution', 'value']));
  });
  const count = weights.slice(1).reduce<GraphPort>((total, weight, index) =>
    g.plus(index === weights.length - 2 ? 'mask-count' : `mask-count-${index}`, total, weight), weights[0]);
  g.add('block-inside', 'math.step.scalar', { edge: g.number('inside-edge', 4.5), value: count });
  g.sub('block-edge', g.add('block-any', 'math.step.scalar', { edge: 'half', value: count }), 'block-inside');
}

/** `hole`: 1 where the pixel lies in a removed rectangle of this structure state (three sizes). */
function holes(g: AnalogRecipeBuilder) {
  const size = g.fn('hole-squares', 'floor', g.plus('hole-size-rounded', 'hole-size-clamped', 'half'));
  // Each state shifts the hole grid by whole squares, so holes do not always line up.
  const shift = (axis: 'x' | 'y') => g.fn(`hole-shift-${axis}`, 'floor', g.mul(`hole-shift-${axis}-scaled`,
    roll(g, `hole-shift-${axis}-roll`, axis === 'x' ? SALT.holeShiftX : SALT.holeShiftY, 'zero', 'zero', 'structure-state'), g.mul(`hole-shift-${axis}-span`, size, g.number(`hole-shift-${axis}-groups`, 4))));
  const shifts = { x: shift('x'), y: shift('y') };
  g.split2('square-split', g.unary('square-index', 'math.floor.vec2', g.binary('square-position', 'math.divide-ieee.vec2', 'from-origin', g.splat2('square-vec2', 'square-px'))));
  g.split2('origin-split', 'origin');
  const levels = (['A', 'B', 'C'] as const).map((name, level) => {
    const span = level === 0 ? size : g.mul(`hole-${name}-span`, size, g.number(`hole-${name}-factor`, 2 ** level));
    const index = (axis: 'x' | 'y') => g.fn(`hole-${name}-${axis}`, 'floor',
      g.div(`hole-${name}-${axis}-position`, g.plus(`hole-${name}-${axis}-shifted`, ['square-split', axis], shifts[axis]), span));
    const indices = { x: index('x'), y: index('y') };
    const rolled = roll(g, `hole-${name}-roll`, name === 'A' ? SALT.holeA : name === 'B' ? SALT.holeB : SALT.holeC,
      indexKey(g, `hole-${name}-key-x`, indices.x), indexKey(g, `hole-${name}-key-y`, indices.y), 'structure-state');
    const fires = chance(g, `hole-${name}`, rolled, g.mul(`hole-${name}-chance`, 'holes-clamped', g.number(`hole-${name}-share`, HOLE_SHARES[level])));
    // Edges: a hole whose four corners (half a square inside) all lie on the object would sit in the middle
    // of it; such holes are skipped, so holes bite in from the outline.
    const side = (axis: 'x' | 'y', end: 0 | 1) => {
      const squares = g.plus(`hole-${name}-${axis}${end}-squares`, g.sub(`hole-${name}-${axis}${end}-start`,
        g.mul(`hole-${name}-${axis}${end}-index`, end ? g.plus(`hole-${name}-${axis}-next`, indices[axis], 'one') : indices[axis], span), shifts[axis]),
        g.number(`hole-${name}-${axis}${end}-inset`, end ? -.5 : .5));
      return g.plus(`hole-${name}-${axis}${end}`, g.mul(`hole-${name}-${axis}${end}-px`, squares, 'square-px'), ['origin-split', axis]);
    };
    const sides = { x: [side('x', 0), side('x', 1)], y: [side('y', 0), side('y', 1)] };
    const corners = ([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([ex, ey]) => objectAt(g, `hole-${name}-corner${ex}${ey}`,
      g.binary(`hole-${name}-corner${ex}${ey}-uv`, 'math.divide-ieee.vec2', g.vec2(`hole-${name}-corner${ex}${ey}-pixel`, sides.x[ex], sides.y[ey]), ['resolution', 'value'])));
    const interior = g.mul(`hole-${name}-interior`, g.mul(`hole-${name}-interior-top`, corners[0], corners[1]), g.mul(`hole-${name}-interior-bottom`, corners[2], corners[3]));
    const allowed = g.mix(`hole-${name}-allowed`, g.sub(`hole-${name}-at-edge`, 'one', interior), 'one', 'holes-anywhere');
    return g.mul(`hole-${name}-placed`, fires, allowed);
  });
  g.max('hole', g.max('hole-AB', levels[0], levels[1]), levels[2]);
}

/**
 * The block's choice at this flicker state: `use-dither`, `use-displace`, `use-solid` or `use-original`
 * (at most one is 1; none = removed). Holes remove; edge blocks dither by Edge Dither, else keep or drop
 * the original; other blocks dither by Dither; blocks with some object outside a hole may be displaced;
 * inside blocks that keep the picture are filled flat with Ink by Solid.
 */
function choices(g: AnalogRecipeBuilder) {
  const free = g.sub('not-hole', 'one', 'hole');
  // Edge Amount: only some stretches of the outline glitch (block groups, chosen with the structure clock);
  // elsewhere the outline stays smooth. The region roll shares the hole-shift salt: its keys (block groups,
  // offset by INDEX_OFFSET) never meet the hole shift's (0, 0).
  const region = chance(g, 'edge-region', roll(g, 'edge-region-roll', SALT.holeShiftX, 'group-key-x', 'group-key-y', 'structure-state'), 'edge-amount-clamped');
  g.mul('edge-active', 'block-edge', region);
  // Only active edge blocks are displaced: the inside, the calm outline and the background stay still.
  const displaced = g.mul('displace-here', chance(g, 'displace-on', roll(g, 'displace-roll', SALT.displace, 'block-key-x', 'block-key-y', 'flicker-state'), 'displace-clamped'),
    'edge-active');
  g.mul('use-displace', free, displaced);
  const rest = g.mul('choice-rest', free, g.sub('not-displaced', 'one', displaced));
  const rolled = roll(g, 'choice-roll', SALT.choice, 'block-key-x', 'block-key-y', 'choice-state');
  const ditherChance = g.mix('dither-chance', 'dither-clamped', 'edge-dither-clamped', 'edge-active');
  const dither = chance(g, 'dither-on', rolled, ditherChance);
  g.mul('use-dither', rest, dither);
  // Undithered: inside keeps the original, outside is removed, an edge block keeps it at EDGE_ORIGINAL_SHARE.
  const edgeLimit = g.plus('edge-original-limit', ditherChance, g.mul('edge-original-range', g.sub('edge-undithered', 'one', ditherChance), g.number('edge-original-share', EDGE_ORIGINAL_SHARE)));
  const edgeKeeps = g.sub('edge-keeps', chance(g, 'edge-below-original', rolled, edgeLimit), dither);
  // Calm stretches keep the original (a smooth outline, slivers of object in outside blocks included);
  // active edge blocks keep it at EDGE_ORIGINAL_SHARE, active outside blocks drop it (the staircase).
  const calm = g.sub('region-calm', 'one', region);
  const calmBlocks = g.mul('calm-blocks', g.sub('block-not-inside', 'one', 'block-inside'), calm);
  const keeps = g.plus('keeps', g.plus('keeps-calm', 'block-inside', calmBlocks), g.mul('edge-keeps-original', 'edge-active', edgeKeeps));
  const kept = g.mul('use-kept', g.mul('original-rest', rest, g.sub('not-dither', 'one', dither)), keeps);
  // Inside blocks are filled flat with Ink by Solid, chosen with the structure clock so they hold still.
  const solid = chance(g, 'solid-on', roll(g, 'solid-roll', SALT.solid, 'block-key-x', 'block-key-y', 'structure-state'), 'solid-clamped');
  g.mul('use-solid', g.mul('use-solid-inside', kept, 'block-inside'), solid);
  g.sub('use-original', kept, 'use-solid');
}

/**
 * 1-bit ordered dither of the pixel's brightness (`dither-ink`: 1 = Ink, 0 = Paper); transparency reads as
 * Paper. In Dark on light the brightness is measured up to Threshold, so the background (at or above it)
 * stays clean Paper and only shadows just below it break into a few dots.
 */
function ditherInk(g: AnalogRecipeBuilder, rawLuma: GraphPort, alpha: GraphPort) {
  const toThreshold = g.min('dither-luma-dark', g.div('dither-luma-scaled', rawLuma, g.max('dither-threshold-safe', 'threshold-clamped', 'coverage-floor')), 'one');
  const luma = g.mix('dither-luma', toThreshold, rawLuma, 'mask-light-or-alpha');
  const size = renderedPixels(g, 'dither-px', 'dither-size-clamped');
  const cells = g.unary('dither-cell', 'math.floor.vec2', g.binary('dither-cell-position', 'math.divide-ieee.vec2', 'pixel', g.splat2('dither-vec2', size)));
  // The Bayer lookup reads non-negative cells.
  const threshold = g.unary('dither-threshold', 'pattern.bayer4.vec2', g.add2('dither-cell-positive', cells, g.splat2('dither-offset', g.number('dither-offset-value', 65536))));
  const tone = g.plus('dither-tone', g.mul('dither-tone-covered', luma, alpha), g.sub('dither-tone-clear', 'one', alpha));
  const bayer = g.sub('dither-bayer-ink', 'one', g.add('dither-paper', 'math.step.scalar', { edge: threshold, value: tone }));
  // Checker: every other dot, whatever the brightness (the 350Z reel's dither band).
  const [cx, cy] = g.split2('dither-cell-split', cells);
  const checker = g.add('dither-checker', 'math.step.scalar', { edge: 'half', value: g.mul('dither-checker-parity',
    g.fn('dither-checker-fract', 'fract', g.mul('dither-checker-half', g.plus('dither-checker-sum', cx, cy), 'half')), g.number('dither-checker-two', 2)) });
  // Diagonal: the checker on axes turned by 45° (x + y and x − y in dots).
  const [px, py] = g.split2('dither-pixel-split', 'pixel');
  const along = g.fn('dither-diagonal-a', 'floor', g.div('dither-diagonal-a-position', g.plus('dither-diagonal-sum', px, py), size));
  const across = g.fn('dither-diagonal-b', 'floor', g.div('dither-diagonal-b-position', g.sub('dither-diagonal-difference', px, py), size));
  const diagonal = g.add('dither-diagonal', 'math.step.scalar', { edge: 'half', value: g.mul('dither-diagonal-parity',
    g.fn('dither-diagonal-fract', 'fract', g.mul('dither-diagonal-half', g.plus('dither-diagonal-cells', along, across), 'half')), g.number('dither-diagonal-two', 2)) });
  return g.plus('dither-ink', g.plus('dither-ink-square', g.mul('dither-checker-share', checker, g.sub('dither-checker-weight', 'one', g.plus('dither-other-patterns', 'pattern-bayer', 'pattern-diagonal'))),
    g.mul('dither-bayer-share', bayer, 'pattern-bayer')), g.mul('dither-diagonal-share', diagonal, 'pattern-diagonal'));
}

/** Directions in which a pixel looks for the object's outline (Edge Width away). */
const BAND_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [.7071, .7071], [.7071, -.7071], [-.7071, .7071], [-.7071, -.7071]] as const;

/**
 * The dither band along the real outline: background pixels with object within Edge Width (looked up in
 * BAND_DIRECTIONS), a strip just outside the object. It follows the outline at any angle, so a slanted
 * edge gives a slanted band; clipped to the edge blocks it turns into the slanted pieces of the 350Z reel.
 * `band-rgb` / `band-alpha` give it the colour of the object beside it.
 */
function contourBand(g: AnalogRecipeBuilder, ownRaw: GraphPort) {
  const reach = renderedPixels(g, 'band-px', 'edge-width-clamped');
  let count: GraphPort = 'zero', rgb: GraphPort = g.rgbConstant('band-rgb-start', 'zero'), alpha: GraphPort = 'zero';
  BAND_DIRECTIONS.forEach(([dx, dy], k) => {
    const offset = g.scale2(`band${k}-offset`, g.vec2(`band${k}-direction`, g.number(`band${k}-dx`, dx), g.number(`band${k}-dy`, dy)), reach);
    const uv = g.add(`band${k}-uv`, 'math.clamp.vec2', { value: g.binary(`band${k}-uv-raw`, 'math.divide-ieee.vec2', g.add2(`band${k}-pixel`, 'pixel', offset), ['resolution', 'value']),
      min: 'uv-min-vec2', max: 'uv-max-vec2' });
    const hit = objectAt(g, `band${k}`, uv);
    g.add(`band${k}-colour`, 'image.sample', { image: ['source-cache', 'image'], uv });
    g.add(`band${k}-colour-split`, 'vector.split.rgba', { image: [`band${k}-colour`, 'image'] });
    count = g.plus(`band-count${k}`, count, hit);
    rgb = g.addRgb(`band-rgb${k}`, rgb, g.scaleRgb(`band${k}-rgb`, [`band${k}-colour-split`, 'rgb'], hit));
    alpha = g.plus(`band-alpha${k}`, alpha, g.mul(`band${k}-alpha`, g.add(`band${k}-alpha-value`, 'convert.alpha-to-scalar', { alpha: [`band${k}-colour-split`, 'alpha'] }), hit));
  });
  const nearObject = g.add('band-near-object', 'math.step.scalar', { edge: 'half', value: count });
  g.mul('band', g.sub('band-own-background', 'one', ownRaw), nearObject);
  // Premultiplied sum over the hits → straight colour of the object beside the pixel.
  g.add('band-rgb', 'math.divide-ieee.rgb-scalar', { a: rgb, b: g.max('band-alpha-safe', alpha, 'coverage-floor') });
  g.div('band-alpha', alpha, g.max('band-count-safe', count, 'one'));
}

/**
 * Slant: a dithered edge block is cut along a diagonal (`slant-on`, by Slant; Slant Direction), and only the side
 * `slant-side` is drawn, so even straight outlines break into slanted pieces like the curved 350Z body.
 */
function slantCut(g: AnalogRecipeBuilder) {
  const [u, v] = g.split2('slant-local', g.binary('slant-local-raw', 'math.divide-ieee.vec2', g.sub2('slant-from-start', 'pixel', 'block-start'), 'block-size'));
  g.mul('slant-on', chance(g, 'slant-chance', roll(g, 'slant-roll', SALT.slant, 'block-key-x', 'block-key-y', 'choice-state'), 'slant-clamped'), 'edge-active');
  // Slant Direction: Falling 0 (cuts along the top-left to bottom-right diagonal, as in the 350Z reel),
  // Rising 1 (bottom-left to top-right), Both 2. The kept side is random per block.
  const choice = g.bound('slant-choice', 'slantDirection', 'values.choice');
  const both = g.add('slant-both', 'math.step.scalar', { edge: g.number('slant-both-edge', 1.5), value: choice });
  const rising = g.sub('slant-rising', g.add('slant-rising-or-both', 'math.step.scalar', { edge: 'half', value: choice }), both);
  const sideRoll = roll(g, 'slant-side-roll', SALT.slantSide, 'block-key-x', 'block-key-y', 'choice-state');
  const twoWays = g.fn('slant-two', 'floor', g.mul('slant-two-scaled', sideRoll, 'two'));
  // Direction index: 0/1 rising cuts, 2/3 falling cuts; Both picks any of the four.
  const direction = g.plus('slant-direction', g.mul('slant-direction-single', g.sub('slant-single', 'one', both),
    g.plus('slant-direction-way', twoWays, g.mul('slant-direction-falling', g.sub('slant-falling', 'one', rising), 'two'))),
    g.mul('slant-direction-both', both, g.fn('slant-four', 'floor', g.mul('slant-four-scaled', sideRoll, g.number('slant-directions', 4)))));
  // Four cuts: above or below the rising diagonal (u + v = 1), right or left of the falling one (u = v).
  const below = g.add('slant-below', 'math.step.scalar', { edge: 'one', value: g.plus('slant-sum', u, v) });
  const right = g.add('slant-right', 'math.step.scalar', { edge: v, value: u });
  const pick = (k: number, side: GraphPort) => g.mul(`slant-pick${k}`, g.sub(`slant-is${k}`, g.add(`slant-is${k}-low`, 'math.step.scalar', { edge: g.number(`slant-is${k}-from`, k - .5), value: direction }),
    g.add(`slant-is${k}-high`, 'math.step.scalar', { edge: g.number(`slant-is${k}-to`, k + .5), value: direction })), side);
  g.plus('slant-side', g.plus('slant-side-a', pick(0, g.sub('slant-above', 'one', below)), pick(1, below)),
    g.plus('slant-side-b', pick(2, right), pick(3, g.sub('slant-left', 'one', right))));
}

/** The pixel `displace-shift` block widths to the side (one to BLOCK_DISSOLVE_DISPLACE_REACH, either way). */
function displacedRead(g: AnalogRecipeBuilder) {
  const reach = BLOCK_DISSOLVE_DISPLACE_REACH;
  const rolled = roll(g, 'displace-shift-roll', SALT.displaceShift, 'block-key-x', 'block-key-y', 'flicker-state');
  const steps = g.plus('displace-steps', g.fn('displace-steps-whole', 'floor', g.mul('displace-steps-scaled', g.fn('displace-steps-fract', 'fract', g.mul('displace-steps-spread', rolled, 'two')), g.number('displace-reach', reach))), 'one');
  const direction = g.sub('displace-direction', g.mul('displace-direction-two', g.add('displace-right', 'math.step.scalar', { edge: 'half', value: rolled }), 'two'), 'one');
  const offset = g.mul('displace-offset-x', g.mul('displace-blocks', steps, direction), ['block-size-split', 'x']);
  const moved = g.add2('displace-pixel', 'pixel', g.vec2('displace-offset', offset, 'zero'));
  return read(g, 'displaced', g.binary('displace-read-uv', 'math.divide-ieee.vec2', moved, ['resolution', 'value']));
}

export function createDefaultBlockDissolveGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g); objectMap(g); clocks(g); grid(g); blockMask(g); blockFlicker(g); holes(g); choices(g);
  const own = read(g, 'own', ['uv', 'uv']);
  const ink = ditherInk(g, g.add('own-luma', 'color.luminance-rec709.rgb', { rgb: own.rgb }), own.alpha);
  const displaced = displacedRead(g);
  // Shown original and displaced pixels keep only the object; their background counts as removed, so the
  // background is one clean Paper (or transparent). With Alpha the pixel's own alpha does this, softly.
  const ownRaw = objectAt(g, 'own-map', ['uv', 'uv']);
  const ownObject = g.mix('own-keeps', ownRaw, 'one', 'mask-alpha');
  contourBand(g, ownRaw);
  slantCut(g);
  const displacedObject = g.mix('displaced-keeps', objectAt(g, 'displaced-map', 'displaced-uv'), 'one', 'mask-alpha');
  // Dithered edge blocks dither only the band along the outline; the rest of the block keeps the object.
  // Slanted ones dither object and band on one side of a diagonal and drop the other side.
  const ditherEdgeAll = g.mul('dither-edge-all', 'use-dither', 'block-edge'), ditherInner = g.sub('dither-inner', 'use-dither', ditherEdgeAll);
  const ditherSlant = g.mul('dither-slant', ditherEdgeAll, 'slant-on'), ditherEdge = g.sub('dither-edge', ditherEdgeAll, ditherSlant);
  const original = g.plus('original-on', g.mul('original-kept', 'use-original', ownObject), g.mul('original-beside-band', g.mul('original-edge-rest', ditherEdge, g.sub('band-off', 'one', 'band')), ownObject));
  // A displaced piece lands only on object pixels, so it never spills onto the background.
  const shifted = g.mul('displaced-on', g.mul('displaced-on-object', 'use-displace', displacedObject), ownObject);
  // Shown colour and alpha (straight) of the four choices; a Paper dither dot counts as removed.
  // Dither dots in the pixel's own colour (Dot Colour: Original) or in Ink; Solid blocks are flat Ink.
  // Inner dither dots land only on object pixels; edge dots fill the band, beside the object in its colour.
  const innerDots = g.mul('dots-inner', g.mul('dots-inner-placed', ditherInner, ink), ownObject);
  const bandDots = g.mul('dots-band', g.mul('dots-band-placed', ditherEdge, ink), 'band');
  const slantDots = g.mul('dots-slant', g.mul('dots-slant-placed', g.mul('dots-slant-side', ditherSlant, 'slant-side'), ink), g.max('dots-slant-area', ownRaw, 'band'));
  const dots = g.plus('dots-on', g.plus('dots-edge', innerDots, bandDots), slantDots);
  const nearRgb = g.mixRgb('dot-near-rgb', 'band-rgb', own.rgb, ownRaw), nearAlpha = g.mix('dot-near-alpha', 'band-alpha', own.alpha, ownRaw);
  const dotRgb = g.mixRgb('dot-rgb', g.mixRgb('dot-rgb-flat', nearRgb, ['ink-rgb', 'rgb'], 'dots-ink'), ['paper-mark-rgb', 'rgb'], 'dots-mark');
  const dotAlpha = g.mix('dot-alpha', nearAlpha, 'one', 'dots-ink');
  const shownRgb = g.addRgb('shown-rgb', g.addRgb('shown-rgb-original', g.scaleRgb('original-part-rgb', own.rgb, original), g.scaleRgb('solid-part-rgb', ['ink-rgb', 'rgb'], 'use-solid')),
    g.addRgb('shown-rgb-pieces', g.scaleRgb('dot-part-rgb', dotRgb, dots), g.scaleRgb('displaced-part-rgb', displaced.rgb, shifted)));
  const shownAlpha = g.plus('shown-alpha', g.plus('shown-alpha-original', g.mul('original-part-alpha', own.alpha, original), 'use-solid'),
    g.plus('shown-alpha-pieces', g.mul('dot-part-alpha', dotAlpha, dots), g.mul('displaced-part-alpha', displaced.alpha, shifted)));
  // Removed: Paper lies under everything shown, so removed pixels and the see-through part of soft
  // (alpha) edges take the Paper colour; Transparent leaves them see-through.
  const open = g.max('paper-uncovered', g.sub('paper-open', 'one', shownAlpha), 'zero');
  // Paper Marks: dots or crosses on the removed area only (gridMarkNodes.ts), in Mark Colour; with
  // Removed: Transparent they stand alone on transparency.
  const markGrid = renderedPixels(g, 'paper-mark-grid-px', 'paper-mark-grid-clamped');
  const markSize = renderedPixels(g, 'paper-mark-size-px', 'paper-mark-size-clamped');
  const marked = g.mul('paper-mark-on', gridMarks(g, 'paper-mark', 'from-origin', markGrid, markSize, 'paper-marks-cross').shape, 'paper-marks-on');
  const paper = g.mul('paper-share', g.mul('paper-unmarked', open, g.sub('paper-not-marked', 'one', marked)), 'fill-paper');
  const mark = g.mul('paper-mark-share', open, marked);
  // Premultiplied: shown colour × its alpha + paper and marks × their share; then Amount mixes with the original.
  const premultiplied = g.addRgb('effect-premultiplied-rgb', g.add('shown-premultiplied', 'math.multiply.rgb-scalar', { a: shownRgb, b: shownAlpha }),
    g.addRgb('paper-and-marks', g.scaleRgb('paper-premultiplied', ['paper-rgb', 'rgb'], paper), g.scaleRgb('mark-premultiplied', ['paper-mark-rgb', 'rgb'], mark)));
  const effectAlpha = g.unary('effect-alpha', 'convert.scalar-to-alpha', g.plus('effect-coverage', shownAlpha, g.plus('paper-coverage', paper, mark)));
  g.add('effect-image', 'vector.combine.rgba', { rgb: premultiplied, alpha: [effectAlpha, 'alpha'] });
  g.add('effect-vec4', 'convert.image-to-vec4', { image: ['effect-image', 'image'] });
  g.add('original', 'image.sample', { image: ['source-cache', 'image'], uv: ['uv', 'uv'] });
  g.add('original-vec4', 'convert.image-to-vec4', { image: ['original', 'image'] });
  g.add('mixed', 'math.mix.vec4', { a: 'original-vec4', b: 'effect-vec4', t: 'amount-clamped' });
  g.add('mixed-image', 'convert.vec4-to-image', { value: 'mixed' });
  // Premultiplied → straight output; fully transparent pixels stay black.
  g.add('result-split', 'vector.split.rgba', { image: ['mixed-image', 'image'] });
  const resultAlpha = g.add('result-alpha', 'convert.alpha-to-scalar', { alpha: ['result-split', 'alpha'] });
  const straight = g.add('result-rgb', 'math.divide-ieee.rgb-scalar', { a: ['result-split', 'rgb'], b: g.max('result-safe-alpha', resultAlpha, 'coverage-floor') });
  g.add('result', 'vector.combine.rgba', { rgb: straight, alpha: ['result-split', 'alpha'] });
  g.add('output', 'image.output', { image: ['result', 'image'] });
  return g.graph(10);
}
