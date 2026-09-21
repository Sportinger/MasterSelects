import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';

const n = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1, bindings: {},
  ...(value === undefined ? {} : { constants: { value } }) });
const endpoint = (nodeId: string, portId: string): OperatorEndpoint => ({ nodeId, portId });
const p = (id: string, label: string, type: OperatorPort['type']): OperatorPort => ({ id, label, type, required: true });
const graph = (nodes: BoundOperatorNode[], links: [string, string, string, string][]): EffectOperatorGraph => {
  const column = (id: string): number => Math.max(0, ...links.filter(link => link[2] === id).map(link => column(link[0]) + 1));
  const rows = new Map<number, number>();
  const layout = Object.fromEntries(nodes.map(node => {
    const x = column(node.id), y = rows.get(x) ?? 0; rows.set(x, y + 1);
    return [node.id, { x: x * 300, y: y * 320 }];
  }));
  return {
  version: 1, schemaVersion: 1, domain: 'image', nodes,
  edges: links.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
  layout,
}; };
const definition = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[],
  composition: NonNullable<OperatorDefinition['composition']>): OperatorDefinition => ({
  id, version: 1, label, description, inputs, outputs, composition, parameters: [], runtime: 'builtin',
  invalidates: 'appearance', addable: true, state: 'stateless', fusion: 'inline', implementation: 'shared', consumers: ['Image graphs'],
});

/** Immutable v1 formulas, shared by every instance; radians and raw image IEEE arithmetic. */
export const COORDINATE_COMPOSITIONS: readonly OperatorDefinition[] = [
  definition('coordinates.cartesian-to-polar.vec2', 'Cartesian to Polar',
    'Position relative to a center → radius and angle in radians. Open to inspect subtraction, length and atan2.',
    [p('position', 'Position', 'vec2'), p('center', 'Center', 'vec2')], [p('radius', 'Radius', 'number'), p('angle', 'Angle (rad)', 'number')], {
      graph: graph([n('offset', 'math.subtract.vec2'), n('split', 'vector.split.vec2'), n('angle', 'math.atan2.scalar'), n('radius', 'vector.length.vec2')],
        [['offset', 'value', 'split', 'value'], ['split', 'y', 'angle', 'y'], ['split', 'x', 'angle', 'x'], ['offset', 'value', 'radius', 'value']]),
      inputs: { position: [endpoint('offset', 'a')], center: [endpoint('offset', 'b')] },
      outputs: { radius: endpoint('radius', 'value'), angle: endpoint('angle', 'value') },
    }),
  definition('math.mirror-repeat.scalar', 'Mirror Repeat',
    'Wrap a value into a positive period, then reflect its second half. Output spans 0…period/2; no normalization or clamping. Period must be positive.',
    [p('value', 'Value', 'number'), p('period', 'Period', 'number')], [p('value', 'Value', 'number')], {
      graph: graph([n('progress', 'math.divide-ieee.scalar'), n('fraction', 'math.fract.scalar'), n('wrapped', 'math.multiply.scalar'),
        n('half', 'values.number', .5), n('midpoint', 'math.multiply.scalar'), n('past', 'compare.greater.scalar'),
        n('reflected', 'math.subtract.scalar'), n('result', 'select.scalar')], [
        ['progress', 'value', 'fraction', 'value'], ['fraction', 'value', 'wrapped', 'a'], ['half', 'value', 'midpoint', 'b'],
        ['wrapped', 'value', 'past', 'a'], ['midpoint', 'value', 'past', 'b'], ['wrapped', 'value', 'reflected', 'b'],
        ['wrapped', 'value', 'result', 'falseValue'], ['reflected', 'value', 'result', 'trueValue'], ['past', 'condition', 'result', 'condition'],
      ]),
      inputs: { value: [endpoint('progress', 'a')], period: [endpoint('progress', 'b'), endpoint('wrapped', 'b'), endpoint('midpoint', 'a'), endpoint('reflected', 'a')] },
      outputs: { value: endpoint('result', 'value') },
    }),
  definition('coordinates.polar-to-cartesian.vec2', 'Polar to Cartesian',
    'Radius and angle in radians → position around a center. Open to inspect direction, scaling and offset.',
    [p('radius', 'Radius', 'number'), p('angle', 'Angle (rad)', 'number'), p('center', 'Center', 'vec2')], [p('position', 'Position', 'vec2')], {
      graph: graph([n('direction', 'vector.unit-direction.scalar'), n('radial', 'math.multiply.vec2-scalar'), n('position', 'math.add.vec2')],
        [['direction', 'value', 'radial', 'a'], ['radial', 'value', 'position', 'a']]),
      inputs: { radius: [endpoint('radial', 'b')], angle: [endpoint('direction', 'angle')], center: [endpoint('position', 'b')] },
      outputs: { position: endpoint('position', 'value') },
    }),
  definition('coordinates.divide-x.vec2', 'Divide X',
    'Divide X by max(divisor, minimum divisor), preserving Y. The floor is explicit; this is not an absolute-value guard.',
    [p('value', 'Coordinates', 'vec2'), p('divisor', 'Divisor', 'number'), p('minimum', 'Minimum divisor', 'number')], [p('value', 'Coordinates', 'vec2')], {
      graph: graph([n('split', 'vector.split.vec2'), n('safe', 'math.max.scalar'), n('divide', 'math.divide-ieee.scalar'), n('result', 'vector.combine.vec2')], [
        ['split', 'x', 'divide', 'a'], ['safe', 'value', 'divide', 'b'], ['divide', 'value', 'result', 'x'], ['split', 'y', 'result', 'y'],
      ]),
      inputs: { value: [endpoint('split', 'value')], divisor: [endpoint('safe', 'a')], minimum: [endpoint('safe', 'b')] },
      outputs: { value: endpoint('result', 'value') },
    }),
  definition('coordinates.restore-lens.vec2', 'Restore Lens Coordinates',
    'Lens position to image coordinates: radius, undo squeeze, rotate in radians, optionally undo aspect, then add center. Both divisions share an explicit minimum divisor.',
    [p('position', 'Lens position', 'vec2'), p('radius', 'Radius scale', 'number'), p('squeeze', 'Squeeze', 'number'),
      p('rotation', 'Rotation (rad)', 'number'), p('aspect', 'Aspect', 'number'), p('preserveAspect', 'Preserve aspect', 'boolean'),
      p('center', 'Center', 'vec2'), p('minimum', 'Minimum divisor', 'number')], [p('uv', 'UV', 'vec2')], {
      graph: graph([n('radial', 'math.multiply.vec2-scalar'), n('unsqueeze', 'coordinates.divide-x.vec2'), n('rotate', 'coordinates.rotate.vec2'),
        n('aspect', 'coordinates.divide-x.vec2'), n('select', 'select.vec2'), n('position', 'math.add.vec2')], [
        ['radial', 'value', 'unsqueeze', 'value'], ['unsqueeze', 'value', 'rotate', 'value'], ['rotate', 'value', 'aspect', 'value'],
        ['rotate', 'value', 'select', 'falseValue'], ['aspect', 'value', 'select', 'trueValue'], ['select', 'value', 'position', 'b'],
      ]),
      inputs: { position: [endpoint('radial', 'a')], radius: [endpoint('radial', 'b')], squeeze: [endpoint('unsqueeze', 'divisor')],
        rotation: [endpoint('rotate', 'angle')], aspect: [endpoint('aspect', 'divisor')], preserveAspect: [endpoint('select', 'condition')],
        center: [endpoint('position', 'a')], minimum: [endpoint('unsqueeze', 'minimum'), endpoint('aspect', 'minimum')] },
      outputs: { uv: endpoint('position', 'value') },
    }),
];

/** Apply only newly introduced rules to previously migrated graphs; local ungrouping stays local. */
export const coordinateCompositionRevision = (id: string): 1 | 2 =>
  id === 'coordinates.divide-x.vec2' || id === 'coordinates.restore-lens.vec2' ? 2 : 1;

export const getOperatorComposition = (id: string) => COORDINATE_COMPOSITIONS.find(definition => definition.id === id);
