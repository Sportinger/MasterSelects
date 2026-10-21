import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { BlurGraphBuilder, premultipliedSourceCache, type GraphPort } from './blurGraphBuilder';

/**
 * Acuarela watercolour recipe (see docs/Features/Effects-Stylize-Art.md). Three passes:
 *
 * 1. `source-cache`: the frame premultiplied into an rgba16float cache, so every filtered read
 *    below mixes premultiplied texels (clean colour at transparent edges).
 * 2. `wash-cache`: the pigment wash. An edge-aware (bilateral) 7 x 7 kernel around the read
 *    position flattens colour inside shapes and keeps their borders. The read position wobbles by
 *    up to Bleed pixels (two Fractal Noise fields), and inside "wet" patches (a third, slow noise
 *    field) the kernel widens 2.5x and lets colour cross edges (wet-in-wet bleeding).
 *    Kernel: taps at 0.6 sigma spacing, sigma = Wash px; weight = exp(-0.18 |k|^2 - |dc|^2 / (2 s_r^2)),
 *    dc = premultiplied RGB difference to the centre tap, s_r = mix(0.10, 0.6, wet).
 * 3. Pigment density d per pixel (Bousseau et al. 2006, "Interactive watercolor rendering"):
 *    C' = C - (C - C^2)(d - 1). d > 1 darkens a colour like more pigment, d < 1 lightens it, white
 *    paper (C = 1) and black stay put. d sums
 *    - Edges: pigment pooling on the darker side of every wash border (the wash compared with the
 *      mean of four reads 2 px away), weaker in wet patches,
 *    - Granulation: pigment settling in the paper valleys (paper height, 3 octaves of Fractal Noise
 *      at Grain Size) plus a slow uneven-density field, stronger where there is more pigment,
 *    - Blooms: a few backruns in flat areas, a lighter inside with a dark ragged rim.
 *    Then the paper relief (forward differences of the paper height) shades the result, Lift lets
 *    the white paper through, and Mix blends with the original.
 *
 * Every size is in pixels of a 1080p frame (shorter side), so previews and exports match. Flow
 * (cycles per second) moves the wet patches and the wobble with the timeline; the paper stays put.
 * No history: the result depends only on the frame, the settings and the timeline time.
 */
export const ACUARELA_REFERENCE_HEIGHT = 1080;
export const ACUARELA_KERNEL_EXTENT = 3;
/** Kernel tap spacing in sigmas; the spatial weight per unit index is spacing^2 / 2. */
export const ACUARELA_TAP_SPACING = 0.6;
export const ACUARELA_EDGE_REACH_PX = 2;
/** Largest wobble of the read position (1080p px); keeps the wobble slope below 0.3 px per px. */
export const ACUARELA_WOBBLE_MAX_PX = 12;
/** Tones of the Simplify quantization. */
export const ACUARELA_TONE_LEVELS = 6;
/** Darkest pigment (indigo) that Shadow Pigment lifts black to. */
export const ACUARELA_SHADOW_PIGMENT: readonly [number, number, number] = [0.08, 0.09, 0.14];
/** Largest pigment density (d); the default Edges, Granulation and Blooms stay below it. */
export const ACUARELA_DENSITY_MAX = 4;
/** Share of white paper at Lift 1. */
export const ACUARELA_LIFT_REACH = 0.8;

function sources(g: BlurGraphBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  for (const [id, value] of [['zero', 0], ['one', 1], ['half', .5], ['two', 2], ['three', 3]] as const) g.number(id, value);
  g.number('reference-height', ACUARELA_REFERENCE_HEIGHT);
  // s: pixels per 1080p pixel; q: aspect-correct position (1 = frame height); px: position in 1080p pixels.
  g.add('space-resolution-split', 'vector.split.vec2', { value: 'resolution' });
  g.binary('space-short-side', 'math.min.scalar', ['space-resolution-split', 'x'], ['space-resolution-split', 'y']);
  g.binary('space-scale', 'math.divide-ieee.scalar', 'space-short-side', 'reference-height');
  g.unary('space-one-vec2', 'convert.scalar-to-vec2', 'one');
  g.binary('space-texel', 'math.divide-ieee.vec2', 'space-one-vec2', 'resolution');
  g.add('space-q-scale', 'math.divide-ieee.vec2-scalar', { a: 'resolution', b: ['space-resolution-split', 'y'] });
  g.binary('space-q', 'math.multiply.vec2', ['uv', 'uv'], 'space-q-scale');
  g.binary('space-px-raw', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
  g.add('space-px', 'math.divide-ieee.vec2-scalar', { a: 'space-px-raw', b: 'space-scale' });
  g.bound('flow', 'flow');
  g.binary('space-flow-time', 'math.multiply.scalar', 'time', 'flow');
}

/** Fractal Noise at `position * scale + offset`, the offset drifting with flow time when `drift` is set. */
function noise(g: BlurGraphBuilder, id: string, position: GraphPort, scale: number, offset: readonly [number, number], octaves: number, roughness: number,
  drift?: readonly [number, number]): string {
  g.number(`${id}-scale`, scale);
  const scaled = g.add(`${id}-scaled`, 'math.multiply.vec2-scalar', { a: position, b: `${id}-scale` });
  g.number(`${id}-offset-x`, offset[0]); g.number(`${id}-offset-y`, offset[1]);
  let x: GraphPort = `${id}-offset-x`, y: GraphPort = `${id}-offset-y`;
  if (drift) {
    g.number(`${id}-drift-x`, drift[0]); g.number(`${id}-drift-y`, drift[1]);
    x = g.binary(`${id}-moving-x`, 'math.add.scalar', x, g.binary(`${id}-drift-x-time`, 'math.multiply.scalar', 'space-flow-time', `${id}-drift-x`));
    y = g.binary(`${id}-moving-y`, 'math.add.scalar', y, g.binary(`${id}-drift-y-time`, 'math.multiply.scalar', 'space-flow-time', `${id}-drift-y`));
  }
  const shift = g.add(`${id}-offset`, 'vector.combine.vec2', { x, y });
  const at = g.binary(`${id}-position`, 'math.add.vec2', scaled, shift);
  g.number(`${id}-octaves`, octaves); g.number(`${id}-roughness`, roughness);
  return g.add(id, 'noise.fractal2d.vec2', { value: at, octaves: `${id}-octaves`, roughness: `${id}-roughness` });
}

/**
 * Wet patches (0..1) and the read position that wobbles by up to Bleed pixels. The wobble is a
 * smooth noise field whose reach is capped at ACUARELA_WOBBLE_MAX_PX: its steepest slope then
 * stays below 0.3 px per px, so neighbouring pixels never read far-apart rows (larger reaches
 * folded the picture into stepped ghost copies).
 */
function wetBleed(g: BlurGraphBuilder): string {
  const bleed = g.bound('bleed', 'bleed');
  g.add('wet-bleed-positive', 'math.max.scalar', { a: bleed, b: 'zero' });
  noise(g, 'wet-field', 'space-q', 2.2, [0, 1.3], 2, 0.66, [0.05, 0]);
  g.number('wet-low', .55); g.number('wet-high', .75);
  g.add('wet-patch', 'math.smoothstep.scalar', { edge0: 'wet-low', edge1: 'wet-high', value: 'wet-field' });
  g.number('wet-full-bleed', 10);
  g.binary('wet-bleed-share-raw', 'math.divide-ieee.scalar', 'wet-bleed-positive', 'wet-full-bleed');
  g.add('wet-bleed-share', 'math.clamp.scalar', { value: 'wet-bleed-share-raw', min: 'zero', max: 'one' });
  g.binary('wet', 'math.multiply.scalar', 'wet-patch', 'wet-bleed-share');
  noise(g, 'wet-wobble-x', 'space-q', 9, [0, 0], 2, 0.5, [0.1, 0]);
  noise(g, 'wet-wobble-y', 'space-q', 9, [5.2, 31.7], 2, 0.5, [0, 0.1]);
  g.add('wet-wobble', 'vector.combine.vec2', { x: 'wet-wobble-x', y: 'wet-wobble-y' });
  g.unary('wet-half-vec2', 'convert.scalar-to-vec2', 'half');
  g.binary('wet-wobble-centered', 'math.subtract.vec2', 'wet-wobble', 'wet-half-vec2');
  // Wobble reach in 1080p px: min(Bleed * (0.25 + 0.5 wet), cap), times 2 for the centred -0.5..0.5 noise.
  g.number('wet-dry-reach', .25); g.number('wet-wet-reach', .5); g.number('wet-reach-cap', ACUARELA_WOBBLE_MAX_PX);
  g.binary('wet-reach-wet-share', 'math.multiply.scalar', 'wet', 'wet-wet-reach');
  g.binary('wet-reach-share', 'math.add.scalar', 'wet-dry-reach', 'wet-reach-wet-share');
  g.binary('wet-reach-raw', 'math.multiply.scalar', 'wet-bleed-positive', 'wet-reach-share');
  g.binary('wet-reach-1080', 'math.min.scalar', 'wet-reach-raw', 'wet-reach-cap');
  g.binary('wet-reach-px', 'math.multiply.scalar', 'wet-reach-1080', 'space-scale');
  g.binary('wet-reach-double', 'math.multiply.scalar', 'wet-reach-px', 'two');
  g.add('wet-offset-px', 'math.multiply.vec2-scalar', { a: 'wet-wobble-centered', b: 'wet-reach-double' });
  g.binary('wet-offset', 'math.multiply.vec2', 'wet-offset-px', 'space-texel');
  return g.binary('wet-read-uv', 'math.add.vec2', ['uv', 'uv'], 'wet-offset');
}

/**
 * Per-pixel tap jitter of a wash pass: a random turn of the 7 x 7 tap grid and a random shift of up
 * to half a tap. A fixed sparse grid copies thin features once per tap ("ghost echoes"); jittered
 * taps spread that into fine grain. One-octave Fractal Noise at the pixel position (one noise cell
 * per pixel, integer-hashed) is stretched into independent-looking values by fract(n * k).
 */
function tapJitter(g: BlurGraphBuilder, prefix: string, stretches: readonly [number, number, number]): { angle: string; shift: string } {
  if (!g.nodes.some(node => node.id === 'wash-jitter-noise')) noise(g, 'wash-jitter-noise', 'space-px-raw', 1, [0, 0], 1, 0);
  const random = (name: string, stretch: number) => {
    const id = `${prefix}-${name}`;
    g.number(`${id}-stretch`, stretch);
    g.binary(`${id}-stretched`, 'math.multiply.scalar', 'wash-jitter-noise', `${id}-stretch`);
    return g.unary(id, 'math.fract.scalar', `${id}-stretched`);
  };
  const turn = random('turn', stretches[0]);
  g.number(`${prefix}-full-turn`, Math.PI * 2);
  const angle = g.binary(`${prefix}-angle`, 'math.multiply.scalar', turn, `${prefix}-full-turn`);
  const shiftX = random('shift-x', stretches[1]), shiftY = random('shift-y', stretches[2]);
  g.add(`${prefix}-shift-raw`, 'vector.combine.vec2', { x: shiftX, y: shiftY });
  const shift = g.binary(`${prefix}-shift`, 'math.subtract.vec2', `${prefix}-shift-raw`, 'wet-half-vec2');
  return { angle, shift };
}

interface WashPass { prefix: string; source: string; readUv: GraphPort; sigma: string; range: string; stretches: readonly [number, number, number]; cache: string }

/** One edge-aware (bilateral) 7 x 7 pass with jittered taps, cached premultiplied as `cache`. */
function bilateralPass(g: BlurGraphBuilder, pass: WashPass): string {
  const { prefix, source, readUv, sigma, range, stretches, cache } = pass;
  g.number(`${prefix}-sigma-minimum`, .5);
  g.add(`${prefix}-sigma`, 'math.max.scalar', { a: sigma, b: `${prefix}-sigma-minimum` });
  g.number(`${prefix}-tap-spacing`, ACUARELA_TAP_SPACING);
  g.binary(`${prefix}-spacing`, 'math.multiply.scalar', `${prefix}-sigma`, `${prefix}-tap-spacing`);
  g.binary(`${prefix}-range-squared`, 'math.multiply.scalar', range, range);
  g.binary(`${prefix}-range-denominator`, 'math.multiply.scalar', `${prefix}-range-squared`, 'two');
  g.add(`${prefix}-center`, 'image.sample', { image: [source, 'image'], uv: readUv });
  g.add(`${prefix}-center-split`, 'vector.split.rgba', { image: [`${prefix}-center`, 'image'] });
  const jitter = tapJitter(g, `${prefix}-jitter`, stretches);
  // Per tap (kernel scope): jittered position, colour distance to the centre and the bilateral weight.
  g.add(`${prefix}-index`, 'image.kernel-index');
  g.add(`${prefix}-index-turned`, 'coordinates.rotate.vec2', { value: `${prefix}-index`, angle: jitter.angle });
  g.binary(`${prefix}-index-jittered`, 'math.add.vec2', `${prefix}-index-turned`, jitter.shift);
  g.add(`${prefix}-index-px`, 'math.multiply.vec2-scalar', { a: `${prefix}-index-jittered`, b: `${prefix}-spacing` });
  g.binary(`${prefix}-index-offset`, 'math.multiply.vec2', `${prefix}-index-px`, 'space-texel');
  g.binary(`${prefix}-tap-uv`, 'math.add.vec2', readUv, `${prefix}-index-offset`);
  g.add(`${prefix}-tap`, 'image.sample', { image: [source, 'image'], uv: `${prefix}-tap-uv` });
  g.add(`${prefix}-tap-split`, 'vector.split.rgba', { image: [`${prefix}-tap`, 'image'] });
  g.binary(`${prefix}-difference`, 'math.subtract.rgb', [`${prefix}-tap-split`, 'rgb'], [`${prefix}-center-split`, 'rgb']);
  g.binary(`${prefix}-difference-squared`, 'math.multiply.rgb', `${prefix}-difference`, `${prefix}-difference`);
  g.add(`${prefix}-difference-vec3`, 'convert.rgb-to-vec3', { rgb: `${prefix}-difference-squared` });
  g.add(`${prefix}-difference-parts`, 'vector.split.vec3', { value: `${prefix}-difference-vec3` });
  g.binary(`${prefix}-difference-xy`, 'math.add.scalar', [`${prefix}-difference-parts`, 'x'], [`${prefix}-difference-parts`, 'y']);
  g.binary(`${prefix}-colour-distance`, 'math.add.scalar', `${prefix}-difference-xy`, [`${prefix}-difference-parts`, 'z']);
  g.binary(`${prefix}-range-term`, 'math.divide-ieee.scalar', `${prefix}-colour-distance`, `${prefix}-range-denominator`);
  g.add(`${prefix}-index-squared`, 'vector.dot.vec2', { a: `${prefix}-index`, b: `${prefix}-index` });
  g.number(`${prefix}-spatial-falloff`, ACUARELA_TAP_SPACING * ACUARELA_TAP_SPACING / 2);
  g.binary(`${prefix}-spatial-term`, 'math.multiply.scalar', `${prefix}-index-squared`, `${prefix}-spatial-falloff`);
  g.binary(`${prefix}-exponent-positive`, 'math.add.scalar', `${prefix}-spatial-term`, `${prefix}-range-term`);
  g.binary(`${prefix}-exponent`, 'math.subtract.scalar', 'zero', `${prefix}-exponent-positive`);
  g.unary(`${prefix}-weight`, 'math.exp.scalar', `${prefix}-exponent`);
  g.number(`${prefix}-extent`, ACUARELA_KERNEL_EXTENT);
  g.add(`${prefix}-reduce`, 'image.kernel-grid-reduce', { sample: [`${prefix}-tap`, 'image'], weight: `${prefix}-weight`, extent: `${prefix}-extent` });
  g.add(`${prefix}-weight-vec4`, 'convert.scalar-to-vec4', { value: [`${prefix}-reduce`, 'weightSum'] });
  g.add(`${prefix}-average`, 'math.divide-ieee.vec4', { a: [`${prefix}-reduce`, 'sum'], b: `${prefix}-weight-vec4` });
  g.add(`${prefix}-image`, 'convert.vec4-to-image', { value: `${prefix}-average` });
  return g.add(cache, 'image.materialize', { image: [`${prefix}-image`, 'image'] });
}

/**
 * The pigment wash: two edge-aware passes, the second over the first (iterating a bilateral filter
 * flattens colour inside shapes like a mean shift and keeps their borders). Pass 1 reads at the
 * wobbling position with sigma = Wash (1 + 0.3 wet); pass 2 smooths with sigma = 0.6 Wash +
 * 0.25 Bleed wet, so in wet patches colour runs across borders. Colour tolerance (range sigma)
 * grows from 0.1 dry to 0.3 (pass 1) and 0.5 (pass 2) wet.
 */
function wash(g: BlurGraphBuilder, source: string, readUv: string): string {
  const size = g.bound('wash', 'wash');
  g.add('wash-size-positive', 'math.max.scalar', { a: size, b: 'zero' });
  g.number('wash-wet-widening', .3);
  g.binary('wash-wet-share', 'math.multiply.scalar', 'wet', 'wash-wet-widening');
  g.binary('wash-widening', 'math.add.scalar', 'one', 'wash-wet-share');
  g.binary('wash-sigma-1080', 'math.multiply.scalar', 'wash-size-positive', 'wash-widening');
  g.binary('wash-sigma-raw', 'math.multiply.scalar', 'wash-sigma-1080', 'space-scale');
  g.number('wash-dry-range', .1); g.number('wash-wet-range', .3);
  g.add('wash-range', 'math.mix.scalar', { a: 'wash-dry-range', b: 'wash-wet-range', t: 'wet' });
  const first = bilateralPass(g, { prefix: 'wash', source, readUv, sigma: 'wash-sigma-raw', range: 'wash-range', stretches: [97, 389, 1543], cache: 'wash-first-cache' });
  g.number('wash-soft-share', .6); g.number('wash-soft-bleed-share', .25);
  g.binary('wash-soft-dry', 'math.multiply.scalar', 'wash-size-positive', 'wash-soft-share');
  g.binary('wash-soft-bleed', 'math.multiply.scalar', 'wet-bleed-positive', 'wash-soft-bleed-share');
  g.binary('wash-soft-bleed-wet', 'math.multiply.scalar', 'wash-soft-bleed', 'wet');
  g.binary('wash-soft-sigma-1080', 'math.add.scalar', 'wash-soft-dry', 'wash-soft-bleed-wet');
  g.binary('wash-soft-sigma-raw', 'math.multiply.scalar', 'wash-soft-sigma-1080', 'space-scale');
  g.number('wash-soft-wet-range', .5);
  g.add('wash-soft-range', 'math.mix.scalar', { a: 'wash-dry-range', b: 'wash-soft-wet-range', t: 'wet' });
  return bilateralPass(g, { prefix: 'wash-soft', source: first, readUv: ['uv', 'uv'], sigma: 'wash-soft-sigma-raw', range: 'wash-soft-range', stretches: [733, 2971, 6007], cache: 'wash-cache' });
}

/** Straight RGB of a premultiplied sample (transparent samples stay black). */
function straight(g: BlurGraphBuilder, id: string, sample: GraphPort): string {
  g.add(`${id}-split`, 'vector.split.rgba', { image: sample });
  g.add(`${id}-alpha`, 'convert.alpha-to-scalar', { alpha: [`${id}-split`, 'alpha'] });
  g.binary(`${id}-safe-alpha`, 'math.max.scalar', `${id}-alpha`, 'coverage-floor');
  return g.add(id, 'math.divide-ieee.rgb-scalar', { a: [`${id}-split`, 'rgb'], b: `${id}-safe-alpha` });
}

/** Pigment pooling: wash luminance against the mean of four reads at the edge reach. */
function edgePooling(g: BlurGraphBuilder, washCache: string): void {
  g.add('pool-wash', 'image.sample', { image: [washCache, 'image'], uv: ['uv', 'uv'] });
  straight(g, 'pool-wash-rgb', ['pool-wash', 'image']);
  g.add('pool-wash-luma', 'color.luminance-rec709.rgb', { rgb: 'pool-wash-rgb' });
  g.number('pool-reach-1080', ACUARELA_EDGE_REACH_PX);
  g.binary('pool-reach-px', 'math.multiply.scalar', 'pool-reach-1080', 'space-scale');
  g.add('pool-reach', 'math.multiply.vec2-scalar', { a: 'space-texel', b: 'pool-reach-px' });
  g.add('pool-reach-split', 'vector.split.vec2', { value: 'pool-reach' });
  g.add('pool-step-x', 'vector.combine.vec2', { x: ['pool-reach-split', 'x'], y: 'zero' });
  g.add('pool-step-y', 'vector.combine.vec2', { x: 'zero', y: ['pool-reach-split', 'y'] });
  const reads = [['right', 'math.add.vec2', 'pool-step-x'], ['left', 'math.subtract.vec2', 'pool-step-x'],
    ['down', 'math.add.vec2', 'pool-step-y'], ['up', 'math.subtract.vec2', 'pool-step-y']] as const;
  for (const [name, operator, step] of reads) {
    g.binary(`pool-${name}-uv`, operator, ['uv', 'uv'], step);
    g.add(`pool-${name}`, 'image.sample', { image: [washCache, 'image'], uv: `pool-${name}-uv` });
    g.add(`pool-${name}-split`, 'vector.split.rgba', { image: [`pool-${name}`, 'image'] });
    g.add(`pool-${name}-alpha`, 'convert.alpha-to-scalar', { alpha: [`pool-${name}-split`, 'alpha'] });
  }
  // Premultiplied sums: the straight mean colour is sum(rgb) / sum(alpha).
  g.binary('pool-rgb-a', 'math.add.rgb', ['pool-right-split', 'rgb'], ['pool-left-split', 'rgb']);
  g.binary('pool-rgb-b', 'math.add.rgb', ['pool-down-split', 'rgb'], ['pool-up-split', 'rgb']);
  g.binary('pool-rgb-sum', 'math.add.rgb', 'pool-rgb-a', 'pool-rgb-b');
  g.binary('pool-alpha-a', 'math.add.scalar', 'pool-right-alpha', 'pool-left-alpha');
  g.binary('pool-alpha-b', 'math.add.scalar', 'pool-down-alpha', 'pool-up-alpha');
  g.binary('pool-alpha-sum', 'math.add.scalar', 'pool-alpha-a', 'pool-alpha-b');
  g.binary('pool-alpha-safe', 'math.max.scalar', 'pool-alpha-sum', 'coverage-floor');
  g.add('pool-mean-rgb', 'math.divide-ieee.rgb-scalar', { a: 'pool-rgb-sum', b: 'pool-alpha-safe' });
  g.add('pool-mean-luma', 'color.luminance-rec709.rgb', { rgb: 'pool-mean-rgb' });
  g.binary('pool-contrast', 'math.subtract.scalar', 'pool-mean-luma', 'pool-wash-luma');
  g.number('pool-gain', 6); g.number('minus-one', -1);
  g.binary('pool-contrast-gained', 'math.multiply.scalar', 'pool-contrast', 'pool-gain');
  g.add('pool', 'math.clamp.scalar', { value: 'pool-contrast-gained', min: 'minus-one', max: 'one' });
  g.add('pool-dark-side', 'math.max.scalar', { a: 'pool', b: 'zero' });
  g.binary('pool-light-side-negative', 'math.min.scalar', 'pool', 'zero');
  g.number('pool-dark-weight', 1.5); g.number('pool-light-weight', .25);
  g.binary('pool-darkening', 'math.multiply.scalar', 'pool-dark-side', 'pool-dark-weight');
  g.binary('pool-lightening', 'math.multiply.scalar', 'pool-light-side-negative', 'pool-light-weight');
  g.binary('pool-shape', 'math.add.scalar', 'pool-darkening', 'pool-lightening');
  g.number('pool-wet-softening', .6);
  g.binary('pool-wet-share', 'math.multiply.scalar', 'wet', 'pool-wet-softening');
  g.binary('pool-dryness', 'math.subtract.scalar', 'one', 'pool-wet-share');
  g.binary('pool-shape-dry', 'math.multiply.scalar', 'pool-shape', 'pool-dryness');
  g.bound('edges', 'edges');
  g.binary('pool-density', 'math.multiply.scalar', 'pool-shape-dry', 'edges');
}

/** Paper height (3 octaves at Grain Size), its relief light and the granulation density. */
function paper(g: BlurGraphBuilder): void {
  g.bound('grain-size', 'grainSize');
  g.number('paper-grain-minimum', .25);
  g.add('paper-grain', 'math.max.scalar', { a: 'grain-size', b: 'paper-grain-minimum' });
  g.add('paper-position', 'math.divide-ieee.vec2-scalar', { a: 'space-px', b: 'paper-grain' });
  noise(g, 'paper-height', 'paper-position', .11, [0, 0], 3, .8);
  g.add('paper-step-x', 'vector.combine.vec2', { x: 'one', y: 'zero' });
  g.add('paper-step-y', 'vector.combine.vec2', { x: 'zero', y: 'one' });
  g.binary('paper-position-x', 'math.add.vec2', 'paper-position', 'paper-step-x');
  g.binary('paper-position-y', 'math.add.vec2', 'paper-position', 'paper-step-y');
  noise(g, 'paper-height-x', 'paper-position-x', .11, [0, 0], 3, .8);
  noise(g, 'paper-height-y', 'paper-position-y', .11, [0, 0], 3, .8);
  g.binary('paper-slope-x', 'math.subtract.scalar', 'paper-height-x', 'paper-height');
  g.binary('paper-slope-y', 'math.subtract.scalar', 'paper-height-y', 'paper-height');
  g.binary('paper-slope', 'math.subtract.scalar', 'paper-slope-x', 'paper-slope-y');
  g.number('paper-relief-gain', 8);
  g.binary('paper-relief-raw', 'math.multiply.scalar', 'paper-slope', 'paper-relief-gain');
  g.binary('paper-light-raw', 'math.add.scalar', 'half', 'paper-relief-raw');
  g.add('paper-light', 'math.clamp.scalar', { value: 'paper-light-raw', min: 'zero', max: 'one' });
  // Light washes show the paper, dense dark paint hides it: weight = 0.2 + 0.8 smoothstep(0.04, 0.5, wash luminance).
  g.number('paper-light-low', .04);
  g.add('paper-light-share', 'math.smoothstep.scalar', { edge0: 'paper-light-low', edge1: 'half', value: 'pool-wash-luma' });
  g.number('paper-dark-floor', .2); g.number('paper-light-gain', .8);
  g.binary('paper-light-gained', 'math.multiply.scalar', 'paper-light-share', 'paper-light-gain');
  g.binary('paper-visibility', 'math.add.scalar', 'paper-dark-floor', 'paper-light-gained');
  // Granulation: ((0.55 - height) * 1.3 * (0.3 + pigment) + 0.4 * (uneven - 0.5)) * visibility, times Granulation.
  g.binary('paper-pigment-raw', 'math.subtract.scalar', 'one', 'pool-wash-luma');
  g.add('paper-pigment', 'math.clamp.scalar', { value: 'paper-pigment-raw', min: 'zero', max: 'one' });
  g.number('paper-valley-level', .55); g.number('paper-valley-gain', 1.3); g.number('paper-pigment-base', .3);
  g.binary('paper-valley', 'math.subtract.scalar', 'paper-valley-level', 'paper-height');
  g.binary('paper-valley-gained', 'math.multiply.scalar', 'paper-valley', 'paper-valley-gain');
  g.binary('paper-pigment-share', 'math.add.scalar', 'paper-pigment-base', 'paper-pigment');
  g.binary('paper-settling', 'math.multiply.scalar', 'paper-valley-gained', 'paper-pigment-share');
  noise(g, 'paper-uneven', 'space-q', 5, [5, 5], 2, .5);
  g.binary('paper-uneven-centered', 'math.subtract.scalar', 'paper-uneven', 'half');
  g.number('paper-uneven-gain', .4);
  g.binary('paper-uneven-share', 'math.multiply.scalar', 'paper-uneven-centered', 'paper-uneven-gain');
  g.binary('paper-granulation-raw', 'math.add.scalar', 'paper-settling', 'paper-uneven-share');
  g.binary('paper-granulation-shape', 'math.multiply.scalar', 'paper-granulation-raw', 'paper-visibility');
  g.bound('granulation', 'granulation');
  g.binary('paper-granulation', 'math.multiply.scalar', 'paper-granulation-shape', 'granulation');
}

/** Backruns: a few blooms in flat areas, lighter inside with a dark ragged rim. */
function blooms(g: BlurGraphBuilder): void {
  noise(g, 'bloom-field-base', 'space-q', 3.1, [11, 11], 2, .43);
  noise(g, 'bloom-fringe', 'space-q', 70, [0, 0], 1, 0);
  g.binary('bloom-fringe-centered', 'math.subtract.scalar', 'bloom-fringe', 'half');
  g.number('bloom-fringe-gain', .05);
  g.binary('bloom-fringe-share', 'math.multiply.scalar', 'bloom-fringe-centered', 'bloom-fringe-gain');
  g.binary('bloom-field', 'math.add.scalar', 'bloom-field-base', 'bloom-fringe-share');
  g.number('bloom-inside-low', .585); g.number('bloom-level', .6);
  g.add('bloom-inside', 'math.smoothstep.scalar', { edge0: 'bloom-inside-low', edge1: 'bloom-level', value: 'bloom-field' });
  g.binary('bloom-rim-distance', 'math.subtract.scalar', 'bloom-field', 'bloom-level');
  g.binary('bloom-rim-distance-squared', 'math.multiply.scalar', 'bloom-rim-distance', 'bloom-rim-distance');
  g.number('bloom-rim-sharpness', -10000);
  g.binary('bloom-rim-exponent', 'math.multiply.scalar', 'bloom-rim-distance-squared', 'bloom-rim-sharpness');
  g.unary('bloom-rim', 'math.exp.scalar', 'bloom-rim-exponent');
  g.number('bloom-rim-weight', .55); g.number('bloom-inside-weight', .25);
  g.binary('bloom-rim-share', 'math.multiply.scalar', 'bloom-rim', 'bloom-rim-weight');
  g.binary('bloom-inside-share', 'math.multiply.scalar', 'bloom-inside', 'bloom-inside-weight');
  g.binary('bloom-shape', 'math.subtract.scalar', 'bloom-rim-share', 'bloom-inside-share');
  noise(g, 'bloom-gate-field', 'space-q', 1.4, [77, 77], 1, 0);
  g.number('bloom-gate-low', .56); g.number('bloom-gate-high', .72);
  g.add('bloom-gate', 'math.smoothstep.scalar', { edge0: 'bloom-gate-low', edge1: 'bloom-gate-high', value: 'bloom-gate-field' });
  g.unary('bloom-local-contrast', 'math.abs.scalar', 'pool-contrast');
  g.number('bloom-flat-low', .015); g.number('bloom-flat-high', .06);
  g.add('bloom-busy', 'math.smoothstep.scalar', { edge0: 'bloom-flat-low', edge1: 'bloom-flat-high', value: 'bloom-local-contrast' });
  g.binary('bloom-flat', 'math.subtract.scalar', 'one', 'bloom-busy');
  g.binary('bloom-place', 'math.multiply.scalar', 'bloom-flat', 'bloom-gate');
  g.binary('bloom-placed', 'math.multiply.scalar', 'bloom-shape', 'bloom-place');
  g.bound('blooms', 'blooms');
  g.binary('bloom-density', 'math.multiply.scalar', 'bloom-placed', 'blooms');
}

/**
 * Simplify: soft luminance quantization of the wash into ACUARELA_TONE_LEVELS tones (layered glazes
 * instead of photographic gradients), hue kept by scaling RGB. Level = (floor(L n) + smoothstep(0.3,
 * 0.7, fract(L n))) / n; the colour is mixed toward it by Simplify.
 */
function simplify(g: BlurGraphBuilder): void {
  g.number('tone-levels', ACUARELA_TONE_LEVELS);
  g.binary('tone-scaled', 'math.multiply.scalar', 'pool-wash-luma', 'tone-levels');
  g.unary('tone-floor', 'math.floor.scalar', 'tone-scaled');
  g.unary('tone-fraction', 'math.fract.scalar', 'tone-scaled');
  g.number('tone-step-low', .3); g.number('tone-step-high', .7);
  g.add('tone-step', 'math.smoothstep.scalar', { edge0: 'tone-step-low', edge1: 'tone-step-high', value: 'tone-fraction' });
  g.binary('tone-level-scaled', 'math.add.scalar', 'tone-floor', 'tone-step');
  g.binary('tone-level', 'math.divide-ieee.scalar', 'tone-level-scaled', 'tone-levels');
  g.number('tone-luma-floor', 1e-3);
  g.binary('tone-luma-safe', 'math.max.scalar', 'pool-wash-luma', 'tone-luma-floor');
  g.binary('tone-ratio', 'math.divide-ieee.scalar', 'tone-level', 'tone-luma-safe');
  g.add('tone-quantized', 'math.multiply.rgb-scalar', { a: 'pool-wash-rgb', b: 'tone-ratio' });
  g.bound('simplify', 'simplify');
  g.add('tone-amount', 'math.clamp.scalar', { value: 'simplify', min: 'zero', max: 'one' });
  g.add('tone-rgb', 'math.mix.rgb', { a: 'pool-wash-rgb', b: 'tone-quantized', t: 'tone-amount' });
}

/** Shadow Pigment: black lifts toward a dark indigo pigment, C = P + (1 - P) C, mixed in by Shadow Pigment. */
function shadowPigment(g: BlurGraphBuilder): void {
  g.add('shade-clamped', 'math.clamp.rgb-scalar', { value: 'tone-rgb', min: 'zero', max: 'one' });
  const [r, gr, b] = ACUARELA_SHADOW_PIGMENT;
  g.number('shade-pigment-r', r); g.number('shade-pigment-g', gr); g.number('shade-pigment-b', b);
  g.add('shade-pigment-vec3', 'vector.combine.vec3', { x: 'shade-pigment-r', y: 'shade-pigment-g', z: 'shade-pigment-b' });
  g.add('shade-pigment', 'convert.vec3-to-rgb', { value: 'shade-pigment-vec3' });
  g.unary('shade-white', 'convert.scalar-to-rgb', 'one');
  g.binary('shade-paper-share', 'math.subtract.rgb', ['shade-white', 'rgb'], ['shade-pigment', 'rgb']);
  g.binary('shade-scaled', 'math.multiply.rgb', 'shade-clamped', 'shade-paper-share');
  g.binary('shade-lifted', 'math.add.rgb', 'shade-scaled', ['shade-pigment', 'rgb']);
  g.bound('shadows', 'shadows');
  g.add('shade-amount', 'math.clamp.scalar', { value: 'shadows', min: 'zero', max: 'one' });
  g.add('shade-rgb', 'math.mix.rgb', { a: 'shade-clamped', b: 'shade-lifted', t: 'shade-amount' });
}

/** d = clamp(1 + pooling + granulation + blooms, 0, 4); C' = C - (C - C^2)(d - 1). */
function pigment(g: BlurGraphBuilder): void {
  g.binary('density-pool-granulation', 'math.add.scalar', 'pool-density', 'paper-granulation');
  g.binary('density-terms', 'math.add.scalar', 'density-pool-granulation', 'bloom-density');
  g.binary('density-raw', 'math.add.scalar', 'one', 'density-terms');
  g.number('density-max', ACUARELA_DENSITY_MAX);
  g.add('density', 'math.clamp.scalar', { value: 'density-raw', min: 'zero', max: 'density-max' });
  g.add('density-colour', 'math.clamp.rgb-scalar', { value: 'shade-rgb', min: 'zero', max: 'one' });
  g.binary('density-colour-squared', 'math.multiply.rgb', 'density-colour', 'density-colour');
  g.binary('density-transmission', 'math.subtract.rgb', 'density-colour', 'density-colour-squared');
  g.binary('density-excess', 'math.subtract.scalar', 'density', 'one');
  g.add('density-change', 'math.multiply.rgb-scalar', { a: 'density-transmission', b: 'density-excess' });
  g.binary('density-painted', 'math.subtract.rgb', 'density-colour', 'density-change');
}

/**
 * Paper relief light (weighted by paper visibility), Lift towards white paper (Lift 1 = 80 % paper,
 * so a faint wash stays), the wash alpha, and Mix with the original. Mix blends premultiplied: the
 * wobbling read moves the painted alpha edge away from the original one, and a straight-alpha mix
 * would darken that fringe on transparent layers.
 */
function finish(g: BlurGraphBuilder): void {
  g.bound('paper', 'paper');
  g.binary('finish-light-centered', 'math.subtract.scalar', 'paper-light', 'half');
  g.number('finish-relief-weight', .25);
  g.binary('finish-relief-share', 'math.multiply.scalar', 'finish-light-centered', 'finish-relief-weight');
  g.binary('finish-relief-visible', 'math.multiply.scalar', 'finish-relief-share', 'paper-visibility');
  g.binary('finish-relief-amount', 'math.multiply.scalar', 'finish-relief-visible', 'paper');
  g.binary('finish-relief', 'math.add.scalar', 'one', 'finish-relief-amount');
  g.add('finish-lit', 'math.multiply.rgb-scalar', { a: 'density-painted', b: 'finish-relief' });
  g.bound('lift', 'lift');
  g.add('finish-lift-clamped', 'math.clamp.scalar', { value: 'lift', min: 'zero', max: 'one' });
  g.number('finish-lift-reach', ACUARELA_LIFT_REACH);
  g.binary('finish-lift', 'math.multiply.scalar', 'finish-lift-clamped', 'finish-lift-reach');
  g.unary('finish-white', 'convert.scalar-to-rgb', 'one');
  g.add('finish-lifted', 'math.mix.rgb', { a: 'finish-lit', b: ['finish-white', 'rgb'], t: 'finish-lift' });
  g.add('finish-rgb', 'math.clamp.rgb-scalar', { value: 'finish-lifted', min: 'zero', max: 'one' });
  g.add('finish-alpha', 'convert.alpha-to-scalar', { alpha: ['pool-wash-rgb-split', 'alpha'] });
  g.add('finish-painted-rgb', 'math.multiply.rgb-scalar', { a: 'finish-rgb', b: 'finish-alpha' });
  g.add('finish-painted', 'vector.combine.rgba', { rgb: 'finish-painted-rgb', alpha: ['pool-wash-rgb-split', 'alpha'] });
  g.add('finish-painted-vec4', 'convert.image-to-vec4', { image: ['finish-painted', 'image'] });
  g.add('finish-original', 'image.sample', { image: ['source-cache', 'image'], uv: ['uv', 'uv'] });
  g.add('finish-original-vec4', 'convert.image-to-vec4', { image: ['finish-original', 'image'] });
  g.bound('mix', 'opacity');
  g.add('finish-mix', 'math.clamp.scalar', { value: 'mix', min: 'zero', max: 'one' });
  g.add('finish-mixed', 'math.mix.vec4', { a: 'finish-original-vec4', b: 'finish-painted-vec4', t: 'finish-mix' });
  g.add('finish-mixed-image', 'convert.vec4-to-image', { value: 'finish-mixed' });
  straight(g, 'finish-straight', ['finish-mixed-image', 'image']);
  g.add('result', 'vector.combine.rgba', { rgb: 'finish-straight', alpha: ['finish-straight-split', 'alpha'] });
  g.add('output', 'image.output', { image: ['result', 'image'] });
}

export function createDefaultAcuarelaGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  g.number('coverage-floor', 1e-5);
  const source = premultipliedSourceCache(g);
  const readUv = wetBleed(g);
  const washCache = wash(g, source, readUv);
  edgePooling(g, washCache);
  paper(g);
  blooms(g);
  simplify(g);
  shadowPigment(g);
  pigment(g);
  finish(g);
  return g.graph(10);
}
