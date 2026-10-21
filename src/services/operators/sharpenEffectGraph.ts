import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { GAUSSIAN_REACH_SIGMAS, SEPARABLE_MAX_PAIRS_PER_SIDE } from '../../effects/blur/blurSampling';
import { SHARPEN_EXPONENT_LIMIT, SHARPEN_MIN_SIGMA_PX, SHARPEN_OVERSHOOT, SHARPEN_REFERENCE_HEIGHT, SHARPEN_WINDOW_SHARPNESS, SHARPEN_WINDOW_TAPS } from '../../effects/stylize/sharpen/sharpenModel';
import { BlurGraphBuilder, premultipliedSourceCache } from './blurGraphBuilder';
import { separablePass } from './blurEffectGraphs';

/**
 * Sharpen v2 (contract in `effects/stylize/sharpen/sharpenModel.ts`): the frame premultiplied
 * into a cache, a separable Gaussian of it (the Gaussian Blur passes), a brightness unsharp mask
 * and a soft halo limit towards the darkest and brightest brightness around each pixel. Three GPU
 * passes; nothing depends on the timeline time.
 */
export function createDefaultSharpenGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5); g.number('weight-floor', 1e-20); g.number('alpha-floor', 1e-6);
  const amount = g.bound('amount', 'amount'), radius = g.bound('radius', 'radius');

  // Radius: Gaussian sigma in pixels of a 1080p frame.
  g.number('reference-height', SHARPEN_REFERENCE_HEIGHT); g.number('sigma-minimum', SHARPEN_MIN_SIGMA_PX);
  const pixelScale = g.binary('pixel-scale', 'math.divide-ieee.scalar', g.unary('short-side', 'vector.reduce-min.vec2', 'resolution'), 'reference-height');
  const sigma = g.binary('sigma', 'math.max.scalar', g.binary('sigma-raw', 'math.multiply.scalar', radius, pixelScale), 'sigma-minimum');
  g.number('reach-sigmas', GAUSSIAN_REACH_SIGMAS);
  const reach = g.binary('reach', 'math.multiply.scalar', sigma, 'reach-sigmas');
  g.number('pairs-limit', SEPARABLE_MAX_PAIRS_PER_SIDE); g.number('pair-span-limit', 2 * SEPARABLE_MAX_PAIRS_PER_SIDE);
  g.binary('pairs', 'math.min.scalar', g.unary('pairs-needed', 'math.ceil.scalar', g.binary('reach-half', 'math.multiply.scalar', reach, 'half')), 'pairs-limit');
  g.binary('stride', 'math.max.scalar', g.binary('stride-raw', 'math.divide-ieee.scalar', reach, 'pair-span-limit'), 'one');
  g.binary('tap-count', 'math.add.scalar', g.binary('pairs-double', 'math.multiply.scalar', 'pairs', 'two'), 'one');
  const weightAt = (id: string, offset: string) => g.add(id, 'math.gaussian.scalar', { value: offset, sigma });
  // Filtered taps read the premultiplied cache: exact at alpha edges (no dark fringe).
  const premultiplied = premultipliedSourceCache(g);
  const horizontal = separablePass(g, 'horizontal', [premultiplied, 'image'], weightAt);
  const cache = g.add('horizontal-cache', 'image.materialize', { image: horizontal });
  const blurred = separablePass(g, 'vertical', [cache, 'image'], weightAt);

  // Unsharp mask on brightness: blurred colour is un-premultiplied before its luma is taken.
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const luma = g.add('source-luma', 'color.luminance-rec709.rgb', { rgb: [source, 'rgb'] });
  const blurSplit = g.add('blur-split', 'vector.split.rgba', { image: blurred });
  const blurAlpha = g.binary('blur-alpha', 'math.max.scalar', g.add('blur-alpha-raw', 'convert.alpha-to-scalar', { alpha: [blurSplit, 'alpha'] }), 'alpha-floor');
  const blurLuma = g.binary('blur-luma', 'math.divide-ieee.scalar', g.add('blur-luma-premultiplied', 'color.luminance-rec709.rgb', { rgb: [blurSplit, 'rgb'] }), blurAlpha);
  const detail = g.binary('detail', 'math.subtract.scalar', luma, blurLuma);
  const sharpened = g.binary('sharpened-luma', 'math.add.scalar', luma, g.binary('scaled-detail', 'math.multiply.scalar', detail, amount));

  // Halo limit window: SHARPEN_WINDOW_TAPS² taps evenly spread over ±max(sigma, 1) px, read from the
  // premultiplied cache (exact between texels, transparent taps weigh nothing). One Kernel Sum
  // gathers exponentially weighted brightness: a smooth darkest and brightest value of the window
  // that cannot alias like a sparse minimum and maximum.
  g.number('window-taps', SHARPEN_WINDOW_TAPS); g.number('window-centre', (SHARPEN_WINDOW_TAPS - 1) / 2);
  const windowStep = g.binary('window-step', 'math.divide-ieee.scalar', g.binary('window-reach', 'math.max.scalar', sigma, 'one'), 'window-centre');
  const windowIndex = g.add('window-index', 'vector.split.vec2', { value: g.add('window-kernel', 'image.kernel-index') });
  const windowOffset = g.add('window-offset', 'vector.combine.vec2', { x: g.binary('window-x', 'math.subtract.scalar', [windowIndex, 'x'], 'window-centre'),
    y: g.binary('window-y', 'math.subtract.scalar', [windowIndex, 'y'], 'window-centre') });
  const windowUv = g.binary('window-uv', 'math.add.vec2', ['uv', 'uv'], g.binary('window-offset-uv', 'math.divide-ieee.vec2',
    g.add('window-offset-px', 'math.multiply.vec2-scalar', { a: windowOffset, b: windowStep }), 'resolution'));
  const tap = g.add('window-tap', 'vector.split.rgba', { image: [g.add('window-sample', 'image.sample', { image: [premultiplied, 'image'], uv: windowUv }), 'image'] });
  const tapAlpha = g.add('window-tap-alpha', 'convert.alpha-to-scalar', { alpha: [tap, 'alpha'] });
  const tapLuma = g.binary('window-luma', 'math.divide-ieee.scalar', g.add('window-luma-premultiplied', 'color.luminance-rec709.rgb', { rgb: [tap, 'rgb'] }),
    g.binary('window-alpha-safe', 'math.max.scalar', tapAlpha, 'alpha-floor'));
  // Exponents relative to this pixel's brightness, limited so the sums stay finite for any picture.
  g.number('window-sharpness', SHARPEN_WINDOW_SHARPNESS); g.number('exponent-limit', SHARPEN_EXPONENT_LIMIT); g.number('exponent-floor', -SHARPEN_EXPONENT_LIMIT);
  const exponent = g.add('window-exponent', 'math.clamp.scalar', { value: g.binary('window-exponent-raw', 'math.multiply.scalar',
    g.binary('window-difference', 'math.subtract.scalar', tapLuma, luma), 'window-sharpness'), min: 'exponent-floor', max: 'exponent-limit' });
  const towardsBright = g.unary('window-bright-weight', 'math.exp.scalar', exponent);
  const towardsDark = g.unary('window-dark-weight', 'math.exp.scalar', g.binary('window-exponent-negative', 'math.subtract.scalar', 'zero', exponent));
  const moments = g.add('window-moments', 'convert.vec4-to-image', { value: g.add('window-moments-vec4', 'vector.combine.vec4', {
    x: g.binary('window-bright-luma', 'math.multiply.scalar', towardsBright, tapLuma), y: towardsBright,
    z: g.binary('window-dark-luma', 'math.multiply.scalar', towardsDark, tapLuma), w: towardsDark }) });
  const windowSums = g.add('window-sums', 'vector.split.vec4', { value: [g.add('window-reduce', 'image.kernel-rect-reduce',
    { sample: [moments, 'image'], weight: tapAlpha, width: 'window-taps', height: 'window-taps' }), 'sum'] });
  const brightest = g.binary('brightest-value', 'math.divide-ieee.scalar', [windowSums, 'x'], g.binary('brightest-weight', 'math.max.scalar', [windowSums, 'y'], 'weight-floor'));
  const darkest = g.binary('darkest-value', 'math.divide-ieee.scalar', [windowSums, 'z'], g.binary('darkest-weight', 'math.max.scalar', [windowSums, 'w'], 'weight-floor'));

  // Soft limit: the change approaches the room up to (or down to) the window's range plus
  // Overshoot, room * (1 - exp(-change / room)), so plateaus keep their gradation.
  g.number('overshoot', SHARPEN_OVERSHOOT); g.number('room-floor', 1e-6);
  const margin = g.binary('halo-margin', 'math.multiply.scalar', g.binary('window-range', 'math.subtract.scalar', brightest, darkest), 'overshoot');
  const roomUp = g.binary('halo-room-up', 'math.max.scalar', g.binary('halo-room-up-raw', 'math.subtract.scalar',
    g.binary('halo-ceiling', 'math.add.scalar', brightest, margin), luma), 'room-floor');
  const roomDown = g.binary('halo-room-down', 'math.max.scalar', g.binary('halo-room-down-raw', 'math.subtract.scalar', luma,
    g.binary('halo-floor', 'math.subtract.scalar', darkest, margin)), 'room-floor');
  const detailChange = g.binary('detail-change', 'math.subtract.scalar', sharpened, luma);
  const softLimit = (id: string, push: string, room: string) => g.binary(id, 'math.multiply.scalar', room, g.binary(`${id}-share`, 'math.subtract.scalar', 'one',
    g.unary(`${id}-falloff`, 'math.exp.scalar', g.binary(`${id}-exponent`, 'math.divide-ieee.scalar', g.binary(`${id}-negative`, 'math.subtract.scalar', 'zero', push), room))));
  const up = softLimit('halo-limited-up', g.binary('detail-up', 'math.max.scalar', detailChange, 'zero'), roomUp);
  const down = softLimit('halo-limited-down', g.binary('detail-down', 'math.max.scalar', g.binary('detail-negative', 'math.subtract.scalar', 'zero', detailChange), 'zero'), roomDown);
  const limitedChange = g.binary('limited-change', 'math.subtract.scalar', up, down);
  const change = g.add('luma-change', 'convert.scalar-to-rgb', { value: limitedChange });
  const result = g.add('result-rgb', 'math.clamp.rgb-scalar', { value: g.binary('result-raw', 'math.add.rgb', [source, 'rgb'], [change, 'rgb']), min: 'zero', max: 'one' });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: result, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
