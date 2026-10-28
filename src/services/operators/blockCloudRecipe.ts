import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { chance, keyConstants, modulo, pixelScale, roll, seedSalt, KEY_RANGE, INDEX_OFFSET } from './seededRecipeParts';
import { coverageMask } from './coverageNodes';
import {
  BLOCK_CLOUD_CELL_RANGE, BLOCK_CLOUD_CLOUD_SIZE_RANGE, BLOCK_CLOUD_COLOR_SLOTS, BLOCK_CLOUD_COVERAGE_RANGE, BLOCK_CLOUD_LEVELS, BLOCK_CLOUD_MAX_COVER,
  BLOCK_CLOUD_OFFSET_RANGE, BLOCK_CLOUD_SEED_RANGE,
} from '../../effects/analog/blockCloudLimits';

/**
 * Block Cloud recipe (see docs/Features/effects/block-cloud.md): solid colour blocks on a grid that gather in
 * drifting clouds and clear away with Progress, after the textur-animation prototype overlay_pixel.py.
 * - Three levels of blocks on one grid (Cell Size, Offset X/Y in 1080p pixels): 2 × 2 cells, single cells and
 *   half cells, drawn big first, small on top (BLOCK_CLOUD_LEVELS).
 * - Each block reads a cloud value at its centre: two layers of smooth Fractal Noise drifting apart (Cloud Size
 *   cells per blob, Drift per second), plus a seeded per-block Jitter and Flicker (a sine per block at its own
 *   pace, Flicker Rate). A normal-CDF rank of that value (coverageNodes.ts) switches the block on, so each level
 *   covers a predictable share of the frame: its share × Coverage, with Pulse breathing it at Pulse Rate.
 * - Progress 1 → 0 (after Hold, which keeps the clouds whole for its share of the way): with Clear By Thin Out each level thins out (big blocks first, gone by 0.45, cells by 0.15,
 *   half cells at 0); with Wave Front a ragged front sweeps along Front Angle and clears everything behind it.
 * - Colour per block from Colours 1..Colour Count, chosen by a slow colour cloud so neighbours share colours;
 *   Recolour flickers single blocks to another colour, fading with Progress.
 * - Clip To Layer keeps the blocks inside the layer's alpha. Amount mixes; Progress 0 is the input exactly.
 */
const SALT = { jitter: 1, phase: 2, pace: 3, hue: 4, recolour: 5, recolourPick: 6 } as const;
/** Standard deviation of the mean of two 2-octave Fractal Noise samples (measured: 0.080 around 0.5). */
const CLOUD_NOISE_SPREAD = 0.0802;
/** The prototype's cloud field spread (mean of five cosines): Jitter and Flicker keep its units. */
const CLOUD_SPREAD = 0.316;
/** The colour cloud is this many times larger than the block clouds (the prototype's 0.05 against 0.09 waves). */
const HUE_CLOUD_FACTOR = 1.8;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('coverage-floor', 1e-6);
  g.splat2('half-vec2', 'half');
  keyConstants(g);
  g.mul2('pixel', ['uv', 'uv'], ['resolution', 'value']);
}

function controls(g: AnalogRecipeBuilder) {
  const scale = pixelScale(g);
  g.clampedParam('progress', 'progress', 'zero', 'one');
  // Hold keeps the clouds whole for the first share of the way from Progress 1 to 0, then they clear in the rest.
  g.clampedParam('hold', 'hold', 'zero', g.number('hold-max', .95));
  g.clamp('cleared', g.div('cleared-held', g.sub('cleared-after-hold', g.sub('cleared-raw', 'one', 'progress-clamped'), 'hold-clamped'),
    g.sub('hold-rest', 'one', 'hold-clamped')), 'zero', 'one');
  g.clampedParam('coverage', 'coverage', g.number('coverage-min', BLOCK_CLOUD_COVERAGE_RANGE[0]), g.number('coverage-max', BLOCK_CLOUD_COVERAGE_RANGE[1]));
  g.clampedParam('cell', 'cellSize', g.number('cell-min', BLOCK_CLOUD_CELL_RANGE[0]), g.number('cell-max', BLOCK_CLOUD_CELL_RANGE[1]));
  g.max('cell-px', g.mul('cell-scaled', 'cell-clamped', scale), 'one');
  for (const axis of ['x', 'y'] as const) {
    g.clampedParam(`offset-${axis}`, axis === 'x' ? 'offsetX' : 'offsetY', g.number(`offset-${axis}-min`, BLOCK_CLOUD_OFFSET_RANGE[0]), g.number(`offset-${axis}-max`, BLOCK_CLOUD_OFFSET_RANGE[1]));
  }
  g.scale2('grid-origin', g.vec2('grid-offset', 'offset-x-clamped', 'offset-y-clamped'), scale);
  g.clampedParam('cloud-size', 'cloudSize', g.number('cloud-size-min', BLOCK_CLOUD_CLOUD_SIZE_RANGE[0]), g.number('cloud-size-max', BLOCK_CLOUD_CLOUD_SIZE_RANGE[1]));
  g.clampedParam('jitter', 'jitter', 'zero', g.number('jitter-max', 2));
  g.clampedParam('flicker', 'flicker', 'zero', g.number('flicker-max', 2));
  g.clampedParam('recolour', 'recolor', 'zero', 'one');
  g.clampedParam('pulse', 'pulse', 'zero', 'one');
  g.clampedParam('roughness', 'frontRoughness', 'zero', 'one');
  g.clampedParam('seed', 'seed', g.number('seed-min', BLOCK_CLOUD_SEED_RANGE[0]), g.number('seed-max', BLOCK_CLOUD_SEED_RANGE[1]));
  g.clampedParam('amount', 'amount', 'zero', 'one');
  seedSalt(g);
  // Time × Rate directly, so keyframed rates move by their travelled distance (imageRateTravel.ts).
  g.max('drift-clock', g.mul('drift-time', 'time', g.bound('drift-rate', 'drift')), 'zero');
  g.max('flicker-clock', g.mul('flicker-time', 'time', g.bound('flicker-rate', 'flickerRate')), 'zero');
  g.max('pulse-clock', g.mul('pulse-time', 'time', g.bound('pulse-rate', 'pulseRate')), 'zero');
  modulo(g, 'flicker-step', g.fn('flicker-whole', 'floor', 'flicker-clock'), KEY_RANGE);
  // Clear By: Thin Out 0, Wave Front 1. Clip To: Layer 0, Whole Frame 1.
  g.add('wave', 'math.step.scalar', { edge: 'half', value: g.bound('clear-by', 'clearBy', 'values.choice') });
  g.sub('clip-layer', 'one', g.add('clip-frame', 'math.step.scalar', { edge: 'half', value: g.bound('clip-to', 'clipTo', 'values.choice') }));
  g.add('front-radians', 'convert.degrees-to-radians.scalar', { value: g.bound('front-angle', 'frontAngle') });
  g.clampedParam('colours', 'colorCount', 'one', g.number('colours-max', BLOCK_CLOUD_COLOR_SLOTS));
  g.fn('colour-count', 'floor', g.plus('colours-rounded', 'colours-clamped', 'half'));
  for (let slot = 1; slot <= BLOCK_CLOUD_COLOR_SLOTS; slot++) g.add(`colour-${slot}-rgb`, 'convert.vec4-to-rgb', { value: g.bound(`colour-${slot}`, `color${slot}`, 'values.color') });
  // Spread of the block value: cloud (prototype units) + uniform jitter + sine flicker.
  g.fn('value-spread', 'sqrt', g.plus('value-variance', g.number('cloud-variance', CLOUD_SPREAD * CLOUD_SPREAD),
    g.plus('noise-variance', g.div('jitter-variance', g.mul('jitter-squared', 'jitter-clamped', 'jitter-clamped'), g.number('twelve', 12)),
      g.mul('flicker-variance', g.mul('flicker-squared', 'flicker-clamped', 'flicker-clamped'), 'half'))));
  // Colour Scatter: the per-block share of the colour value (the prototype's 0.5 × random per block).
  g.clampedParam('scatter', 'colorScatter', 'zero', 'one');
  g.fn('hue-spread', 'sqrt', g.plus('hue-variance', g.number('hue-cloud-variance', CLOUD_SPREAD * CLOUD_SPREAD),
    g.div('hue-scatter-variance', g.mul('hue-scatter-squared', 'scatter-clamped', 'scatter-clamped'), 'twelve')));
}

/** Two drifting Fractal Noise layers at `at` (cells), normalised to the prototype's cloud spread around 0. */
function cloud(g: AnalogRecipeBuilder, p: string, at: GraphPort, clock: GraphPort, offset: number, sizeFactor = 1) {
  const scaled = g.scale2(`${p}-scaled`, at, g.div(`${p}-frequency`, 'one', sizeFactor === 1 ? 'cloud-size-clamped' : g.mul(`${p}-size`, 'cloud-size-clamped', g.number(`${p}-size-factor`, sizeFactor))));
  const seedShift = g.mul(`${p}-seed-shift`, 'seed-clamped', g.number(`${p}-seed-stride`, 7.31));
  const layer = (id: string, dx: number, dy: number, base: number) => g.add(`${p}-${id}`, 'noise.fractal2d.vec2', {
    value: g.add2(`${p}-${id}-at`, scaled, g.vec2(`${p}-${id}-move`, g.plus(`${p}-${id}-x`, g.mul(`${p}-${id}-dx`, clock, g.number(`${p}-${id}-vx`, dx)), g.plus(`${p}-${id}-sx`, seedShift, g.number(`${p}-${id}-bx`, base + offset))),
      g.plus(`${p}-${id}-y`, g.mul(`${p}-${id}-dy`, clock, g.number(`${p}-${id}-vy`, dy)), g.number(`${p}-${id}-by`, base * .7 - offset)))),
    octaves: 'two', roughness: 'half' });
  const mean = g.mul(`${p}-mean`, g.plus(`${p}-sum`, layer('a', .15, .08, 3.1), layer('b', -.11, .14, 101.3)), 'half');
  return g.mul(`${p}-value`, g.sub(`${p}-centred`, mean, 'half'), g.number(`${p}-normalise`, CLOUD_SPREAD / CLOUD_NOISE_SPREAD));
}

/** The palette colour `index` (0 .. count − 1): Colour 1..6. */
function paletteColour(g: AnalogRecipeBuilder, p: string, index: GraphPort): GraphPort {
  let colour: GraphPort = ['colour-1-rgb', 'rgb'];
  for (let slot = 2; slot <= BLOCK_CLOUD_COLOR_SLOTS; slot++) {
    colour = g.mixRgb(`${p}-pick${slot}`, colour, [`colour-${slot}-rgb`, 'rgb'], g.add(`${p}-is${slot}`, 'math.step.scalar', { edge: g.number(`${p}-from${slot}`, slot - 1.5), value: index }));
  }
  return colour;
}

/** One level: `${p}-on` (block drawn) and `${p}-rgb` (its colour). */
function level(g: AnalogRecipeBuilder, p: string, index: number) {
  const spec = BLOCK_CLOUD_LEVELS[index];
  const size = g.number(`${p}-size`, spec.size);
  const blockPx = g.mul(`${p}-block-px`, 'cell-px', size);
  const block = g.unary(`${p}-block`, 'math.floor.vec2', g.binary(`${p}-position`, 'math.divide-ieee.vec2', g.sub2(`${p}-from-origin`, 'pixel', 'grid-origin'), g.splat2(`${p}-block-vec2`, blockPx)));
  const [bx, by] = g.split2(`${p}-block-split`, block);
  const key = (axis: string, value: GraphPort) => modulo(g, `${p}-key-${axis}`, g.plus(`${p}-key-${axis}-shifted`, value, g.number(`${p}-key-${axis}-offset`, INDEX_OFFSET + index * 977)), KEY_RANGE);
  const kx = key('x', bx), ky = key('y', by);
  const rolled = (id: string, salt: number, state: GraphPort = 'zero') => roll(g, `${p}-${id}`, salt, kx, ky, state);
  // Block centre in cells.
  const centre = g.scale2(`${p}-centre`, g.add2(`${p}-centre-blocks`, block, 'half-vec2'), size);
  const field = cloud(g, `${p}-cloud`, centre, 'drift-clock', index * 37.7);
  const jitter = g.mul(`${p}-jitter`, g.sub(`${p}-jitter-centred`, rolled('jitter-roll', SALT.jitter), 'half'), 'jitter-clamped');
  // Flicker: a sine per block, at 0.5..1.5 × Flicker Rate, from its own phase.
  const pace = g.plus(`${p}-pace`, 'half', rolled('pace-roll', SALT.pace));
  const phase = g.mul(`${p}-phase`, rolled('phase-roll', SALT.phase), g.number(`${p}-tau`, Math.PI * 2));
  const flicker = g.mul(`${p}-flicker`, g.fn(`${p}-flicker-wave`, 'sin', g.plus(`${p}-flicker-angle`, phase, g.mul(`${p}-flicker-turns`, g.mul(`${p}-flicker-paced`, 'flicker-clock', pace), `${p}-tau`))), 'flicker-clamped');
  const value = g.plus(`${p}-value`, field, g.plus(`${p}-noise`, jitter, flicker));

  // Share covered: Thin Out falls (1 − smooth(cleared / end))^1.3; Wave Front holds 1.15 and sweeps.
  const life = g.smooth(`${p}-life`, 'zero', g.number(`${p}-end`, spec.end), 'cleared');
  const thin = g.add(`${p}-thin`, 'math.power.scalar', { a: g.sub(`${p}-left`, 'one', life), b: g.number(`${p}-thin-curve`, 1.3) });
  const share = g.mix(`${p}-share`, thin, g.number(`${p}-wave-share`, 1.15), 'wave');
  const breathing = g.plus(`${p}-breathing`, g.sub(`${p}-breath-low`, 'one', g.mul(`${p}-breath-depth`, 'pulse-clamped', 'half')),
    g.mul(`${p}-breath-wave`, g.mul(`${p}-breath-half`, 'pulse-clamped', 'half'), g.fn(`${p}-breath-cos`, 'cos', g.mul(`${p}-breath-angle`, 'pulse-clock', `${p}-tau`))));
  // Progress 0 (cleared 1) leaves nothing in Thin Out: life 1 → share 0.
  const target = g.min(`${p}-target`, g.mul(`${p}-target-raw`, g.mul(`${p}-target-share`, g.number(`${p}-cover`, spec.cover), share), g.mul(`${p}-target-scale`, 'coverage-clamped', breathing)),
    g.number(`${p}-max-cover`, BLOCK_CLOUD_MAX_COVER));
  const { on } = coverageMask(g, `${p}-cover-mask`, value, 'zero', 'value-spread', target);

  // Wave Front: the block's place across the frame along Front Angle (0..1) plus a ragged edge must lie ahead of the front.
  const centreUv = g.binary(`${p}-centre-uv`, 'math.divide-ieee.vec2', g.add2(`${p}-centre-px`, 'grid-origin', g.scale2(`${p}-centre-offset`, g.add2(`${p}-centre-b`, block, 'half-vec2'), blockPx)), ['resolution', 'value']);
  const along = g.plus(`${p}-along`, 'half', g.div(`${p}-along-raw`, g.add(`${p}-along-dot`, 'vector.dot.vec2', { a: g.sub2(`${p}-from-centre`, centreUv, 'half-vec2'), b: 'front-direction' }), 'front-span'));
  const ragged = g.mul(`${p}-ragged`, g.clamp(`${p}-edge`, g.div(`${p}-edge-raw`, value, 'value-spread'), g.number(`${p}-edge-min`, -1), 'one'), 'roughness-clamped');
  const front = g.plus(`${p}-front`, g.sub(`${p}-front-start`, 'zero', g.plus(`${p}-front-margin`, 'roughness-clamped', g.number(`${p}-front-pad`, .2))),
    g.mul(`${p}-front-travel`, g.smooth(`${p}-front-life`, 'zero', g.number(`${p}-front-end`, spec.end), 'cleared'), g.plus(`${p}-front-reach`, g.number(`${p}-front-base`, 1.4), g.mul(`${p}-front-twice`, 'roughness-clamped', 'two'))));
  const ahead = g.select(`${p}-ahead`, g.greater(`${p}-ahead-test`, g.plus(`${p}-ahead-at`, along, ragged), front), 'zero', 'one');
  g.mul(`${p}-on`, on, g.mix(`${p}-front-gate`, 'one', ahead, 'wave'));

  // Colour: a slow colour cloud plus a per-block share, ranked into Colour Count equal parts.
  const hueField = cloud(g, `${p}-hue-cloud`, centre, g.mul(`${p}-hue-clock`, 'drift-clock', g.number(`${p}-hue-pace`, .3)), 500 + index * 11.3, HUE_CLOUD_FACTOR);
  const hueValue = g.plus(`${p}-hue-value`, hueField, g.mul(`${p}-hue-jitter`, g.sub(`${p}-hue-centred`, rolled('hue-roll', SALT.hue), 'half'), 'scatter-clamped'));
  const { rank } = coverageMask(g, `${p}-hue-mask`, hueValue, 'zero', 'hue-spread', 'zero');
  const pick = (id: string, unit: GraphPort) => g.min(`${p}-${id}`, g.fn(`${p}-${id}-floor`, 'floor', g.mul(`${p}-${id}-scaled`, unit, 'colour-count')), g.sub(`${p}-${id}-last`, 'colour-count', 'one'));
  // Recolour: a seeded share of blocks per flicker step take a random colour, fading out as Progress falls.
  const recoloured = chance(g, `${p}-recolour`, rolled('recolour-roll', SALT.recolour, 'flicker-step'), g.mul(`${p}-recolour-share`, 'recolour-clamped', 'progress-clamped'));
  const index2 = g.mix(`${p}-colour-index`, pick('hue-index', rank), pick('random-index', rolled('recolour-pick', SALT.recolourPick, 'flicker-step')), recoloured);
  return { on: `${p}-on`, rgb: paletteColour(g, `${p}-palette`, index2) };
}

export function createDefaultBlockCloudGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g);
  g.vec2('front-direction', g.fn('front-cos', 'cos', 'front-radians'), g.fn('front-sin', 'sin', 'front-radians'));
  // |cos| + |sin| makes the projection of the frame's corners span exactly 0..1.
  g.max('front-span', g.plus('front-span-raw', g.fn('front-cos-abs', 'abs', 'front-cos'), g.fn('front-sin-abs', 'abs', 'front-sin')), g.number('front-span-floor', .001));
  let coverage: GraphPort = 'zero';
  let colour: GraphPort = ['colour-1-rgb', 'rgb'];
  BLOCK_CLOUD_LEVELS.forEach((spec, index) => {
    const { on, rgb } = level(g, `level-${spec.id}`, index);
    colour = g.mixRgb(`over-${spec.id}`, colour, rgb, on);
    coverage = g.max(`any-${spec.id}`, coverage, on);
  });
  g.add('original-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const alpha = g.add('original-alpha', 'convert.alpha-to-scalar', { alpha: ['original-split', 'alpha'] });
  const blockAlpha = g.mul('block-alpha', coverage, 'amount-clamped');
  // Layer: blocks inside the layer's alpha; Whole Frame: blocks over transparency too ("over" compositing).
  const outAlpha = g.mix('out-alpha', g.plus('over-alpha', blockAlpha, g.mul('under-alpha', alpha, g.sub('block-gap', 'one', blockAlpha))), alpha, 'clip-layer');
  const premultiplied = g.addRgb('over-rgb', g.scaleRgb('block-rgb', colour, g.mul('block-weight', blockAlpha, g.mix('block-clip', 'one', alpha, 'clip-layer'))),
    g.scaleRgb('under-rgb', ['original-split', 'rgb'], g.mul('under-weight', alpha, g.sub('under-gap', 'one', blockAlpha))));
  const straight = g.add('blocks-rgb', 'math.divide-ieee.rgb-scalar', { a: premultiplied, b: g.max('out-safe-alpha', outAlpha, 'coverage-floor') });
  g.add('blocks-image', 'vector.combine.rgba', { rgb: straight, alpha: [g.unary('blocks-alpha', 'convert.scalar-to-alpha', outAlpha), 'alpha'] });
  // Where no block is drawn the input passes untouched (exact).
  g.add('original-vec4', 'convert.image-to-vec4', { image: ['frame', 'image'] });
  g.add('blocks-vec4', 'convert.image-to-vec4', { image: ['blocks-image', 'image'] });
  g.add('result', 'convert.vec4-to-image', { value: g.add('result-vec4', 'math.mix.vec4', { a: 'original-vec4', b: 'blocks-vec4', t: g.add('any-block', 'math.step.scalar', { edge: g.number('block-edge', 1e-6), value: blockAlpha }) }) });
  g.add('output', 'image.output', { image: ['result', 'image'] });
  return g.graph(12);
}
