import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { premultipliedSourceCache, type GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { RIBBON_SCAN_MIN_RIBBONS, RIBBON_SCAN_REACH } from '../../effects/analog/ribbonScanLimits';

/**
 * Ribbon Scan recipe (see docs/Features/Effects-Analog.md).
 * - Ribbons: Ribbons bands over the frame height scroll down by Speed bands per second of timeline
 *   time. A band ramps in over its first 18 % and out over its last 38 %.
 * - Displacement: inside a band the picture shifts sideways by sin(2 pi phase) x Displacement^2 x
 *   RIBBON_SCAN_REACH of the frame width (6 % at 1, 0.54 % at the default 0.3), so the low half of the
 *   control stays subtle and the subject stays readable.
 * - Edges: reads past the frame edge mirror back in (Mirror) or wrap around (Wrap); the edge pixel
 *   is never smeared.
 * - Alpha: both reads come from a premultiplied cache and blend premultiplied, so cut-out edges
 *   keep their colour.
 */
function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('tau', Math.PI * 2);
  g.number('coverage-floor', 1e-6);
  g.split2('uv-split', ['uv', 'uv']);
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.max('ribbons', g.bound('scale', 'scale'), g.number('ribbons-min', RIBBON_SCAN_MIN_RIBBONS));
  g.bound('speed', 'speed');
  g.bound('edges', 'edges', 'values.choice');
}

/** Band phase (`ribbon-phase`), band envelope (`ribbon`) and the sideways shift in frame widths (`ribbon-shift`). */
function ribbons(g: AnalogRecipeBuilder) {
  const phase = g.fn('ribbon-phase', 'fract', g.sub('ribbon-phase-raw', g.mul('ribbon-position', ['uv-split', 'y'], 'ribbons'), g.mul('ribbon-scroll', 'time', 'speed')));
  const rise = g.smooth('ribbon-rise', 'zero', g.number('ribbon-rise-end', .18), phase);
  const fall = g.sub('ribbon-fall', 'one', g.smooth('ribbon-fall-step', g.number('ribbon-fall-start', .62), 'one', phase));
  const envelope = g.mul('ribbon', rise, fall);
  const curve = g.mul('ribbon-reach', g.mul('ribbon-amount-squared', 'amount-clamped', 'amount-clamped'), g.number('ribbon-reach-scale', RIBBON_SCAN_REACH));
  g.mul('ribbon-shift', g.mul('ribbon-wave-reach', g.fn('ribbon-wave', 'sin', g.mul('ribbon-angle', phase, 'tau')), curve), envelope);
}

/** Read position of the shifted picture with mirrored or wrapped edges (`read-uv`). */
function readPosition(g: AnalogRecipeBuilder) {
  const x = g.plus('read-x', ['uv-split', 'x'], 'ribbon-shift');
  const wrapped = g.fn('read-wrap', 'fract', x);
  // Mirror: 1 - |2 fract(x / 2) - 1| folds every overshoot back into [0, 1].
  const folded = g.mul('read-fold', g.fn('read-fold-fract', 'fract', g.mul('read-half', x, 'half')), 'two');
  const mirrored = g.sub('read-mirror', 'one', g.fn('read-mirror-distance', 'abs', g.sub('read-fold-centred', folded, 'one')));
  const edge = g.select('read-edge-x', g.greater('read-is-wrap', 'edges', 'half'), mirrored, wrapped);
  g.vec2('read-uv', edge, ['uv-split', 'y']);
}

function premultipliedRead(g: AnalogRecipeBuilder, id: string, cache: string, uv: GraphPort): string {
  g.add(`${id}-sample`, 'image.sample', { image: [cache, 'image'], uv });
  return g.add(id, 'convert.image-to-vec4', { image: [`${id}-sample`, 'image'] });
}

export function createDefaultRibbonScanGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g);
  const cache = premultipliedSourceCache(g);
  ribbons(g); readPosition(g);
  const original = premultipliedRead(g, 'original', cache, ['uv', 'uv']);
  const shifted = premultipliedRead(g, 'shifted', cache, 'read-uv');
  const blended = g.add('finish-blend', 'math.mix.vec4', { a: original, b: shifted, t: 'ribbon' });
  g.add('finish-image', 'convert.vec4-to-image', { value: blended });
  g.add('finish-split', 'vector.split.rgba', { image: ['finish-image', 'image'] });
  const alpha = g.add('finish-alpha', 'convert.alpha-to-scalar', { alpha: ['finish-split', 'alpha'] });
  const rgb = g.add('finish-rgb', 'math.divide-ieee.rgb-scalar', { a: ['finish-split', 'rgb'], b: g.max('finish-safe-alpha', alpha, 'coverage-floor') });
  g.add('finish', 'vector.combine.rgba', { rgb, alpha: ['finish-split', 'alpha'] });
  g.add('output', 'image.output', { image: ['finish', 'image'] });
  return g.graph(10);
}
