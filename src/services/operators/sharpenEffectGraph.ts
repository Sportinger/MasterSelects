import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { GAUSSIAN_REACH_SIGMAS, SEPARABLE_MAX_PAIRS_PER_SIDE } from '../../effects/blur/blurSampling';
import { SHARPEN_EMPTY_ROW, SHARPEN_EXPONENT_LIMIT, SHARPEN_MARGIN_FLOOR, SHARPEN_MIN_SIGMA_PX, SHARPEN_OVERSHOOT, SHARPEN_REFERENCE_HEIGHT, SHARPEN_ROLL_OFF,
  SHARPEN_WINDOW_MAX_TAPS_PER_SIDE, SHARPEN_WINDOW_SHARPNESS, SHARPEN_WINDOW_SIGMAS } from '../../effects/stylize/sharpen/sharpenModel';
import { BlurGraphBuilder, premultipliedSourceCache, type GraphPort } from './blurGraphBuilder';
import { separablePass } from './blurEffectGraphs';

/**
 * Sharpen v2 (contract in `effects/stylize/sharpen/sharpenModel.ts`): the frame premultiplied
 * into a cache; a row pass that blurs its brightness and alpha horizontally (the Gaussian Blur's
 * separable pass) and takes the smooth darkest and brightest brightness of a dense row window;
 * and a final pass that blurs vertically, takes the same extremes over a column of those rows,
 * sharpens brightness and rolls off what passes the neighbourhood's range. Three GPU passes;
 * nothing depends on the timeline time.
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
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const luma = g.add('source-luma', 'color.luminance-rec709.rgb', { rgb: [source, 'rgb'] });

  // Window: taps one pixel apart (wider steps beyond SHARPEN_WINDOW_MAX_TAPS_PER_SIDE) over
  // ±SHARPEN_WINDOW_SIGMAS sigma, so the extremes follow the picture smoothly from pixel to pixel.
  g.number('window-sigmas', SHARPEN_WINDOW_SIGMAS); g.number('window-taps-limit', SHARPEN_WINDOW_MAX_TAPS_PER_SIDE);
  const windowReach = g.binary('window-reach', 'math.max.scalar', g.binary('window-reach-raw', 'math.multiply.scalar', sigma, 'window-sigmas'), 'one');
  const windowSide = g.binary('window-side', 'math.min.scalar', g.unary('window-side-needed', 'math.ceil.scalar', windowReach), 'window-taps-limit');
  const windowStep = g.binary('window-step', 'math.divide-ieee.scalar', windowReach, windowSide);
  const windowCount = g.binary('window-count', 'math.add.scalar', g.binary('window-side-double', 'math.multiply.scalar', windowSide, 'two'), 'one');
  const windowIndex = g.add('window-index', 'vector.split.vec2', { value: g.add('window-kernel', 'image.kernel-index') });
  const windowOffsetPx = (axis: 'x' | 'y') => g.binary(`window-${axis}-px`, 'math.multiply.scalar',
    g.binary(`window-${axis}`, 'math.subtract.scalar', [windowIndex, axis], windowSide), windowStep);
  // Smooth extremes: exponentially weighted means relative to this pixel's brightness, limited so the sums stay finite.
  g.number('window-sharpness', SHARPEN_WINDOW_SHARPNESS); g.number('exponent-limit', SHARPEN_EXPONENT_LIMIT); g.number('exponent-floor', -SHARPEN_EXPONENT_LIMIT);
  const extremeWeight = (id: string, value: GraphPort, direction: 'bright' | 'dark') => {
    const difference = direction === 'bright' ? g.binary(`${id}-difference`, 'math.subtract.scalar', value, luma)
      : g.binary(`${id}-difference`, 'math.subtract.scalar', luma, value);
    return g.unary(id, 'math.exp.scalar', g.add(`${id}-exponent`, 'math.clamp.scalar', { value: g.binary(`${id}-exponent-raw`, 'math.multiply.scalar',
      difference, 'window-sharpness'), min: 'exponent-floor', max: 'exponent-limit' }));
  };
  /** (bright weight × bright value, bright weight, dark weight × dark value, dark weight) as one image for a Kernel Sum. */
  const momentsImage = (prefix: string, bright: GraphPort, dark: GraphPort) => {
    const brightWeight = extremeWeight(`${prefix}-bright-weight`, bright, 'bright'), darkWeight = extremeWeight(`${prefix}-dark-weight`, dark, 'dark');
    return g.add(`${prefix}-moments`, 'convert.vec4-to-image', { value: g.add(`${prefix}-moments-vec4`, 'vector.combine.vec4', {
      x: g.binary(`${prefix}-bright-moment`, 'math.multiply.scalar', brightWeight, bright), y: brightWeight,
      z: g.binary(`${prefix}-dark-moment`, 'math.multiply.scalar', darkWeight, dark), w: darkWeight }) });
  };
  const extremes = (prefix: string, sums: string): [string, string] => [
    g.binary(`${prefix}-brightest`, 'math.divide-ieee.scalar', [sums, 'x'], g.binary(`${prefix}-bright-total`, 'math.max.scalar', [sums, 'y'], 'weight-floor')),
    g.binary(`${prefix}-darkest`, 'math.divide-ieee.scalar', [sums, 'z'], g.binary(`${prefix}-dark-total`, 'math.max.scalar', [sums, 'w'], 'weight-floor'))];

  // Row pass: horizontal blur (premultiplied brightness, alpha) and the row's extremes.
  const horizontal = g.add('horizontal-split', 'vector.split.rgba', { image: separablePass(g, 'horizontal', [premultiplied, 'image'], weightAt) });
  const rowUv = g.binary('row-uv', 'math.add.vec2', ['uv', 'uv'], g.binary('row-offset-uv', 'math.divide-ieee.vec2',
    g.add('row-offset-px', 'vector.combine.vec2', { x: windowOffsetPx('x'), y: 'zero' }), 'resolution'));
  const rowTap = g.add('row-tap', 'vector.split.rgba', { image: [g.add('row-sample', 'image.sample', { image: [premultiplied, 'image'], uv: rowUv }), 'image'] });
  const rowTapAlpha = g.add('row-tap-alpha', 'convert.alpha-to-scalar', { alpha: [rowTap, 'alpha'] });
  const rowTapLuma = g.binary('row-tap-luma', 'math.divide-ieee.scalar', g.add('row-tap-luma-premultiplied', 'color.luminance-rec709.rgb', { rgb: [rowTap, 'rgb'] }),
    g.binary('row-tap-alpha-safe', 'math.max.scalar', rowTapAlpha, 'alpha-floor'));
  const rowReduce = g.add('row-reduce', 'image.kernel-rect-reduce',
    { sample: [momentsImage('row', rowTapLuma, rowTapLuma), 'image'], weight: rowTapAlpha, width: windowCount, height: 'one' });
  const rowSums = g.add('row-sums', 'vector.split.vec4', { value: [rowReduce, 'sum'] });
  const [rowBrightest, rowDarkest] = extremes('row', rowSums);
  // A row without any opaque tap marks itself out of range, so the column ignores it.
  g.number('empty-row-low', -SHARPEN_EMPTY_ROW); g.number('empty-row-high', SHARPEN_EMPTY_ROW);
  const rowCovered = g.binary('row-covered', 'compare.greater.scalar', [rowReduce, 'weightSum'], 'alpha-floor');
  const rowImage = g.add('row-image', 'convert.vec4-to-image', { value: g.add('row-vec4', 'vector.combine.vec4', {
    x: g.add('row-blur-luma', 'color.luminance-rec709.rgb', { rgb: [horizontal, 'rgb'] }), y: g.add('row-blur-alpha', 'convert.alpha-to-scalar', { alpha: [horizontal, 'alpha'] }),
    z: g.add('row-max', 'select.scalar', { condition: [rowCovered, 'condition'], trueValue: rowBrightest, falseValue: 'empty-row-low' }),
    w: g.add('row-min', 'select.scalar', { condition: [rowCovered, 'condition'], trueValue: rowDarkest, falseValue: 'empty-row-high' }) }) });
  const rows = g.add('row-cache', 'image.materialize', { image: [rowImage, 'image'] });

  // Final pass: vertical blur → unsharp mask on brightness (blurred brightness un-premultiplied).
  const blurred = g.add('vertical-split', 'vector.split.vec4', { value: [g.add('vertical-vec4', 'convert.image-to-vec4', { image: separablePass(g, 'vertical', [rows, 'image'], weightAt) }), 'value'] });
  const blurLuma = g.binary('blur-luma', 'math.divide-ieee.scalar', [blurred, 'x'], g.binary('blur-alpha', 'math.max.scalar', [blurred, 'y'], 'alpha-floor'));
  const detail = g.binary('detail', 'math.subtract.scalar', luma, blurLuma);
  const sharpened = g.binary('sharpened-luma', 'math.add.scalar', luma, g.binary('scaled-detail', 'math.multiply.scalar', detail, amount));

  // Column of row extremes: the darkest and brightest brightness of the whole window.
  const columnUv = g.binary('column-uv', 'math.add.vec2', ['uv', 'uv'], g.binary('column-offset-uv', 'math.divide-ieee.vec2',
    g.add('column-offset-px', 'vector.combine.vec2', { x: 'zero', y: windowOffsetPx('y') }), 'resolution'));
  const columnTap = g.add('column-tap', 'vector.split.vec4', { value: [g.add('column-tap-vec4', 'convert.image-to-vec4', { image: [g.add('column-sample', 'image.sample', { image: [rows, 'image'], uv: columnUv }), 'image'] }), 'value'] });
  const columnSums = g.add('column-sums', 'vector.split.vec4', { value: [g.add('column-reduce', 'image.kernel-rect-reduce',
    { sample: [momentsImage('column', [columnTap, 'z'], [columnTap, 'w']), 'image'], weight: 'one', width: 'one', height: windowCount }), 'sum'] });
  const [brightest, darkest] = extremes('window', columnSums);

  // Halo limit: the result may pass the window's range by a margin (Overshoot of the range, at
  // least the margin floor); beyond it the excess rolls off logarithmically, never flat.
  g.number('overshoot', SHARPEN_OVERSHOOT); g.number('margin-floor', SHARPEN_MARGIN_FLOOR); g.number('roll-off', SHARPEN_ROLL_OFF);
  const margin = g.binary('halo-margin', 'math.max.scalar', g.binary('halo-margin-raw', 'math.multiply.scalar',
    g.binary('window-range', 'math.subtract.scalar', brightest, darkest), 'overshoot'), 'margin-floor');
  const ceiling = g.binary('halo-ceiling', 'math.max.scalar', g.binary('halo-ceiling-raw', 'math.add.scalar', brightest, margin), luma);
  const floor = g.binary('halo-floor', 'math.min.scalar', g.binary('halo-floor-raw', 'math.subtract.scalar', darkest, margin), luma);
  // Never 0, so a Roll Off or Margin Floor of 0 typed into the graph becomes a hard limit instead of NaN.
  const scale = g.binary('roll-off-scale', 'math.max.scalar', g.binary('roll-off-scale-raw', 'math.multiply.scalar', margin, 'roll-off'), 'alpha-floor');
  const rollOff = (id: string, excess: string) => g.binary(id, 'math.multiply.scalar', scale, g.unary(`${id}-log`, 'math.log.scalar',
    g.binary(`${id}-ratio`, 'math.add.scalar', 'one', g.binary(`${id}-share`, 'math.divide-ieee.scalar', excess, scale))));
  const above = g.binary('excess-above', 'math.max.scalar', g.binary('excess-above-raw', 'math.subtract.scalar', sharpened, ceiling), 'zero');
  const below = g.binary('excess-below', 'math.max.scalar', g.binary('excess-below-raw', 'math.subtract.scalar', floor, sharpened), 'zero');
  const inside = g.add('inside-range', 'math.clamp.scalar', { value: sharpened, min: floor, max: ceiling });
  const limited = g.binary('limited-luma', 'math.subtract.scalar', g.binary('limited-luma-up', 'math.add.scalar', inside, rollOff('roll-off-above', above)), rollOff('roll-off-below', below));
  const change = g.add('luma-change', 'convert.scalar-to-rgb', { value: g.binary('limited-change', 'math.subtract.scalar', limited, luma) });
  const result = g.add('result-rgb', 'math.clamp.rgb-scalar', { value: g.binary('result-raw', 'math.add.rgb', [source, 'rgb'], [change, 'rgb']), min: 'zero', max: 'one' });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: result, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
