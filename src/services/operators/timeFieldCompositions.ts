import { motionTimeFieldComposition } from './motionTimeFieldComposition';
import { edgeTimeFieldComposition } from './edgeTimeFieldComposition';
import { FieldCompositionBuilder } from './fieldCompositionBuilder';

function imageChannel() {
  const g = new FieldCompositionBuilder();
  const image = g.input('image', 'Image', 'image'), channel = g.input('channel', 'Channel (0–7)');
  const phase = g.input('phase', 'Hue phase (turns)'), ramp = g.input('hueRamp', 'Direct hue ramp (0/1)');
  const zero = g.literal('zero', 0), one = g.literal('one', 1), half = g.literal('half', .5);
  const rgba = g.node('rgba', 'convert.image-to-vec4', { image });
  const split = g.node('channels', 'vector.split.vec4', { value: rgba }, 'x');
  const rgb = g.node('rgb', 'convert.vec4-to-rgb', { value: rgba }, 'rgb');
  const hsv = g.node('hsv', 'convert.rgb-to-hsv', { rgb });
  const parts = g.node('hsv-parts', 'vector.split.vec3', { value: hsv }, 'x');
  const shifted = g.binary('shifted-hue', 'math.add.scalar', parts, phase);
  const angle = g.binary('hue-angle', 'math.multiply.scalar', shifted, g.literal('tau', Math.PI * 2));
  const wave = g.binary('hue-wave', 'math.add.scalar', half,
    g.binary('hue-amplitude', 'math.multiply.scalar', half, g.unary('hue-sine', 'math.sin.scalar', angle)));
  const hue = g.select('hue', g.greater('ramp-enabled', ramp, half), wave, g.unary('hue-wrap', 'math.fract.scalar', shifted));
  const options = [g.node('luma', 'color.luminance-rec709.image', { image }), { ...split, portId: 'w' },
    split, { ...split, portId: 'y' }, { ...split, portId: 'z' }, hue, { ...parts, portId: 'y' }, { ...parts, portId: 'z' }];
  let selected = options[0];
  for (let i = 1; i < options.length; i++) selected = g.select(`channel-${i}`,
    g.greater(`after-${i}`, channel, g.literal(`threshold-${i}`, i - .5)), selected, options[i]);
  const isHue = g.node('is-hue', 'math.multiply.scalar', {
    a: g.select('hue-or-later', g.greater('hue-low', channel, g.literal('hue-min', 4.5)), zero, one),
    b: g.select('before-saturation', g.greater('hue-high', channel, g.literal('hue-max', 5.5)), one, zero),
  });
  const saturationWeight = g.node('saturation-weight', 'math.smoothstep.scalar', {
    value: { ...parts, portId: 'y' }, edge0: zero, edge1: g.literal('saturation-minimum', .05),
  });
  const weight = g.mix('weight', one, saturationWeight, isHue);
  return g.finish('field.image-channel', 'Image Channel',
    'Extract source-encoded Luma, Alpha, R, G, B, Hue, Saturation or Value (0–7). Hue uses a periodic wave unless Direct hue ramp is enabled. Weight fades undefined hue on gray pixels.',
    { value: { ref: selected, label: 'Field' }, weight: { ref: weight, label: 'Validity weight' } });
}

function normalizeField() {
  const g = new FieldCompositionBuilder();
  const value = g.input('value', 'Field'), low = g.input('min', 'Input minimum'), high = g.input('max', 'Input maximum');
  const gamma = g.input('gamma', 'Gamma'), invert = g.input('invert', 'Invert (0/1)');
  const zero = g.literal('zero', 0), one = g.literal('one', 1), epsilon = g.literal('epsilon', .000001);
  const span = g.binary('span', 'math.subtract.scalar', high, low);
  const safe = g.binary('safe-span', 'math.max.scalar', span, epsilon);
  const position = g.binary('position', 'math.divide-ieee.scalar', g.binary('offset', 'math.subtract.scalar', value, low), safe);
  const bounded = g.node('bounded', 'math.clamp.scalar', { value: position, min: zero, max: one });
  const normalized = g.select('normalized', g.greater('valid-range', span, zero), zero, bounded);
  const curved = g.binary('curve', 'math.power.scalar', normalized, g.binary('safe-gamma', 'math.max.scalar', gamma, g.literal('minimum-gamma', .001)));
  const result = g.select('result', g.greater('invert-enabled', invert, g.literal('half', .5)), curved,
    g.binary('inverted', 'math.subtract.scalar', one, curved));
  return g.finish('field.normalize', 'Normalize Field',
    'Remap and clamp a field to 0–1, apply a positive gamma, then optionally invert. Empty/reversed ranges become zero before inversion.', { value: { ref: result } });
}

function valueNoise() {
  const g = new FieldCompositionBuilder();
  const uv = g.input('uv', 'UV', 'vec2'), scale = g.input('scale', 'Scale'), seed = g.input('seed', 'Seed');
  const time = g.input('time', 'Time (s)'), drift = g.input('drift', 'Drift (UV/s)', 'vec2'), hard = g.input('hard', 'Hard cells (0/1)');
  const zero = g.literal('zero', 0), one = g.literal('one', 1), two = g.literal('two', 2), three = g.literal('three', 3);
  const seedOffset = g.node('seed-offset', 'vector.combine.vec2', { x: seed, y: g.binary('seed-y', 'math.multiply.scalar', seed, g.literal('seed-ratio', 1.61803398875)) });
  const moving = g.binary('moving-uv', 'math.add.vec2', uv, g.binary('drift-offset', 'math.multiply.vec2', drift, g.unary('time-vec2', 'convert.scalar-to-vec2', time)));
  const position = g.binary('position', 'math.add.vec2', seedOffset,
    g.binary('scaled-uv', 'math.multiply.vec2', moving, g.unary('scale-vec2', 'convert.scalar-to-vec2', scale)));
  const cell = g.unary('cell', 'math.floor.vec2', position), fraction = g.unary('fraction', 'math.fract.vec2', position);
  const parts = g.node('parts', 'vector.split.vec2', { value: fraction }, 'x');
  const smooth = (axis: 'x' | 'y') => {
    const f = { ...parts, portId: axis };
    return g.binary(`smooth-${axis}`, 'math.multiply.scalar', g.binary(`square-${axis}`, 'math.multiply.scalar', f, f),
      g.binary(`falloff-${axis}`, 'math.subtract.scalar', three, g.binary(`double-${axis}`, 'math.multiply.scalar', two, f)));
  };
  const sx = smooth('x'), sy = smooth('y');
  const hashes = [[zero, zero], [one, zero], [zero, one], [one, one]].map(([x, y], i) =>
    g.unary(`hash-${i}`, 'noise.hash2d.vec2', g.binary(`corner-${i}`, 'math.add.vec2', cell,
      g.node(`offset-${i}`, 'vector.combine.vec2', { x, y }))));
  const interpolated = g.mix('interpolated', g.mix('row-0', hashes[0], hashes[1], sx), g.mix('row-1', hashes[2], hashes[3], sx), sy);
  const result = g.select('result', g.greater('hard-enabled', hard, g.literal('half', .5)), interpolated, hashes[0]);
  return g.finish('field.noise2d', 'Smooth Value Noise 2D',
    'Deterministic four-corner value noise with cubic interpolation. Explicit UV drift and time, with optional hard grid cells. No playback history or hidden random state.',
    { value: { ref: result } });
}

function combineFields() {
  const g = new FieldCompositionBuilder();
  const a = g.input('a', 'Field A'), b = g.input('b', 'Field B'), amount = g.input('amount', 'Strength');
  const operation = g.input('operation', 'Operation (0–4)');
  const zero = g.literal('zero', 0), one = g.literal('one', 1);
  const strength = g.node('strength', 'math.clamp.scalar', { value: amount, min: zero, max: one });
  const centered = g.binary('centered-b', 'math.subtract.scalar', b, g.literal('half', .5));
  const choices = [g.mix('mix', a, b, strength),
    g.binary('add', 'math.add.scalar', a, g.binary('offset', 'math.multiply.scalar', centered, strength)),
    g.mix('multiply', a, g.binary('product', 'math.multiply.scalar', a, b), strength),
    g.mix('minimum', a, g.binary('min', 'math.min.scalar', a, b), strength),
    g.mix('maximum', a, g.binary('max', 'math.max.scalar', a, b), strength)];
  let result = choices[0];
  for (let i = 1; i < choices.length; i++) result = g.select(`operation-${i}`,
    g.greater(`after-${i}`, operation, g.literal(`threshold-${i}`, i - .5)), result, choices[i]);
  return g.finish('field.combine', 'Combine Fields',
    'Mix, centered Add, Multiply, Minimum or Maximum (0–4). Strength zero preserves A; the final field is clamped to 0–1.',
    { value: { ref: g.node('bounded', 'math.clamp.scalar', { value: result, min: zero, max: one }) } });
}

export const TIME_FIELD_COMPOSITIONS = [imageChannel(), normalizeField(), valueNoise(), combineFields(), motionTimeFieldComposition(), edgeTimeFieldComposition()];
