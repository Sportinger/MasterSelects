import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { GAUSSIAN_REACH_SIGMAS, SEPARABLE_MAX_PAIRS_PER_SIDE } from '../../effects/blur/blurSampling';
import { SHARPEN_MIN_SIGMA_PX, SHARPEN_OVERSHOOT, SHARPEN_REFERENCE_HEIGHT } from '../../effects/stylize/sharpen/sharpenModel';
import { BlurGraphBuilder, premultipliedSourceCache, type GraphPort } from './blurGraphBuilder';
import { separablePass } from './blurEffectGraphs';

/**
 * Sharpen v2 (contract in `effects/stylize/sharpen/sharpenModel.ts`): the frame premultiplied
 * into a cache, a separable Gaussian of it (the Gaussian Blur passes), a brightness unsharp mask
 * and a halo limit from the darkest and brightest brightness around each pixel. Three GPU passes.
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

  // Halo limit: darkest and brightest brightness in a 3x3 window, one sigma (at least a pixel) apart.
  const windowExtent = (mode: 'darkest' | 'brightest', blendMode: number): GraphPort => {
    const index = g.add(`${mode}-index`, 'image.sequence-index');
    const third = g.binary(`${mode}-third`, 'math.divide-ieee.scalar', [index, 'index'], g.number(`${mode}-three`, 3));
    const row = g.unary(`${mode}-row`, 'math.floor.scalar', third);
    const column = g.binary(`${mode}-column`, 'math.subtract.scalar', [index, 'index'], g.binary(`${mode}-row-start`, 'math.multiply.scalar', row, `${mode}-three`));
    const offset = g.add(`${mode}-offset`, 'vector.combine.vec2', { x: g.binary(`${mode}-dx`, 'math.subtract.scalar', column, 'one'), y: g.binary(`${mode}-dy`, 'math.subtract.scalar', row, 'one') });
    const uv = g.binary(`${mode}-uv`, 'math.add.vec2', ['uv', 'uv'], g.binary(`${mode}-offset-uv`, 'math.divide-ieee.vec2',
      g.add(`${mode}-offset-px`, 'math.multiply.vec2-scalar', { a: offset, b: 'window-step' }), 'resolution'));
    // Window taps fall between texels: read the premultiplied cache and divide by alpha.
    const tap = g.add(`${mode}-tap`, 'vector.split.rgba', { image: [g.add(`${mode}-sample`, 'image.sample', { image: [premultiplied, 'image'], uv }), 'image'] });
    const tapAlpha = g.add(`${mode}-tap-alpha`, 'convert.alpha-to-scalar', { alpha: [tap, 'alpha'] });
    const tapLuma = g.binary(`${mode}-luma`, 'math.divide-ieee.scalar', g.add(`${mode}-luma-premultiplied`, 'color.luminance-rec709.rgb', { rgb: [tap, 'rgb'] }),
      g.binary(`${mode}-alpha-safe`, 'math.max.scalar', tapAlpha, 'alpha-floor'));
    const grey = g.add(`${mode}-grey`, 'vector.combine.rgba', { rgb: [g.add(`${mode}-grey-rgb`, 'convert.scalar-to-rgb', { value: tapLuma }), 'rgb'], alpha: [tap, 'alpha'] });
    // Transparent taps have no weight, so they never set the window.
    const blend = g.add(`${mode}-window`, 'image.sequence-blend', { sample: [grey, 'image'], weight: tapAlpha,
      count: 'window-taps', mode: g.number(`${mode}-mode`, blendMode) });
    return [g.add(`${mode}-value`, 'color.luminance-rec709.image', { image: [blend, 'image'] }), 'value'];
  };
  g.binary('window-step', 'math.max.scalar', sigma, 'one'); g.number('window-taps', 9);
  const darkest = windowExtent('darkest', 0), brightest = windowExtent('brightest', 1);
  g.number('overshoot', SHARPEN_OVERSHOOT);
  const margin = g.binary('halo-margin', 'math.multiply.scalar', g.binary('window-range', 'math.subtract.scalar', brightest, darkest), 'overshoot');
  const limited = g.add('limited-luma', 'math.clamp.scalar', { value: sharpened, min: g.binary('halo-floor', 'math.subtract.scalar', darkest, margin),
    max: g.binary('halo-ceiling', 'math.add.scalar', brightest, margin) });
  const change = g.add('luma-change', 'convert.scalar-to-rgb', { value: g.binary('luma-delta', 'math.subtract.scalar', limited, luma) });
  const result = g.add('result-rgb', 'math.clamp.rgb-scalar', { value: g.binary('result-raw', 'math.add.rgb', [source, 'rgb'], [change, 'rgb']), min: 'zero', max: 'one' });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: result, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
