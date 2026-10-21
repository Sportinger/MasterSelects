import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { GLITCH_BAND_RANGE, GLITCH_SEED_RANGE, GLITCH_STATE_CYCLE, GLITCH_STATES_PER_SECOND } from '../../effects/analog/glitchLimits';

/**
 * Glitch recipe (see docs/Features/Effects-Analog.md). A seeded digital signal failure that
 * changes GLITCH_STATES_PER_SECOND x Speed times per second of timeline time (Speed 0 freezes it):
 * - Bursts: each state is glitched or clean; Density sets how many states glitch (1 = all) and
 *   how much of the frame breaks up. Intensity scales every displacement.
 * - Tears: Bands rows over the frame height, each split at a random height into two rows of
 *   uneven size; torn rows shift sideways (up to 15 % of the width) and wrap around the frame,
 *   plus thin slices that jitter by up to 2 %.
 * - Blocks: square blocks (Bands rows of them) are copied from another place by whole blocks (the
 *   offset rounds to the nearest block, so a faint Intensity moves nothing); about one in ten of
 *   them reads from further away and half-rotates its colour channels, scaled with the burst.
 * - RGB Split: red and blue read from either side of green, wider inside torn rows and blocks.
 * Every read lands on a texel centre, so the picture stays sharp and transparent pixels never
 * bleed; alpha moves with the displaced pixels.
 * Random keys are exact integers below 2^24 (seed and state folded by integer modulo, integer
 * salts), so the GPU (f32) and the CPU worker path (f64) hash the same bits.
 */
/** Distinct roll kinds: integer salts in the key's y component (each kind's own range of 2^18). */
const SALT = { burst: 1, strength: 2, cut: 3, tear: 4, tearOffset: 5, slice: 6, sliceOffset: 7, block: 8, blockX: 9, blockY: 10, swap: 11 } as const;
const SALT_STRIDE = 262144;
/** The folded seed multiplies into the key's x component; every x term stays below this stride. */
const SEED_STRIDE = 8192;
/** The seed folds into [0, SEED_KEYS): with SEED_STRIDE it keeps keys below 2^23. */
const SEED_KEYS = 509;
function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('coverage-floor', 1e-6);
  g.split2('uv-split', ['uv', 'uv']);
  g.split2('resolution-split', ['resolution', 'value']);
  g.splat2('half-vec2', 'half');
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('density', 'density', 'zero', 'one');
  g.clampedParam('bands', 'bands', g.number('bands-min', GLITCH_BAND_RANGE[0]), g.number('bands-max', GLITCH_BAND_RANGE[1]));
  g.clampedParam('split', 'split', 'zero', g.number('split-max', 2));
  g.clampedParam('seed', 'seed', g.number('seed-min', GLITCH_SEED_RANGE[0]), g.number('seed-max', GLITCH_SEED_RANGE[1]));
  g.bound('speed', 'speed');
}

/**
 * hash2d of the exact integer key vec2(a + seed * SEED_STRIDE, b + kind * SALT_STRIDE), uniform in
 * [0, 1). `a` stays below SEED_STRIDE and `b` below SALT_STRIDE, so no two kinds or seeds share keys.
 */
function roll(g: AnalogRecipeBuilder, id: string, kind: keyof typeof SALT, a: GraphPort, b: GraphPort) {
  const x = g.plus(`${id}-key-x`, a, 'state-seed-key');
  const y = g.plus(`${id}-key-y`, b, g.number(`${id}-salt`, SALT[kind] * SALT_STRIDE));
  return g.hash(id, g.vec2(`${id}-key`, x, y));
}

/** value mod divisor for non-negative integers, robust to the GPU's approximate division. */
function modulo(g: AnalogRecipeBuilder, id: string, value: GraphPort, divisor: number) {
  const d = g.number(`${id}-divisor`, divisor);
  const quotient = g.fn(`${id}-quotient`, 'floor', g.div(`${id}-ratio`, g.plus(`${id}-rounded`, value, 'half'), d));
  return g.sub(id, value, g.mul(`${id}-multiple`, quotient, d));
}

/** 1 when `rolled` < `probability` (strict, so probability 0 never fires, not even where the hash is exactly 0), else 0. */
function chance(g: AnalogRecipeBuilder, id: string, rolled: GraphPort, probability: GraphPort) {
  return g.select(id, g.greater(`${id}-hit`, probability, rolled), 'zero', 'one');
}

/** The glitch state (`state-tick`), the seed key, whether the state glitches and its strength (`state-level`). */
function state(g: AnalogRecipeBuilder) {
  const step = g.fn('state-step', 'floor', g.mul('state-clock', g.mul('state-time', 'time', 'speed'), g.number('state-rate', GLITCH_STATES_PER_SECOND)));
  // The state counts within a cycle of GLITCH_STATE_CYCLE states; every new cycle shifts the seed
  // key, so cycles differ. Seed and cycle fold into [0, SEED_KEYS) by integer modulo.
  const cycle = g.number('state-cycle', GLITCH_STATE_CYCLE);
  const cycles = g.fn('state-cycle-count', 'floor', g.div('state-cycle-position', step, cycle));
  g.sub('state-tick', step, g.mul('state-cycles', cycles, cycle));
  const tick = 'state-tick';
  const seed = g.fn('state-seed-whole', 'floor', 'seed-clamped');
  const mixed = g.plus('state-seed-mixed', g.mul('state-seed-spread', seed, g.number('state-seed-step', 37)), g.mul('state-cycle-shift', cycles, g.number('state-cycle-step', 61)));
  modulo(g, 'state-seed', mixed, SEED_KEYS);
  g.mul('state-seed-key', 'state-seed', g.number('state-seed-stride', SEED_STRIDE));
  const burstChance = g.plus('state-burst-chance', g.number('state-burst-base', .2), g.mul('state-burst-density', 'density-clamped', g.number('state-burst-range', .8)));
  const burst = chance(g, 'state-burst', roll(g, 'state-burst-roll', 'burst', tick, 'zero'), burstChance);
  const strength = g.plus('state-strength', g.number('state-strength-base', .35), g.mul('state-strength-roll-scaled',
    roll(g, 'state-strength-roll', 'strength', tick, 'zero'), g.number('state-strength-range', .65)));
  g.mul('state-level', g.mul('state-level-burst', 'amount-clamped', burst), strength);
}

/** Sideways tear of the row (`tear-shift`, frame widths) and whether the row tore (`tear-active`). */
function tears(g: AnalogRecipeBuilder) {
  const [, y] = [['uv-split', 'x'], ['uv-split', 'y']] as const;
  const position = g.mul('tear-position', y, 'bands-clamped');
  const row = g.fn('tear-row', 'floor', position), within = g.fn('tear-within', 'fract', position);
  const cut = roll(g, 'tear-cut', 'cut', row, 'state-tick');
  const lower = g.add('tear-lower', 'math.step.scalar', { edge: cut, value: within });
  const band = g.plus('tear-band', g.mul('tear-band-row', row, g.number('two', 2)), lower);
  const active = chance(g, 'tear-active', roll(g, 'tear-roll', 'tear', band, 'state-tick'), 'density-clamped');
  const offset = g.sub('tear-offset', roll(g, 'tear-offset-roll', 'tearOffset', band, 'state-tick'), 'half');
  const coarse = g.mul('tear-coarse', g.mul('tear-coarse-level', offset, 'state-level'), g.mul('tear-coarse-active', active, g.number('tear-reach', .3)));
  const slice = g.fn('tear-slice', 'floor', g.mul('tear-slice-position', position, g.number('tear-slice-ratio', 4.7)));
  const sliceActive = chance(g, 'tear-slice-active', roll(g, 'tear-slice-roll', 'slice', slice, 'state-tick'), g.mul('tear-slice-density', 'density-clamped', 'half'));
  const sliceOffset = g.sub('tear-slice-offset', roll(g, 'tear-slice-offset-roll', 'sliceOffset', slice, 'state-tick'), 'half');
  const fine = g.mul('tear-fine', g.mul('tear-fine-level', sliceOffset, 'state-level'), g.mul('tear-fine-active', sliceActive, g.number('tear-fine-reach', .04)));
  g.plus('tear-shift', coarse, fine);
}

/** Whole-block copy offset (`block-offset`, UV), block activity and channel rotation (`block-rotate`, 0 to 0.5). */
function blocks(g: AnalogRecipeBuilder) {
  const rows = 'bands-clamped';
  const columns = g.mul('block-columns', rows, g.div('block-aspect', ['resolution-split', 'x'], ['resolution-split', 'y']));
  const grid = g.vec2('block-grid', columns, rows);
  const [cx, cy] = g.split2('block-cell', g.unary('block-cell-floor', 'math.floor.vec2', g.mul2('block-cell-position', ['uv', 'uv'], grid)));
  // Block keys: column in x, row plus 256 x state in y (rows stay below 256, states below 1024).
  const cellKey = g.plus('block-cell-key', cy, g.mul('block-tick-key', 'state-tick', g.number('block-tick-stride', 256)));
  const live = g.greater('block-live', 'state-level', g.number('block-live-threshold', 1e-3));
  const probability = g.select('block-chance', live, 'zero', g.mul('block-density', 'density-clamped', g.number('block-share', .08)));
  const active = chance(g, 'block-active', roll(g, 'block-roll', 'block', cx, cellKey), probability);
  const swap = chance(g, 'block-swap', roll(g, 'block-swap-roll', 'swap', cx, cellKey), g.number('block-swap-share', .1));
  // Swapped blocks travel four times as far, so they carry texture from elsewhere instead of tinting their own place.
  const travel = g.plus('block-travel', 'one', g.mul('block-travel-swap', swap, g.number('block-swap-travel', 3)));
  const reach = g.mul('block-reach', g.mul('block-reach-level', g.mul('block-reach-burst', 'state-level', active), travel), g.number('block-reach-scale', .25));
  const dx = g.mul('block-dx', g.sub('block-dx-centred', roll(g, 'block-dx-roll', 'blockX', cx, cellKey), 'half'), reach);
  const dy = g.mul('block-dy', g.sub('block-dy-centred', roll(g, 'block-dy-roll', 'blockY', cx, cellKey), 'half'), reach);
  // Whole blocks: the offset rounds to the nearest block, so a small offset moves nothing.
  const cells = g.unary('block-offset-cells', 'math.floor.vec2', g.add2('block-offset-rounded',
    g.mul2('block-offset-grid', g.vec2('block-offset-raw', dx, dy), grid), 'half-vec2'));
  g.binary('block-offset', 'math.divide-ieee.vec2', cells, grid);
  // Rotation share follows the burst: half at full strength (hue shifts, not flat placeholder tiles).
  const rotation = g.mul('block-rotation', g.smooth('block-rotation-level', 'zero', g.number('block-rotation-full', .35), 'state-level'), 'half');
  g.mul('block-rotate', g.mul('block-rotate-active', swap, active), rotation);
  return active;
}

/** Texel-centre read of the frame at a wrapped UV; returns its split. */
function read(g: AnalogRecipeBuilder, id: string, uv: GraphPort) {
  const wrapped = g.unary(`${id}-wrapped`, 'math.fract.vec2', uv);
  const texel = g.unary(`${id}-texel`, 'math.floor.vec2', g.mul2(`${id}-pixel`, wrapped, ['resolution', 'value']));
  const centre = g.binary(`${id}-uv`, 'math.divide-ieee.vec2', g.add2(`${id}-centre`, texel, 'half-vec2'), ['resolution', 'value']);
  g.add(`${id}-sample`, 'image.sample', { image: ['frame', 'image'], uv: centre });
  return g.add(`${id}-split`, 'vector.split.rgba', { image: [`${id}-sample`, 'image'] });
}

export function createDefaultGlitchGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g); state(g); tears(g);
  const blockActive = blocks(g);
  const torn = g.add2('read-uv', g.vec2('read-tear', g.plus('read-x', ['uv-split', 'x'], 'tear-shift'), ['uv-split', 'y']), 'block-offset');
  const spread = g.plus('split-spread', g.number('split-base', .004), g.mul('split-glitched', g.plus('split-zones', 'tear-active', g.mul('split-block-share', blockActive, 'half')), g.number('split-zone-width', .02)));
  const offset = g.mul('split-offset', g.mul('split-level', 'split-clamped', 'state-level'), spread);
  const shift = g.vec2('split-shift', offset, 'zero');
  const red = read(g, 'red', g.add2('red-read-uv', torn, shift)), green = read(g, 'green', torn), blue = read(g, 'blue', g.sub2('blue-read-uv', torn, shift));
  // Each channel brings its own coverage: premultiply per channel, then divide by the widest alpha.
  const alpha = (id: string) => g.add(`${id}-alpha`, 'convert.alpha-to-scalar', { alpha: [id === 'red' ? red : id === 'green' ? green : blue, 'alpha'] });
  const [ra, ga, ba] = [alpha('red'), alpha('green'), alpha('blue')];
  const channel = (id: string, split: string, index: 'x' | 'y' | 'z', coverage: string) => {
    g.add(`${id}-vector`, 'convert.rgb-to-vec3', { rgb: [split, 'rgb'] });
    g.add(`${id}-components`, 'vector.split.vec3', { value: `${id}-vector` });
    return g.mul(`${id}-premultiplied`, [`${id}-components`, index], coverage);
  };
  const r = channel('red', red, 'x', ra), gr = channel('green', green, 'y', ga), b = channel('blue', blue, 'z', ba);
  const coverage = g.max('finish-alpha', g.max('finish-alpha-rg', ra, ga), ba);
  const safe = g.max('finish-safe-alpha', coverage, 'coverage-floor');
  // Rotated blocks read red from green, green from blue and blue from red.
  const rotated = g.rgb3('finish-rotated', g.mix('finish-r', r, gr, 'block-rotate'), g.mix('finish-g', gr, b, 'block-rotate'), g.mix('finish-b', b, r, 'block-rotate'));
  const rgb = g.add('finish-rgb', 'math.divide-ieee.rgb-scalar', { a: rotated, b: safe });
  const alphaPort = g.unary('finish-alpha-value', 'convert.scalar-to-alpha', coverage);
  g.add('finish', 'vector.combine.rgba', { rgb, alpha: [alphaPort, 'alpha'] });
  g.add('output', 'image.output', { image: ['finish', 'image'] });
  return g.graph(10);
}
