import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { chance, keyConstants, modulo, pixelScale, roll, seedSalt, INDEX_OFFSET, KEY_RANGE } from './seededRecipeParts';
import { curlNoise, gaussianPass, traceBack } from './flowFieldNodes';
import {
  FLOW_MOSH_CELL_RANGE, FLOW_MOSH_DISTANCE_RANGE, FLOW_MOSH_JUMP_CELLS, FLOW_MOSH_OFFSET_RANGE, FLOW_MOSH_SEED_RANGE, FLOW_MOSH_SLICE_CELLS,
  FLOW_MOSH_SMOOTHNESS_RANGE, FLOW_MOSH_SORT_RUN, FLOW_MOSH_SPEED_RANGE, FLOW_MOSH_STEPS, FLOW_MOSH_VORTEX_RADIUS, FLOW_MOSH_VORTICES, FLOW_MOSH_SWIRL_RANGE, FLOW_MOSH_TURBULENCE_START,
} from '../../effects/analog/flowMoshLimits';

/**
 * Flow Mosh recipe (see docs/Features/effects/flow-mosh.md): the picture flows along its own contours in
 * whole cells, after the textur-animation prototypes fluss_v2.py, glitch_v3.py and glitch_v4.py, as a stateless
 * effect of Progress.
 * - Flow field (cached at a quarter of the frame): a stream value (Brightness or Red – Green, alpha-weighted)
 *   blurred by Smoothness; flow runs along its contour lines (Along) where it has an edge, and in Drift
 *   Direction (Drift) where it is flat; Turbulence adds a curl-noise swirl of Swirl Size, growing with Progress.
 * - Every cell (Cell Size, Offset X/Y; Snap Cells) traces its streamline backwards for Progress × Distance in
 *   FLOW_MOSH_STEPS steps and copies the whole cell it lands in, so nothing gets finer than the cells.
 * - Particles: a seeded share of cells travels up to Particle Speed times as far; Trails: a seeded share copies
 *   from a random point of that path, leaving copies along the stream. Jumps: cells copy a cell up to 4 across
 *   and 2 along away; Slices: whole rows of cells shift sideways. Their shares grow with Progress.
 * - Vortices adds two counter-rotating whirls to the flow; Sort Rows sorts a seeded share of pixel rows in short
 *   runs by brightness after the mosh (Segment Sort).
 * - Shape Keep keeps the layer's alpha (where the flow brings in transparency the original stays); Move moves it.
 * - Progress 0 is the input exactly (the renderer skips it); Amount mixes.
 */
const SALT = { particle: 1, speed: 2, trail: 3, trailAt: 4, jump: 5, jumpX: 6, jumpY: 7, slice: 8, sliceBy: 9, sortRow: 10, sortShift: 11 } as const;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('tiny', 1e-6);
  g.splat2('half-vec2', 'half');
  keyConstants(g);
  g.unary('pixel', 'math.floor.vec2', g.mul2('pixel-centre', ['uv', 'uv'], ['resolution', 'value']));
}

function controls(g: AnalogRecipeBuilder) {
  pixelScale(g);
  g.clampedParam('progress', 'progress', 'zero', 'one');
  g.clampedParam('distance', 'distance', g.number('distance-min', FLOW_MOSH_DISTANCE_RANGE[0]), g.number('distance-max', FLOW_MOSH_DISTANCE_RANGE[1]));
  g.clampedParam('smoothness', 'smoothness', g.number('smoothness-min', FLOW_MOSH_SMOOTHNESS_RANGE[0]), g.number('smoothness-max', FLOW_MOSH_SMOOTHNESS_RANGE[1]));
  g.clampedParam('along', 'along', 'zero', g.number('along-max', 4));
  g.clampedParam('drift', 'drift', 'zero', g.number('drift-max', 4));
  g.clampedParam('edge-pull', 'edgePull', 'zero', g.number('edge-pull-max', 10));
  g.add('drift-radians', 'convert.degrees-to-radians.scalar', { value: g.bound('drift-angle', 'driftAngle') });
  g.vec2('drift-direction', g.fn('drift-cos', 'cos', 'drift-radians'), g.fn('drift-sin', 'sin', 'drift-radians'));
  g.clampedParam('vortices', 'vortices', 'zero', g.number('vortices-max', 4));
  g.clampedParam('sort-rows', 'sortRows', 'zero', 'one');
  g.clampedParam('turbulence', 'turbulence', 'zero', g.number('turbulence-max', 4));
  g.clampedParam('swirl', 'swirlSize', g.number('swirl-min', FLOW_MOSH_SWIRL_RANGE[0]), g.number('swirl-max', FLOW_MOSH_SWIRL_RANGE[1]));
  g.clampedParam('cell', 'cellSize', g.number('cell-min', FLOW_MOSH_CELL_RANGE[0]), g.number('cell-max', FLOW_MOSH_CELL_RANGE[1]));
  for (const axis of ['x', 'y'] as const) {
    g.clampedParam(`offset-${axis}`, axis === 'x' ? 'offsetX' : 'offsetY', g.number(`offset-${axis}-min`, FLOW_MOSH_OFFSET_RANGE[0]), g.number(`offset-${axis}-max`, FLOW_MOSH_OFFSET_RANGE[1]));
  }
  g.clampedParam('particles', 'particles', 'zero', 'one');
  g.clampedParam('speed', 'particleSpeed', g.number('speed-min', FLOW_MOSH_SPEED_RANGE[0]), g.number('speed-max', FLOW_MOSH_SPEED_RANGE[1]));
  g.clampedParam('trails', 'trails', 'zero', 'one');
  g.clampedParam('jumps', 'jumps', 'zero', 'one');
  g.clampedParam('slices', 'slices', 'zero', 'one');
  g.clampedParam('seed', 'seed', g.number('seed-min', FLOW_MOSH_SEED_RANGE[0]), g.number('seed-max', FLOW_MOSH_SEED_RANGE[1]));
  g.clampedParam('amount', 'amount', 'zero', 'one');
  seedSalt(g);
  // Flow From: Brightness 0, Red – Green 1. Snap: Cells 0, Pixels 1. Shape: Keep 0, Move 1.
  g.add('flow-red-green', 'math.step.scalar', { edge: 'half', value: g.bound('flow-from', 'flowFrom', 'values.choice') });
  g.add('snap-pixels', 'math.step.scalar', { edge: 'half', value: g.bound('snap', 'snap', 'values.choice') });
  g.add('shape-move', 'math.step.scalar', { edge: 'half', value: g.bound('shape', 'shape', 'values.choice') });
}

/** `flow-field`: a quarter-size cache whose RG is the flow direction (about unit length, plus turbulence). */
function flowField(g: AnalogRecipeBuilder) {
  // 1. Stream value × alpha and alpha, box-averaged 4 × 4 into a quarter-size cache.
  const [kx, ky] = g.split2('down-tap', g.add('down-index', 'image.kernel-index'));
  const texel = g.unary('down-texel', 'math.floor.vec2', g.mul2('down-texel-raw', ['uv', 'uv'], ['resolution', 'value']));
  const tapUv = g.binary('down-tap-uv', 'math.divide-ieee.vec2', g.add2('down-tap-at', texel,
    g.scale2('down-tap-offset', g.add2('down-tap-centre', g.vec2('down-tap-k', kx, ky), 'half-vec2'), g.number('quarter', .25))), ['resolution', 'value']);
  g.add('down-read', 'image.sample', { image: ['frame', 'image'], uv: tapUv });
  g.add('down-split', 'vector.split.rgba', { image: ['down-read', 'image'] });
  const alpha = g.add('down-alpha', 'convert.alpha-to-scalar', { alpha: ['down-split', 'alpha'] });
  const luma = g.add('down-luma', 'color.luminance-rec709.rgb', { rgb: ['down-split', 'rgb'] });
  g.add('down-components', 'vector.split.vec3', { value: g.add('down-vector', 'convert.rgb-to-vec3', { rgb: ['down-split', 'rgb'] }) });
  // Red – Green, about Lab a*: pink high, green low.
  const redGreen = g.plus('down-red-green', 'half', g.mul('down-red-green-half', g.sub('down-red-minus-green', ['down-components', 'x'], ['down-components', 'y']), 'half'));
  const stream = g.mix('down-stream', luma, redGreen, 'flow-red-green');
  const term = g.add('down-term', 'convert.vec4-to-image', { value: g.add('down-term-vec4', 'vector.combine.vec4', { x: g.mul('down-weighted', stream, alpha), y: alpha, z: 'zero', w: 'one' }) });
  const reduce = g.add('down-reduce', 'image.kernel-rect-reduce', { sample: [term, 'image'], weight: 'one', width: g.number('four', 4), height: 'four' });
  g.add('down-cache', 'image.materialize', { image: [g.add('down-mean', 'convert.vec4-to-image', { value: g.add('down-mean-vec4', 'math.divide-ieee.vec4',
    { a: [reduce, 'sum'], b: g.add('down-count', 'convert.scalar-to-vec4', { value: g.number('sixteen', 16) }) }) }), 'image'] }, { bindings: {}, constants: { scale: '0.25' } });
  // 2. Smoothness as a Gaussian in quarter-size texels (pixel-scale there is the quarter frame's).
  const sigma = g.mul('blur-sigma', 'smoothness-clamped', 'pixel-scale');
  g.add('blur-x-cache', 'image.materialize', { image: gaussianPass(g, 'blur-x', 'x', ['down-cache', 'image'], sigma) }, { bindings: {}, constants: { scale: '0.25' } });
  g.add('blur-cache', 'image.materialize', { image: gaussianPass(g, 'blur-y', 'y', ['blur-x-cache', 'image'], sigma) }, { bindings: {}, constants: { scale: '0.25' } });
  // 3. Flow: along the contour lines where the stream has an edge, in the drift direction where it is flat.
  const stream2 = (id: string, dx: number, dy: number) => {
    const at: GraphPort = dx || dy ? g.add2(`${id}-uv`, ['uv', 'uv'], g.binary(`${id}-step`, 'math.divide-ieee.vec2', g.vec2(`${id}-offset`, g.number(`${id}-dx`, dx), g.number(`${id}-dy`, dy)), ['resolution', 'value'])) : ['uv', 'uv'];
    g.add(`${id}-read`, 'image.sample', { image: ['blur-cache', 'image'], uv: at });
    g.add(`${id}-xyz`, 'vector.split.vec3', { value: g.add(`${id}-vector`, 'convert.rgb-to-vec3', { rgb: [g.add(`${id}-split`, 'vector.split.rgba', { image: [`${id}-read`, 'image'] }), 'rgb'] }) });
    return g.div(`${id}-value`, [`${id}-xyz`, 'x'], g.max(`${id}-coverage`, [`${id}-xyz`, 'y'], g.number(`${id}-floor`, 1e-3)));
  };
  // Central differences per 1080p pixel (one quarter texel is 1 / pixel-scale of them).
  const perPixel = g.mul('gradient-scale', 'half', 'pixel-scale');
  const gx = g.mul('gradient-x', g.sub('gradient-x-diff', stream2('east', 1, 0), stream2('west', -1, 0)), perPixel);
  const gy = g.mul('gradient-y', g.sub('gradient-y-diff', stream2('south', 0, 1), stream2('north', 0, -1)), perPixel);
  const magnitude = g.fn('gradient-length', 'sqrt', g.plus('gradient-length-squared', g.mul('gx-squared', gx, gx), g.mul('gy-squared', gy, gy)));
  // Edge weight: gradient per 100 px × Edge Pull, at most 1.
  const weight = g.min('edge-weight', g.mul('edge-weight-raw', g.mul('gradient-100', magnitude, g.number('hundred', 100)), 'edge-pull-clamped'), 'one');
  const tangent = g.vec2('tangent', gy, g.sub('tangent-y', 'zero', gx));
  const unitTangent = g.scale2('tangent-unit', tangent, g.div('tangent-inverse', 'one', g.max('tangent-safe', magnitude, 'tiny')));
  // Contours flow the way that agrees with the drift.
  const agrees = g.add('tangent-agrees', 'vector.dot.vec2', { a: unitTangent, b: 'drift-direction' });
  const flip = g.select('tangent-flip', g.greater('tangent-backwards', 'zero', agrees), 'one', g.number('minus-one', -1));
  const contour = g.scale2('contour-flow', unitTangent, g.mul('contour-strength', g.mul('contour-weight', 'along-clamped', weight), flip));
  const drifting = g.scale2('drift-flow', 'drift-direction', g.mul('drift-strength', 'drift-clamped', g.sub('flat', 'one', weight)));
  // Vortices: two counter-rotating whirls (fluss_v2.py "wirbel"), Gaussian falloff of FLOW_MOSH_VORTICES radius.
  const flowPixel = g.mul2('vortex-pixel', ['uv', 'uv'], ['resolution', 'value']);
  const [frameWidth] = g.split2('vortex-frame', ['resolution', 'value']);
  const radius = g.mul('vortex-radius', frameWidth, g.number('vortex-radius-share', FLOW_MOSH_VORTEX_RADIUS));
  let whirl: GraphPort = g.vec2('vortex-none', 'zero', 'zero');
  FLOW_MOSH_VORTICES.forEach(([vx, vy, spin], index) => {
    const id = `vortex-${index}`;
    const [rx, ry] = g.split2(`${id}-offset`, g.sub2(`${id}-from`, flowPixel, g.mul2(`${id}-centre`, g.vec2(`${id}-at`, g.number(`${id}-x`, vx), g.number(`${id}-y`, vy)), ['resolution', 'value'])));
    const r2 = g.plus(`${id}-r2`, g.mul(`${id}-rx2`, rx, rx), g.mul(`${id}-ry2`, ry, ry));
    const fall = g.mul(`${id}-fall`, g.fn(`${id}-gauss`, 'exp', g.div(`${id}-exponent`, g.sub(`${id}-negative`, 'zero', r2), g.mul(`${id}-two-r2`, g.mul(`${id}-rr`, radius, radius), 'two'))),
      g.number(`${id}-gain`, 2.2 * spin));
    const inverse = g.div(`${id}-inverse`, fall, g.fn(`${id}-distance`, 'sqrt', g.plus(`${id}-soft`, r2, g.number(`${id}-core`, 25))));
    whirl = g.add2(`${id}-sum`, whirl, g.scale2(`${id}-turn`, g.vec2(`${id}-tangent`, g.sub(`${id}-minus-ry`, 'zero', ry), rx), inverse));
  });
  const base = g.add2('base-flow', g.add2('base-flow-raw', contour, drifting), g.scale2('vortex-flow', whirl, 'vortices-clamped'));
  const baseLength = g.fn('base-length', 'sqrt', g.add('base-length-squared', 'vector.dot.vec2', { a: base, b: base }));
  const unitBase = g.scale2('base-unit', base, g.div('base-inverse', 'one', g.max('base-safe', baseLength, 'tiny')));
  // Turbulence grows from FLOW_MOSH_TURBULENCE_START to 1 × Turbulence with Progress.
  const swirlAt = g.scale2('swirl-at', g.mul2('swirl-pixel', ['uv', 'uv'], ['resolution', 'value']), g.div('swirl-frequency', 'one', g.mul('swirl-texels', 'swirl-clamped', 'pixel-scale')));
  const seeded = g.add2('swirl-seeded', swirlAt, g.splat2('swirl-seed', g.mul('swirl-seed-shift', 'seed-clamped', g.number('swirl-seed-stride', 13.17))));
  const growth = g.plus('turbulence-growth', g.number('turbulence-start', FLOW_MOSH_TURBULENCE_START), g.mul('turbulence-grown', g.number('turbulence-rise', 1 - FLOW_MOSH_TURBULENCE_START), 'progress-clamped'));
  const swirl = g.scale2('swirl-flow', curlNoise(g, 'swirl', seeded), g.mul('swirl-strength', 'turbulence-clamped', growth));
  const [fx, fy] = g.split2('flow-split', g.add2('flow', unitBase, swirl));
  g.add('flow-field', 'image.materialize', { image: [g.add('flow-image', 'convert.vec4-to-image', { value: g.add('flow-vec4', 'vector.combine.vec4', { x: fx, y: fy, z: 'zero', w: 'one' }) }), 'image'] },
    { bindings: {}, constants: { scale: '0.25' } });
}

/** `source-pixel`: the pixel each output pixel copies, from its cell's traced, snapped and glitched offset. */
function cells(g: AnalogRecipeBuilder) {
  const scale = pixelScale(g);
  const cellPx = g.mix('cell-px', g.max('cell-scaled', g.mul('cell-scaled-raw', 'cell-clamped', scale), 'one'), 'one', 'snap-pixels');
  g.splat2('cell-vec2', cellPx);
  const origin = g.scale2('grid-origin', g.vec2('grid-offset', 'offset-x-clamped', 'offset-y-clamped'), scale);
  const cell = g.unary('cell-index', 'math.floor.vec2', g.binary('cell-position', 'math.divide-ieee.vec2', g.sub2('cell-from-origin', 'pixel', origin), 'cell-vec2'));
  const centre = g.add2('cell-centre', origin, g.mul2('cell-centre-offset', g.add2('cell-centre-index', cell, 'half-vec2'), 'cell-vec2'));
  const [cx, cy] = g.split2('cell-split', cell);
  const key = (axis: string, value: GraphPort) => modulo(g, `cell-key-${axis}`, g.plus(`cell-key-${axis}-shifted`, value, g.number(`cell-key-${axis}-offset`, INDEX_OFFSET)), KEY_RANGE);
  const kx = key('x', cx), ky = key('y', cy);
  const rolled = (id: string, salt: number, x: GraphPort = kx, y: GraphPort = ky) => roll(g, id, salt, x, y, 'zero');
  // Particles travel up to Particle Speed times as far; Trails copy from a random point of that path.
  const particle = chance(g, 'particle', rolled('particle-roll', SALT.particle), 'particles-clamped');
  const pace = g.plus('particle-pace', 'one', g.mul('particle-extra', g.sub('speed-extra', 'speed-clamped', 'one'),
    g.add('particle-pace-curve', 'math.power.scalar', { a: rolled('speed-roll', SALT.speed), b: g.number('pace-curve', 1.5) })));
  const trail = chance(g, 'trail', rolled('trail-roll', SALT.trail), 'trails-clamped');
  const reach = g.mix('reach', 'one', g.mix('reach-particle', pace, g.mul('reach-trail', pace, rolled('trail-at', SALT.trailAt)), trail), particle);
  const distance = g.mul('trace-distance', g.mul('trace-progress', g.mul('distance-px', 'distance-clamped', scale), 'progress-clamped'), reach);
  const end = traceBack(g, 'trace', 'flow-field', centre, distance, FLOW_MOSH_STEPS);
  // Whole cells (or whole pixels with Snap Pixels).
  const offset = g.mul2('cell-offset', g.unary('cell-steps', 'math.floor.vec2', g.add2('cell-steps-rounded',
    g.binary('cell-steps-raw', 'math.divide-ieee.vec2', g.sub2('trace-offset', end, centre), 'cell-vec2'), 'half-vec2')), 'cell-vec2');
  // Jumps: a cell copies one up to 4 across and 2 along away. Slices: a row of cells shifts up to 10 cells.
  const signedCells = (id: string, salt: number, range: number, x: GraphPort = kx, y: GraphPort = ky) => g.fn(`${id}-cells`, 'floor',
    g.plus(`${id}-rounded`, g.mul(`${id}-span`, g.sub(`${id}-centred`, rolled(`${id}-roll`, salt, x, y), 'half'), g.number(`${id}-width`, 2 * range + 1)), 'half'));
  const jumped = chance(g, 'jump', rolled('jump-roll', SALT.jump), g.mul('jump-share', 'jumps-clamped', 'progress-clamped'));
  const jump = g.scale2('jump-offset', g.mul2('jump-cells', g.vec2('jump-vector', signedCells('jump-x', SALT.jumpX, FLOW_MOSH_JUMP_CELLS[0]), signedCells('jump-y', SALT.jumpY, FLOW_MOSH_JUMP_CELLS[1])), 'cell-vec2'), jumped);
  const sliced = chance(g, 'slice', rolled('slice-roll', SALT.slice, 'zero', ky), g.mul('slice-share', 'slices-clamped', 'progress-clamped'));
  const slice = g.vec2('slice-offset', g.mul('slice-px', g.mul('slice-cells', signedCells('slice-by', SALT.sliceBy, FLOW_MOSH_SLICE_CELLS, 'zero', ky), cellPx), sliced), 'zero');
  const moved = g.unary('moved', 'math.floor.vec2', g.add2('moved-rounded', g.add2('moved-raw', g.add2('moved-cell', 'pixel', offset), g.add2('moved-glitch', jump, slice)), 'half-vec2'));
  // Mirror at the frame edges on whole pixels (inside the frame the pixel stays exact).
  const [mx, my] = g.split2('moved-xy', moved);
  const [w, h] = g.split2('resolution-split', ['resolution', 'value']);
  const mirror = (id: string, value: GraphPort, size: GraphPort) => {
    const low = g.select(`${id}-low`, g.greater(`${id}-below`, 'zero', value), value, g.sub(`${id}-reflected-low`, g.sub(`${id}-negated`, 'zero', value), 'one'));
    const last = g.sub(`${id}-last`, size, 'one');
    const high = g.select(`${id}-high`, g.greater(`${id}-above`, low, last), low, g.sub(`${id}-reflected-high`, g.mul(`${id}-twice`, size, 'two'), g.plus(`${id}-plus-one`, low, 'one')));
    return g.clamp(`${id}-clamped`, high, 'zero', last);
  };
  g.vec2('source-pixel', mirror('source-x', mx, w), mirror('source-y', my, h));
}

export function createDefaultFlowMoshGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g); flowField(g); cells(g);
  const uv = g.binary('source-uv', 'math.divide-ieee.vec2', g.add2('source-centre', 'source-pixel', 'half-vec2'), ['resolution', 'value']);
  g.add('moved-read', 'image.sample', { image: ['frame', 'image'], uv });
  g.add('moved-split', 'vector.split.rgba', { image: ['moved-read', 'image'] });
  g.add('original-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const movedAlpha = g.add('moved-alpha', 'convert.alpha-to-scalar', { alpha: ['moved-split', 'alpha'] });
  // Keep: the layer's alpha stays and the colour moves where it brings in a visible pixel. Move: alpha moves too.
  const visible = g.add('moved-visible', 'math.step.scalar', { edge: 'half', value: movedAlpha });
  const takes = g.max('takes-moved', visible, 'shape-move');
  const rgb = g.mixRgb('result-rgb', ['original-split', 'rgb'], ['moved-split', 'rgb'], g.mul('takes-mixed', takes, 'amount-clamped'));
  const alpha = g.mix('result-alpha', g.add('original-alpha', 'convert.alpha-to-scalar', { alpha: ['original-split', 'alpha'] }), movedAlpha, g.mul('alpha-moves', 'shape-move', 'amount-clamped'));
  g.add('result', 'vector.combine.rgba', { rgb, alpha: [g.unary('result-alpha-port', 'convert.scalar-to-alpha', alpha), 'alpha'] });
  // Sort Rows (glitch_v3.py "sort"): a seeded share of pixel rows sorts in runs of FLOW_MOSH_SORT_RUN by brightness.
  // At 0 the Switch folds at compile time, so the sort passes are never built.
  g.add('mosh-cache', 'image.materialize', { image: ['result', 'image'] });
  const [sx, sy] = g.split2('sort-pixel', 'pixel');
  const runPx = g.max('sort-run-px', g.fn('sort-run-whole', 'floor', g.mul('sort-run-scaled', g.number('sort-run', FLOW_MOSH_SORT_RUN), 'pixel-scale')), 'two');
  const rowKey = modulo(g, 'sort-row-key', g.plus('sort-row-shifted', sy, g.number('sort-row-offset', INDEX_OFFSET)), KEY_RANGE);
  // Each row breaks its runs at its own seeded offset, so the run seams never line up into columns.
  const rowShift = g.fn('sort-row-shift', 'floor', g.mul('sort-row-shift-raw', roll(g, 'sort-shift-roll', SALT.sortShift, 'zero', rowKey, 'zero'), runPx));
  const runStart = g.sub('sort-run-edge', 'one', g.add('sort-run-inside', 'math.step.scalar', { edge: 'half', value: modulo(g, 'sort-run-position', g.plus('sort-run-shifted', sx, rowShift), runPx) }));
  const rowSorts = chance(g, 'sort-row', roll(g, 'sort-row-roll', SALT.sortRow, 'zero', rowKey, 'zero'), g.mul('sort-row-share', 'sort-rows-clamped', 'progress-clamped'));
  g.add('mosh-here', 'image.sample', { image: ['mosh-cache', 'image'], uv: ['uv', 'uv'] });
  const key = g.add('sort-key', 'color.luminance-rec709.rgb', { rgb: [g.add('mosh-split', 'vector.split.rgba', { image: ['mosh-here', 'image'] }), 'rgb'] });
  // Runs also break where visibility changes, so transparency never sorts into the layer (or out of it).
  const visibleAt = (id: string, image: string) => g.add(`${id}-visible`, 'math.step.scalar', { edge: 'half',
    value: g.add(`${id}-alpha`, 'convert.alpha-to-scalar', { alpha: [g.add(`${id}-alpha-split`, 'vector.split.rgba', { image: [image, 'image'] }), 'alpha'] }) });
  g.add('mosh-left', 'image.sample', { image: ['mosh-cache', 'image'], uv: g.sub2('mosh-left-uv', ['uv', 'uv'],
    g.binary('mosh-left-step', 'math.divide-ieee.vec2', g.vec2('mosh-left-offset', 'one', 'zero'), ['resolution', 'value'])) });
  const edge = g.fn('sort-visibility-edge', 'abs', g.sub('sort-visibility-change', visibleAt('mosh-here', 'mosh-here'), visibleAt('mosh-left', 'mosh-left')));
  const breaks = g.max('sort-breaks', g.max('sort-break-runs', g.sub('sort-row-off', 'one', rowSorts), runStart), edge);
  g.add('row-sort', 'image.segment-sort-axis', { image: ['mosh-cache', 'image'], key, start: breaks },
    { bindings: {}, constants: { axis: 'rows', order: 'ascending' } });
  g.add('sorted-here', 'image.sample', { image: ['row-sort', 'image'], uv: ['uv', 'uv'] });
  g.add('final', 'control.select.image', { condition: g.greater('sort-rows-on', 'sort-rows-clamped', 'zero'), falseValue: ['result', 'image'], trueValue: ['sorted-here', 'image'] });
  g.add('output', 'image.output', { image: ['final', 'image'] });
  return g.graph(12);
}
