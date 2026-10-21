import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { premultipliedSourceCache, type GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder, straightSample } from './analogRecipeBuilder';
import { CRT_LINE_COUNT_RANGE, CRT_MASK_SIZE_RANGE, CRT_MIN_LINE_PX, CRT_MIN_STRIPE_PX } from '../../effects/analog/crtScreenLimits';

/**
 * CRT Screen recipe (see docs/Features/Effects-Analog.md).
 *
 * All sizes are relative to the frame, so preview and export show the same tube:
 * - Screen: barrel warp x' = x(1 + k y^2), y' = y(1 + k x^2) on [-1, 1] coordinates with
 *   k = 0.18 * Curvature * Mix. Outside the tube is transparent; the corners are rounded with
 *   radius 5 % of the frame height and a one-pixel soft edge; the rim darkens by up to 40 %.
 * - Scanlines: Line Count beams over the frame height. Each output pixel adds the two nearest
 *   lines (sampled at their centres) with a Gaussian beam profile in linear light; the beam
 *   width grows from 0.16 to 0.42 line heights with the line's brightness, so dark parts show
 *   lines and highlights bloom into the gaps. Depth blends from the full-resolution picture to
 *   the beams; lines thinner than 2 px fade out instead of aliasing.
 * - Phosphor mask: sinusoidal RGB stripes (Aperture Grille) or stripes broken by staggered
 *   slots (Slot Mask), Mask Size = stripe width in pixels at 1080 lines (scaled with the frame
 *   height); the mask keeps the average brightness, and fades out below about 1 px stripes.
 * - Flicker: a slow rolling hum bar plus a fast brightness flutter, driven by timeline time.
 * - Alpha: the three reads come from a premultiplied cache, so cut-out edges keep their colour.
 */
const GAMMA = 2.2;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('tau', Math.PI * 2);
  g.number('coverage-floor', 1e-6);
  g.split2('resolution-split', ['resolution', 'value']);
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('curvature', 'curvature', 'zero', 'one');
  g.clampedParam('line-count', 'lineCount', g.number('line-count-min', CRT_LINE_COUNT_RANGE[0]), g.number('line-count-max', CRT_LINE_COUNT_RANGE[1]));
  g.clampedParam('scanline-depth', 'scanlines', 'zero', 'one');
  g.clampedParam('mask-strength', 'maskStrength', 'zero', 'one');
  g.clampedParam('mask-size', 'maskSize', g.number('mask-size-min', CRT_MASK_SIZE_RANGE[0]), g.number('mask-size-max', CRT_MASK_SIZE_RANGE[1]));
  g.clampedParam('flicker', 'flicker', 'zero', 'one');
  g.bound('speed', 'speed');
  g.bound('mask-type', 'maskType', 'values.choice');
}

/** Barrel-warped read position `screen-uv`, the tube coverage `screen-tube` and the rim shade `screen-vignette`. */
function screen(g: AnalogRecipeBuilder) {
  const strength = g.mul('screen-strength', 'curvature-clamped', 'amount-clamped');
  const k = g.mul('screen-k', strength, g.number('screen-k-scale', .18));
  g.splat2('one-vec2', 'one'); g.splat2('half-vec2', 'half');
  const centered = g.sub2('screen-centered', g.scale2('screen-uv-two', ['uv', 'uv'], 'two'), 'one-vec2');
  const [cx, cy] = g.split2('screen-c', centered);
  const warpX = g.plus('screen-warp-x', 'one', g.mul('screen-warp-x-k', g.mul('screen-cy2', cy, cy), k));
  const warpY = g.plus('screen-warp-y', 'one', g.mul('screen-warp-y-k', g.mul('screen-cx2', cx, cx), k));
  const wx = g.mul('screen-x', cx, warpX), wy = g.mul('screen-y', cy, warpY);
  g.add2('screen-uv', g.scale2('screen-half', g.vec2('screen-warped', wx, wy), 'half'), 'half-vec2');
  // Distance to the tube edge in output pixels (positive inside), then a rounded-rectangle edge.
  const halfWidth = g.mul('screen-half-width', ['resolution-split', 'x'], 'half'), halfHeight = g.mul('screen-half-height', ['resolution-split', 'y'], 'half');
  const edgeX = g.mul('screen-edge-x', g.sub('screen-inset-x', 'one', g.fn('screen-abs-x', 'abs', wx)), halfWidth);
  const edgeY = g.mul('screen-edge-y', g.sub('screen-inset-y', 'one', g.fn('screen-abs-y', 'abs', wy)), halfHeight);
  const radius = g.mul('screen-corner', g.mul('screen-corner-px', ['resolution-split', 'y'], g.number('screen-corner-scale', .05)), strength);
  const qx = g.sub('screen-qx', radius, edgeX), qy = g.sub('screen-qy', radius, edgeY);
  const outside = g.add('screen-outside', 'vector.length.vec2', { value: g.vec2('screen-q-pos', g.max('screen-qx-pos', qx, 'zero'), g.max('screen-qy-pos', qy, 'zero')) });
  const distance = g.sub('screen-distance', g.plus('screen-sdf', outside, g.min('screen-inside', g.max('screen-q-max', qx, qy), 'zero')), radius);
  g.clamp('screen-tube', g.sub('screen-coverage', 'half', distance), 'zero', 'one');
  const edge = g.min('screen-edge', edgeX, edgeY);
  const rim = g.smooth('screen-rim', 'zero', g.mul('screen-rim-width', ['resolution-split', 'y'], g.number('screen-rim-scale', .2)), edge);
  const dark = g.sub('screen-rim-dark', 'one', g.mul('screen-rim-depth', strength, g.number('screen-rim-strength', .4)));
  g.mix('screen-vignette', dark, 'one', rim);
}

/** Linear-light RGB of a read: max(rgb, 0)^2.2. */
function linear(g: AnalogRecipeBuilder, id: string, rgb: GraphPort) {
  const positive = g.binary(`${id}-positive`, 'math.max.rgb', rgb, ['zero-rgb', 'rgb']);
  return g.binary(id, 'math.power.rgb', positive, ['gamma-rgb', 'rgb']);
}

/** Gaussian beam weight exp(-d^2 / (2 sigma^2)), sigma from the line's brightness. */
function beam(g: AnalogRecipeBuilder, id: string, distance: GraphPort, rgb: GraphPort) {
  const luma = g.add(`${id}-luma`, 'color.luminance-rec709.rgb', { rgb });
  const sigma = g.mix(`${id}-sigma`, 'scan-sigma-min', 'scan-sigma-max', g.clamp(`${id}-luma-clamped`, luma, 'zero', 'one'));
  const spread = g.mul(`${id}-spread`, g.mul(`${id}-sigma-squared`, sigma, sigma), 'two');
  const exponent = g.sub(`${id}-exponent`, 'zero', g.div(`${id}-ratio`, g.mul(`${id}-d2`, distance, distance), spread));
  return g.fn(`${id}-weight`, 'exp', exponent);
}

/** Flat read and the two-line beam sum in linear light: `scan-linear`. */
function scanlines(g: AnalogRecipeBuilder, cache: string) {
  g.rgbConstant('zero-rgb', 'zero');
  g.rgbConstant('gamma-rgb', g.number('gamma', GAMMA));
  g.number('scan-sigma-min', .16); g.number('scan-sigma-max', .42);
  const [x, y] = g.split2('scan-screen-uv', 'screen-uv');
  const flat = straightSample(g, 'flat', cache, 'screen-uv');
  const position = g.mul('scan-position', y, 'line-count-clamped');
  const first = g.fn('scan-first', 'floor', g.sub('scan-shifted', position, 'half'));
  const d0 = g.sub('scan-d0', g.sub('scan-offset', position, 'half'), first), d1 = g.sub('scan-d1', 'one', d0);
  const y0 = g.div('scan-y0', g.plus('scan-centre0', first, 'half'), 'line-count-clamped');
  const y1 = g.div('scan-y1', g.plus('scan-centre1', first, g.number('one-point-five', 1.5)), 'line-count-clamped');
  const line0 = straightSample(g, 'line0', cache, g.vec2('scan-uv0', x, y0));
  const line1 = straightSample(g, 'line1', cache, g.vec2('scan-uv1', x, y1));
  const sum = g.addRgb('scan-beams', g.scaleRgb('scan-beam0', linear(g, 'line0-linear', line0.rgb), beam(g, 'scan-w0', d0, line0.rgb)),
    g.scaleRgb('scan-beam1', linear(g, 'line1-linear', line1.rgb), beam(g, 'scan-w1', d1, line1.rgb)));
  // Lines thinner than CRT_MIN_LINE_PX cannot be drawn without aliasing; they fade to the flat picture.
  const linePx = g.div('scan-line-px', ['resolution-split', 'y'], 'line-count-clamped');
  const fade = g.smooth('scan-fade', g.number('scan-fade-start', CRT_MIN_LINE_PX - 1), g.number('scan-fade-end', CRT_MIN_LINE_PX), linePx);
  const depth = g.mul('scan-depth', g.mul('scan-depth-amount', 'scanline-depth-clamped', 'amount-clamped'), fade);
  g.mixRgb('scan-linear', linear(g, 'flat-linear', flat.rgb), sum, depth);
  return { flatAlpha: flat.alpha, depth };
}

/** Per-channel mask factor around 1 (mean-preserving): `mask-factor`. */
function mask(g: AnalogRecipeBuilder) {
  const [width, height] = [['resolution-split', 'x'] as const, ['resolution-split', 'y'] as const];
  const [u, v] = g.split2('mask-uv', ['uv', 'uv']);
  const stripe = g.mul('mask-stripe-px', 'mask-size-clamped', g.div('mask-frame-scale', height, g.number('mask-reference-height', 1080)));
  const triad = g.mul('mask-triad-px', stripe, g.number('three', 3));
  const phase = g.div('mask-phase', g.mul('mask-x-px', u, width), triad);
  const channel = (id: string, offset: number) => {
    const angle = g.mul(`${id}-angle`, g.sub(`${id}-shift`, phase, g.number(`${id}-offset`, offset)), 'tau');
    return g.plus(`${id}-profile`, 'half', g.mul(`${id}-wave`, 'half', g.fn(`${id}-cos`, 'cos', angle)));
  };
  const red = channel('mask-red', 0), green = channel('mask-green', 1 / 3), blue = channel('mask-blue', 2 / 3);
  // Slot Mask: dark slots every two triads, staggered by half a slot on alternate columns.
  const column = g.fn('mask-column', 'floor', phase);
  const stagger = g.fn('mask-stagger', 'fract', g.mul('mask-column-half', column, 'half'));
  const row = g.fn('mask-row', 'fract', g.plus('mask-row-staggered', g.div('mask-row-phase', g.mul('mask-y-px', v, height), g.mul('mask-slot-px', triad, 'two')), stagger));
  const slotGap = g.smooth('mask-slot-gap', g.number('mask-slot-edge0', .36), 'half', g.fn('mask-row-centre', 'abs', g.sub('mask-row-offset', row, 'half')));
  const isSlot = g.greater('mask-is-slot', 'mask-type', 'half');
  const slot = g.select('mask-slot', isSlot, 'one', g.sub('mask-slot-light', 'one', g.mul('mask-slot-depth', slotGap, g.number('mask-slot-darkness', .7))));
  const fade = g.smooth('mask-fade', g.number('mask-fade-start', CRT_MIN_STRIPE_PX * .6), g.number('mask-fade-end', CRT_MIN_STRIPE_PX), stripe);
  const strength = g.mul('mask-depth', g.mul('mask-depth-amount', 'mask-strength-clamped', 'amount-clamped'), g.mul('mask-depth-fade', fade, g.number('mask-contrast', .85)));
  const factor = (id: string, profile: string) => g.plus(`${id}-factor`, 'one', g.mul(`${id}-swing`,
    g.sub(`${id}-signed`, g.mul(`${id}-slotted`, g.mul(`${id}-double`, profile, 'two'), slot), 'one'), strength));
  g.rgb3('mask-factor', factor('mask-red', red), factor('mask-green', green), factor('mask-blue', blue));
}

/** Brightness flutter and rolling hum bar: `flicker-gain`. */
function flicker(g: AnalogRecipeBuilder) {
  const strength = g.mul('flicker-strength', 'flicker-clamped', 'amount-clamped');
  const clock = g.mul('flicker-clock', 'time', 'speed');
  const [, y] = g.split2('flicker-screen-uv', 'screen-uv');
  const roll = g.mul('flicker-roll-angle', g.sub('flicker-roll', y, g.mul('flicker-roll-time', clock, g.number('flicker-roll-rate', .15))), 'tau');
  const bar = g.plus('flicker-bar', 'half', g.mul('flicker-bar-wave', 'half', g.fn('flicker-bar-sin', 'sin', roll)));
  const flutter = g.plus('flicker-flutter', 'half', g.mul('flicker-flutter-wave', 'half', g.fn('flicker-flutter-sin', 'sin', g.mul('flicker-flutter-angle', clock, g.number('flicker-flutter-rate', 41)))));
  const dip = g.plus('flicker-dip', g.mul('flicker-bar-depth', bar, g.number('flicker-bar-strength', .12)), g.mul('flicker-flutter-depth', flutter, g.number('flicker-flutter-strength', .04)));
  g.sub('flicker-gain', 'one', g.mul('flicker-amount', dip, strength));
}

export function createDefaultCrtScreenGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g);
  controls(g);
  const cache = premultipliedSourceCache(g);
  screen(g);
  const { flatAlpha, depth } = scanlines(g, cache);
  mask(g);
  flicker(g);
  // Scanlines darken mid-tones; a mild gain keeps the overall exposure close to the source.
  const gain = g.plus('finish-gain', 'one', g.mul('finish-gain-depth', depth, g.number('finish-gain-scale', .25)));
  const shade = g.mul('finish-shade', g.mul('finish-shade-rim', 'screen-vignette', 'flicker-gain'), gain);
  const lit = g.scaleRgb('finish-lit', g.mulRgb('finish-masked', 'scan-linear', ['mask-factor', 'rgb']), shade);
  const encoded = g.binary('finish-encoded', 'math.power.rgb', g.binary('finish-positive', 'math.max.rgb', lit, ['zero-rgb', 'rgb']),
    g.rgbConstant('inverse-gamma-rgb', g.number('inverse-gamma', 1 / GAMMA)));
  const rgb = g.add('finish-rgb', 'math.clamp.rgb-scalar', { value: encoded, min: 'zero', max: 'one' });
  const alpha = g.unary('finish-alpha-value', 'convert.scalar-to-alpha', g.mul('finish-coverage', flatAlpha, 'screen-tube'));
  g.add('finish', 'vector.combine.rgba', { rgb, alpha: [alpha, 'alpha'] });
  g.add('output', 'image.output', { image: ['finish', 'image'] });
  return g.graph(10);
}
