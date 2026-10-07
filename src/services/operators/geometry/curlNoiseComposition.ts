import { FieldCompositionBuilder, type FieldRef } from '../fieldCompositionBuilder';

/** Reusable, stateless curl of a three-channel noise potential, expanded to ordinary nodes. */
function curlNoise(evolving = false) {
  const g = new FieldCompositionBuilder();
  const position = g.input('position', 'Position', 'vec3');
  const detail = g.input('detail', 'Detail (higher = smaller swirls)');
  const strength = g.input('strength', 'Strength');
  const frequency = g.binary('safe-detail', 'math.max.scalar', g.unary('absolute-detail', 'math.abs.scalar', detail), g.literal('epsilon', 0.001));
  const plus = g.literal('h-plus', 0.01), minus = g.literal('h-minus', -0.01);
  const denominator = g.binary('normalizer', 'math.multiply.scalar', g.literal('h-span', 0.02), frequency);
  const split = g.node('position', 'vector.split.vec3', { value: position }, 'x');
  const samples: Record<string, FieldRef> = {};
  for (const axis of ['x', 'y', 'z']) for (const [sign, step] of [['plus', plus], ['minus', minus]] as const) {
    const shift = g.binary(`shift-${axis}-${sign}`, 'math.add.scalar', { ...split, portId: axis }, step);
    samples[`${axis}-${sign}`] = g.node(`sample-${axis}-${sign}`, 'vector.combine.vec3', Object.fromEntries(
      ['x', 'y', 'z'].map(component => [component, component === axis ? shift : { ...split, portId: component }])));
  }
  const seeds = new Map<string, number>();
  const derivative = (potential: string, axis: string, seed: number) => {
    const pair = ['plus', 'minus'].map(sign => {
      const id = `${potential}-${axis}-${sign}`; seeds.set(id, seed);
      return g.node(id, 'field.noise', { position: samples[`${axis}-${sign}`], frequency });
    });
    return g.binary(`d${potential}-d${axis}`, 'math.subtract.scalar', pair[0], pair[1]);
  };
  const components: Record<string, FieldRef> = {};
  if (evolving) {
    const evolution = g.input('evolution', 'Evolution (turns)');
    const phase = g.binary('evolution-phase', 'math.multiply.scalar', evolution, g.literal('tau', 2 * Math.PI));
    const weightA = g.unary('evolution-a', 'math.cos.scalar', phase);
    const weightB = g.unary('evolution-b', 'math.sin.scalar', phase);
    // Rotate between independent vector potentials, rather than translating one
    // fixed field. Spatial differentiation commutes with these time-only weights.
    // cos² + sin² = 1 keeps the statistical strength stable throughout evolution.
    const fields: Record<string, Record<string, FieldRef>> = {};
    for (const [name, seedOffset] of [['a', 0], ['b', 1009]] as const) {
      const differences = {
        x: [derivative(`${name}-z`, 'y', 307 + seedOffset), derivative(`${name}-y`, 'z', 211 + seedOffset)],
        y: [derivative(`${name}-x`, 'z', 101 + seedOffset), derivative(`${name}-z`, 'x', 307 + seedOffset)],
        z: [derivative(`${name}-y`, 'x', 211 + seedOffset), derivative(`${name}-x`, 'y', 101 + seedOffset)],
      };
      fields[name] = {};
      for (const axis of ['x', 'y', 'z'] as const) {
        const numerator = g.binary(`${name}-cross-${axis}`, 'math.subtract.scalar', differences[axis][0], differences[axis][1]);
        fields[name][axis] = g.binary(`${name}-field-${axis}`, 'math.divide-ieee.scalar', numerator, denominator);
      }
    }

    for (const axis of ['x', 'y', 'z']) {
      const a = g.binary(`evolved-a-${axis}`, 'math.multiply.scalar', fields.a[axis], weightA);
      const b = g.binary(`evolved-b-${axis}`, 'math.multiply.scalar', fields.b[axis], weightB);
      const evolved = g.binary(`evolved-${axis}`, 'math.add.scalar', a, b);
      components[axis] = g.binary(`displacement-${axis}`, 'math.multiply.scalar', evolved, strength);
    }
  } else {
    const differences = {
      x: [derivative('z', 'y', 307), derivative('y', 'z', 211)],
      y: [derivative('x', 'z', 101), derivative('z', 'x', 307)],
      z: [derivative('y', 'x', 211), derivative('x', 'y', 101)],
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      const numerator = g.binary(`cross-${axis}`, 'math.subtract.scalar', differences[axis][0], differences[axis][1]);
      const normalized = g.binary(`field-${axis}`, 'math.divide-ieee.scalar', numerator, denominator);
      components[axis] = g.binary(`displacement-${axis}`, 'math.multiply.scalar', normalized, strength);
    }
  }
  const result = g.node('curl', 'vector.combine.vec3', components);
  const definition = g.finish(evolving ? 'field.curl-noise3d-evolving' : 'field.curl-noise3d', evolving ? 'Curl Noise (Evolving)' : 'Curl Noise',
    'Three-dimensional curl from independent noise potentials. Detail controls swirl size; Strength controls displacement. Animate Position to move the field.'
      + (evolving ? ' Animate Evolution to morph its shape independently.' : '')
      + ' Stateless, without collision or fluid simulation.',
    { vector: { ref: result, type: 'vec3', label: 'Vector' } });
  definition.consumers = ['Weave'];
  definition.composition!.graph.domain = 'geometry';
  for (const node of definition.composition!.graph.nodes) if (seeds.has(node.id)) {
    node.constants = { frequency: 1, amplitude: 1, octaves: 1, seed: seeds.get(node.id)! };
  }
  return definition;
}

// Preserve the original three-input contract: saved packed instances must not
// acquire an unconnected required Evolution port when reopened.
export const GEOMETRY_FIELD_COMPOSITIONS = [curlNoise(), curlNoise(true)];
