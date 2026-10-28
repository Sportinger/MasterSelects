import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { chance, indexKey, keyConstants, modulo, pixelScale, roll, seedSalt, KEY_RANGE } from './seededRecipeParts';
import { axisLine, bandAverage } from './axisBandNodes';
import {
  PIXEL_SORT_BANDS_DRIFT_RANGE, PIXEL_SORT_BANDS_FADE, PIXEL_SORT_BANDS_LENGTH_RANGE, PIXEL_SORT_BANDS_MIN_LENGTH, PIXEL_SORT_BANDS_MIN_SPAN,
  PIXEL_SORT_BANDS_OFFSET_RANGE, PIXEL_SORT_BANDS_SEED_RANGE, PIXEL_SORT_BANDS_TILT_RANGE, PIXEL_SORT_BANDS_WIDTH_RANGE,
} from '../../effects/analog/pixelSortBandsLimits';

/**
 * Pixel Sort Bands recipe (see docs/Features/effects/pixel-sort-bands.md): a pixel sorter whose streaks grow
 * with Progress, after the textur-animation prototypes (pixelsort*.py, sort_kombi5.py).
 * - Lines run vertically or horizontally (Direction), slanted by Tilt. They are grouped into bands Band Width
 *   pixels wide from Band Offset (1080p pixels); every band takes its average colour at each position along it
 *   (axisBandNodes.ts), cached once.
 * - Sorting: where the band's Sort By value (brightness, hue or saturation) lies within Range of Centre, the band
 *   sorts; each band reacts a seeded share (Band Variation) wider or narrower. Runs also break at seeded points,
 *   about one per Max Length pixels, so streaks have a length; Drift slides those break points along the lines.
 *   Segment Sort (image.segment-sort-axis) sorts every run Low to High or High to Low.
 * - Progress 0..1 grows Range from 0.03 and the streak length from 3 px to their full values and fades the
 *   sorted bands in over the first quarter. At Progress 0 the picture is the input exactly (and the renderer
 *   skips the effect); key Progress 1 → 0 for streaks that settle into the original.
 * - Layer 2 (Vertical or Horizontal; Off folds it away) sorts the result once more with its own bands, Centre
 *   and Range, at Layer 2 Strength × Progress, starting after Layer 2 Delay (a woven cross, or fine + wide bands).
 * - Sorted pixels take the band colour; alpha stays the input's. Amount mixes with the input.
 */
const SALT = { bandSpan: 1, breaks: 2, layer2: 3 } as const;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('two', 2); g.number('coverage-floor', 1e-6);
  keyConstants(g);
  g.unary('pixel', 'math.floor.vec2', g.mul2('pixel-centre', ['uv', 'uv'], ['resolution', 'value']));
}

function controls(g: AnalogRecipeBuilder) {
  const scale = pixelScale(g);
  g.clampedParam('progress', 'progress', 'zero', 'one');
  g.clampedParam('tilt', 'tilt', g.number('tilt-min', PIXEL_SORT_BANDS_TILT_RANGE[0]), g.number('tilt-max', PIXEL_SORT_BANDS_TILT_RANGE[1]));
  g.add('slope', 'math.tan.scalar', { value: g.add('tilt-radians', 'convert.degrees-to-radians.scalar', { value: 'tilt-clamped' }) });
  g.clampedParam('variation', 'variation', 'zero', 'one');
  g.clampedParam('length', 'maxLength', g.number('length-min', PIXEL_SORT_BANDS_LENGTH_RANGE[0]), g.number('length-max', PIXEL_SORT_BANDS_LENGTH_RANGE[1]));
  g.clampedParam('drift', 'drift', g.number('drift-min', PIXEL_SORT_BANDS_DRIFT_RANGE[0]), g.number('drift-max', PIXEL_SORT_BANDS_DRIFT_RANGE[1]));
  g.mul('drift-px', 'drift-clamped', scale);
  g.clampedParam('seed', 'seed', g.number('seed-min', PIXEL_SORT_BANDS_SEED_RANGE[0]), g.number('seed-max', PIXEL_SORT_BANDS_SEED_RANGE[1]));
  g.clampedParam('amount', 'amount', 'zero', 'one');
  seedSalt(g);
  // Sort By: Brightness 0, Hue 1, Saturation 2. Order: Low to High 0, High to Low 1.
  g.bound('sort-by', 'sortBy', 'values.choice');
  g.add('descending', 'math.step.scalar', { edge: 'half', value: g.bound('order', 'order', 'values.choice') });
  const minLength = g.mul('length-short', g.number('length-start', PIXEL_SORT_BANDS_MIN_LENGTH), scale);
  g.sub('length-span', g.mul('length-scaled', 'length-clamped', scale), minLength);
  // Layer 2: Off 0, Vertical 1, Horizontal 2; its progress starts after Delay and reaches Strength.
  g.bound('layer2', 'layer2', 'values.choice');
  g.greater('layer2-on', 'layer2', 'half');
  g.add('layer2-rows', 'math.step.scalar', { edge: g.number('layer2-rows-edge', 1.5), value: 'layer2' });
  g.clampedParam('layer2-strength', 'layer2Strength', 'zero', 'one');
  g.clampedParam('layer2-delay', 'layer2Delay', 'zero', g.number('layer2-delay-max', .95));
  const late = g.div('layer2-late', g.max('layer2-after', g.sub('layer2-past', 'progress-clamped', 'layer2-delay-clamped'), 'zero'),
    g.sub('layer2-span', 'one', 'layer2-delay-clamped'));
  g.mul('layer2-progress', g.smooth('layer2-ease', 'zero', 'one', late), 'layer2-strength-clamped');
}

interface LayerSettings { direction: string; width: string; offset: string; centre: string; range: string; rows?: GraphPort; progress: GraphPort; salt: number }

/**
 * One sort layer of `source`: band cache, key, mask and run starts, Segment Sort, and the sorted colour mixed in
 * where the band sorts. Layer 1 uses plain node ids (`band-cache`, `run-start`, …), Layer 2 prefixes them.
 * Returns the layer's result (straight RGB, alpha of `source`).
 */
function sortLayer(g: AnalogRecipeBuilder, p: string, source: GraphPort, settings: LayerSettings): GraphPort {
  const n = (name: string) => p ? `${p}-${name}` : name;
  const scale = pixelScale(g);
  const width = g.max(n('width-px'), g.mul(n('width-scaled'), g.clampedParam(n('width'), settings.width,
    g.number(n('width-min'), PIXEL_SORT_BANDS_WIDTH_RANGE[0]), g.number(n('width-max'), PIXEL_SORT_BANDS_WIDTH_RANGE[1])), scale), 'one');
  const offset = g.mul(n('offset-px'), g.clampedParam(n('offset'), settings.offset,
    g.number(n('offset-min'), PIXEL_SORT_BANDS_OFFSET_RANGE[0]), g.number(n('offset-max'), PIXEL_SORT_BANDS_OFFSET_RANGE[1])), scale);
  const centre = g.clampedParam(n('centre'), settings.centre, 'zero', 'one');
  const range = g.clampedParam(n('range'), settings.range, 'zero', 'one');
  // Direction: Vertical 0, Horizontal 1 (Layer 2 reads its own choice).
  const rows = settings.rows ?? g.add(n('rows'), 'math.step.scalar', { edge: 'half', value: g.bound(n('direction'), settings.direction, 'values.choice') });
  const line = axisLine(g, n('line'), 'pixel', rows, 'slope');
  const band = bandAverage(g, n('band'), source, line, width, offset, rows);
  // One cached band image: the sort moves it, the key and mask read it at this pixel.
  g.add(n('band-cache'), 'image.materialize', { image: band.image });
  g.add(n('band-here'), 'image.sample', { image: [n('band-cache'), 'image'], uv: ['uv', 'uv'] });
  g.add(n('band-split'), 'vector.split.rgba', { image: [n('band-here'), 'image'] });
  const coverage = g.add(n('band-here-coverage'), 'convert.alpha-to-scalar', { alpha: [n('band-split'), 'alpha'] });
  const luma = g.add(n('key-luma'), 'color.luminance-rec709.rgb', { rgb: [n('band-split'), 'rgb'] });
  g.add(n('key-hsv'), 'vector.split.vec3', { value: g.add(n('key-hsv-vector'), 'convert.rgb-to-hsv', { rgb: [n('band-split'), 'rgb'] }) });
  const isHue = g.sub(n('key-is-hue'), g.add(n('key-hue-low'), 'math.step.scalar', { edge: 'half', value: 'sort-by' }),
    g.add(n('key-hue-high'), 'math.step.scalar', { edge: g.number(n('key-saturation-edge'), 1.5), value: 'sort-by' }));
  const isSaturation = g.add(n('key-is-saturation'), 'math.step.scalar', { edge: n('key-saturation-edge'), value: 'sort-by' });
  const key = g.mix(n('key'), g.mix(n('key-luma-or-hue'), luma, [n('key-hsv'), 'x'], isHue), [n('key-hsv'), 'y'], isSaturation);
  const sortKey = g.mix(n('sort-key'), key, g.sub(n('key-flipped'), 'one', key), 'descending');

  // Range grows with progress; each band reacts (1 − v) to (1 + v) times as wide.
  const bandKey = modulo(g, n('band-key'), indexKey(g, n('band-key-shifted'), g.plus(n('band-salted'), band.index, g.number(n('band-layer'), settings.salt * 977))), KEY_RANGE);
  const bandRoll = roll(g, n('band-roll'), SALT.bandSpan, bandKey, 'zero', 'zero');
  const factor = g.plus(n('span-factor'), g.sub(n('span-low'), 'one', 'variation-clamped'), g.mul(n('span-spread'), g.mul(n('span-twice'), 'variation-clamped', 'two'), bandRoll));
  const span = g.mul(n('span'), g.plus(n('span-base'), g.number(n('span-min'), PIXEL_SORT_BANDS_MIN_SPAN), g.mul(n('span-grown'), range, settings.progress)), factor);
  const distance = g.fn(n('key-distance'), 'abs', g.sub(n('key-offset'), key, centre));
  const inRange = g.sub(n('in-range'), 'one', g.add(n('out-of-range'), 'math.step.scalar', { edge: span, value: distance }));
  const mask = g.mul(n('mask'), inRange, g.add(n('band-inside'), 'math.step.scalar', { edge: 'half', value: coverage }));

  // Seeded breaks, about one per streak length; Drift slides them along the lines.
  const length = g.max(n('length-px'), g.plus(n('length-now'), 'length-short', g.mul(n('length-grown'), 'length-span', settings.progress)), 'one');
  const position = g.fn(n('break-position'), 'floor', g.plus(n('break-drifted'), line.along, 'drift-px'));
  const positionKey = modulo(g, n('break-key'), g.plus(n('break-key-positive'), position, g.number(n('break-key-lift'), KEY_RANGE * 64)), KEY_RANGE);
  const broken = chance(g, n('run-break'), roll(g, n('break-roll'), SALT.breaks, bandKey, positionKey, 'zero'), g.div(n('break-chance'), 'one', length));
  const start = g.max(n('run-start'), g.sub(n('unmasked'), 'one', mask), broken);

  const sort = g.add(n('sort'), 'image.segment-sort-axis', { image: [n('band-cache'), 'image'], key: sortKey, start, angle: 'tilt-clamped' },
    { bindings: { axis: settings.direction }, constants: { order: 'ascending' } });
  g.add(n('sorted'), 'image.sample', { image: [sort, 'image'], uv: ['uv', 'uv'] });
  g.add(n('sorted-split'), 'vector.split.rgba', { image: [n('sorted'), 'image'] });
  // The sorted band colour replaces the pixel where its band sorts, faded in over the first quarter of progress.
  const fade = g.smooth(n('fade'), 'zero', g.number(n('fade-end'), PIXEL_SORT_BANDS_FADE), settings.progress);
  const strength = g.mul(n('strength'), g.mul(n('mask-faded'), mask, fade), 'amount-clamped');
  g.add(n('source-here'), 'image.sample', { image: source, uv: ['uv', 'uv'] });
  g.add(n('source-split'), 'vector.split.rgba', { image: [n('source-here'), 'image'] });
  const rgb = g.mixRgb(n('result-rgb'), [n('source-split'), 'rgb'], [n('sorted-split'), 'rgb'], strength);
  return [g.add(n('result'), 'vector.combine.rgba', { rgb, alpha: [n('source-split'), 'alpha'] }), 'image'];
}

export function createDefaultPixelSortBandsGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g);
  const first = sortLayer(g, '', ['frame', 'image'], { direction: 'direction', width: 'bandWidth', offset: 'bandOffset', centre: 'centre', range: 'range',
    progress: 'progress-clamped', salt: 0 });
  // Layer 2 sorts the first result again; Off folds the Switch at compile time, so its passes are never built.
  g.add('layer1-cache', 'image.materialize', { image: first });
  const second = sortLayer(g, 'l2', ['layer1-cache', 'image'], { direction: 'layer2', width: 'layer2Width', offset: 'layer2Offset', centre: 'layer2Centre',
    range: 'layer2Range', rows: 'layer2-rows', progress: 'layer2-progress', salt: SALT.layer2 });
  g.add('layers', 'control.select.image', { condition: ['layer2-on', 'condition'], falseValue: first, trueValue: second });
  g.add('output', 'image.output', { image: ['layers', 'image'] });
  return g.graph(10);
}
