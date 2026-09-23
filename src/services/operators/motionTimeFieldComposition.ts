import { FieldCompositionBuilder } from './fieldCompositionBuilder';

/** Numeric motion data: RG velocity in UV/graph-second, B confidence, A validity. */
export function motionTimeFieldComposition() {
  const g = new FieldCompositionBuilder();
  const image = g.input('image', 'Motion field', 'image');
  const mode = g.input('mode', 'Magnitude / directional (0/1)');
  const angle = g.input('angle', 'Direction (radians)');
  const min = g.input('min', 'Minimum velocity (UV/s)'), max = g.input('max', 'Maximum velocity (UV/s)');
  const confidence = g.input('confidence', 'Confidence threshold');
  const zero = g.literal('zero', 0), one = g.literal('one', 1), epsilon = g.literal('epsilon', .000001);
  const rgba = g.node('rgba', 'convert.image-to-vec4', { image });
  const xy = g.node('components', 'vector.split.vec4', { value: rgba }, 'x');
  const y = { ...xy, portId: 'y' };
  const square = (id: string, value: typeof xy) => g.binary(id, 'math.multiply.scalar', value, value);
  const magnitude = g.unary('magnitude', 'math.sqrt.scalar', g.binary('length-squared', 'math.add.scalar', square('x2', xy), square('y2', y)));
  const directional = g.binary('projection', 'math.add.scalar',
    g.binary('project-x', 'math.multiply.scalar', xy, g.unary('cos', 'math.cos.scalar', angle)),
    g.binary('project-y', 'math.multiply.scalar', y, g.unary('sin', 'math.sin.scalar', angle)));
  const velocity = g.select('velocity', g.greater('directional', mode, g.literal('half', .5)), magnitude, directional);
  const span = g.binary('span', 'math.subtract.scalar', max, min);
  const normalized = g.binary('normalized', 'math.divide-ieee.scalar', g.binary('offset', 'math.subtract.scalar', velocity, min),
    g.binary('safe-span', 'math.max.scalar', span, epsilon));
  const bounded = g.node('bounded', 'math.clamp.scalar', { value: normalized, min: zero, max: one });
  const value = g.select('valid-range', g.greater('positive-range', span, epsilon), zero, bounded);
  const threshold = g.node('threshold', 'math.clamp.scalar', { value: confidence, min: zero, max: one });
  const reliability = g.node('reliability', 'math.smoothstep.scalar', { value: { ...xy, portId: 'z' }, edge0: threshold,
    edge1: g.binary('confidence-end', 'math.add.scalar', threshold, g.literal('confidence-feather', .1)) });
  const valid = g.node('validity', 'math.clamp.scalar', { value: { ...xy, portId: 'w' }, min: zero, max: one });
  const weight = g.binary('weight', 'math.multiply.scalar', reliability, valid);
  return g.finish('field.motion', 'Motion to Field',
    'Normalizes motion magnitude or its projection on an axis in radians. RG is UV per graph-second; confidence and validity provide a separate fallback weight.',
    { value: { ref: value }, weight: { ref: weight } });
}
