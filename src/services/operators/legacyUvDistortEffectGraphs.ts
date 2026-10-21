import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/**
 * The Wave, Twirl and Bulge recipes as they shipped before the distort review (UV-space
 * ellipses, clamped frame edges, power-curve Bulge, static Wave). Kept byte-stable only to
 * recognize untouched saved graphs; `uvDistortGraphUpgrade.ts` replaces those with the
 * current recipes. Never extend these.
 */
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const finish = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) });
const sampleTail = (): BoundOperatorNode[] => [node('sample', 'image.sample'), node('output', 'image.output')];
const sampleEdges = (uvNode: string): OperatorEdge[] => [edge('frame', 'image', 'sample', 'image'), edge(uvNode, 'value', 'sample', 'uv'), edge('sample', 'image', 'output', 'image')];

export function createLegacyWaveGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('uv-components', 'vector.split.vec2'), number('tau', Math.PI * 2),
    node('amplitude-x', 'values.number', { value: 'amplitudeX' }), node('amplitude-y', 'values.number', { value: 'amplitudeY' }),
    node('frequency-x', 'values.number', { value: 'frequencyX' }), node('frequency-y', 'values.number', { value: 'frequencyY' }),
    node('x-frequency', 'math.multiply.scalar'), node('x-phase', 'math.multiply.scalar'), node('y-wave', 'math.sin.scalar'), node('y-offset', 'math.multiply.scalar'), node('updated-y', 'math.add.scalar'),
    node('y-frequency', 'math.multiply.scalar'), node('y-phase', 'math.multiply.scalar'), node('x-wave', 'math.sin.scalar'), node('x-offset', 'math.multiply.scalar'), node('updated-x', 'math.add.scalar'),
    node('final-uv', 'vector.combine.vec2'), ...sampleTail()];
  const edges = [edge('uv', 'uv', 'uv-components', 'value'), edge('uv-components', 'x', 'x-frequency', 'a'), edge('frequency-x', 'value', 'x-frequency', 'b'),
    edge('x-frequency', 'value', 'x-phase', 'a'), edge('tau', 'value', 'x-phase', 'b'), edge('x-phase', 'value', 'y-wave', 'value'), edge('y-wave', 'value', 'y-offset', 'a'), edge('amplitude-x', 'value', 'y-offset', 'b'), edge('uv-components', 'y', 'updated-y', 'a'), edge('y-offset', 'value', 'updated-y', 'b'),
    edge('updated-y', 'value', 'y-frequency', 'a'), edge('frequency-y', 'value', 'y-frequency', 'b'), edge('y-frequency', 'value', 'y-phase', 'a'), edge('tau', 'value', 'y-phase', 'b'), edge('y-phase', 'value', 'x-wave', 'value'), edge('x-wave', 'value', 'x-offset', 'a'), edge('amplitude-y', 'value', 'x-offset', 'b'), edge('uv-components', 'x', 'updated-x', 'a'), edge('x-offset', 'value', 'updated-x', 'b'), edge('updated-x', 'value', 'final-uv', 'x'), edge('updated-y', 'value', 'final-uv', 'y'), ...sampleEdges('final-uv')];
  return finish(nodes, edges);
}

export function createLegacyTwirlGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('center-x', 'values.number', { value: 'centerX' }), node('center-y', 'values.number', { value: 'centerY' }), node('center', 'vector.combine.vec2'),
    node('delta', 'math.subtract.vec2'), node('delta-components', 'vector.split.vec2'), node('distance', 'vector.length.vec2'), node('radius', 'values.number', { value: 'radius' }), number('epsilon', .0001), node('safe-radius', 'math.max.scalar'),
    node('normalized-distance', 'math.divide-ieee.scalar'), number('one', 1), node('limited-distance', 'math.min.scalar'), node('factor', 'math.subtract.scalar'), node('amount', 'values.number', { value: 'amount' }), node('amount-factor', 'math.multiply.scalar'), node('angle', 'math.multiply.scalar'), node('sin-angle', 'math.sin.scalar'), node('cos-angle', 'math.cos.scalar'),
    node('xc', 'math.multiply.scalar'), node('ys', 'math.multiply.scalar'), node('rotated-x', 'math.subtract.scalar'), node('xs', 'math.multiply.scalar'), node('yc', 'math.multiply.scalar'), node('rotated-y', 'math.add.scalar'), node('rotated', 'vector.combine.vec2'), node('twirled-uv', 'math.add.vec2'), node('in-radius', 'compare.greater.scalar'), node('final-uv', 'select.vec2'), ...sampleTail()];
  const edges = [edge('center-x', 'value', 'center', 'x'), edge('center-y', 'value', 'center', 'y'), edge('uv', 'uv', 'delta', 'a'), edge('center', 'value', 'delta', 'b'), edge('delta', 'value', 'delta-components', 'value'), edge('delta', 'value', 'distance', 'value'), edge('radius', 'value', 'safe-radius', 'a'), edge('epsilon', 'value', 'safe-radius', 'b'), edge('distance', 'value', 'normalized-distance', 'a'), edge('safe-radius', 'value', 'normalized-distance', 'b'), edge('normalized-distance', 'value', 'limited-distance', 'a'), edge('one', 'value', 'limited-distance', 'b'), edge('one', 'value', 'factor', 'a'), edge('limited-distance', 'value', 'factor', 'b'), edge('amount', 'value', 'amount-factor', 'a'), edge('factor', 'value', 'amount-factor', 'b'), edge('amount-factor', 'value', 'angle', 'a'), edge('factor', 'value', 'angle', 'b'), edge('angle', 'value', 'sin-angle', 'value'), edge('angle', 'value', 'cos-angle', 'value'),
    edge('delta-components', 'x', 'xc', 'a'), edge('cos-angle', 'value', 'xc', 'b'), edge('delta-components', 'y', 'ys', 'a'), edge('sin-angle', 'value', 'ys', 'b'), edge('xc', 'value', 'rotated-x', 'a'), edge('ys', 'value', 'rotated-x', 'b'), edge('delta-components', 'x', 'xs', 'a'), edge('sin-angle', 'value', 'xs', 'b'), edge('delta-components', 'y', 'yc', 'a'), edge('cos-angle', 'value', 'yc', 'b'), edge('xs', 'value', 'rotated-y', 'a'), edge('yc', 'value', 'rotated-y', 'b'), edge('rotated-x', 'value', 'rotated', 'x'), edge('rotated-y', 'value', 'rotated', 'y'), edge('center', 'value', 'twirled-uv', 'a'), edge('rotated', 'value', 'twirled-uv', 'b'), edge('radius', 'value', 'in-radius', 'a'), edge('distance', 'value', 'in-radius', 'b'), edge('uv', 'uv', 'final-uv', 'falseValue'), edge('twirled-uv', 'value', 'final-uv', 'trueValue'), edge('in-radius', 'condition', 'final-uv', 'condition'), ...sampleEdges('final-uv')];
  return finish(nodes, edges);
}

export function createLegacyBulgeGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('center-x', 'values.number', { value: 'centerX' }), node('center-y', 'values.number', { value: 'centerY' }), node('center', 'vector.combine.vec2'), node('delta', 'math.subtract.vec2'), node('distance', 'vector.length.vec2'),
    number('epsilon', .0001), node('safe-distance', 'math.max.scalar'), node('radius', 'values.number', { value: 'radius' }), node('normalized-distance', 'math.divide-ieee.scalar'), node('amount', 'values.number', { value: 'amount' }), node('factor', 'math.power.scalar'), node('new-distance', 'math.multiply.scalar'), node('safe-distance-vec2', 'convert.scalar-to-vec2'), node('direction', 'math.divide-ieee.vec2'), node('radial-offset', 'math.multiply.vec2-scalar'), node('bulged-uv', 'math.add.vec2'),
    node('inside-radius', 'compare.greater.scalar'), number('zero', 0), node('outside-center', 'compare.greater.scalar'), node('active', 'logic.and.boolean'), node('final-uv', 'select.vec2'), ...sampleTail()];
  const edges = [edge('center-x', 'value', 'center', 'x'), edge('center-y', 'value', 'center', 'y'), edge('uv', 'uv', 'delta', 'a'), edge('center', 'value', 'delta', 'b'), edge('delta', 'value', 'distance', 'value'), edge('distance', 'value', 'safe-distance', 'a'), edge('epsilon', 'value', 'safe-distance', 'b'), edge('safe-distance', 'value', 'normalized-distance', 'a'), edge('radius', 'value', 'normalized-distance', 'b'), edge('normalized-distance', 'value', 'factor', 'a'), edge('amount', 'value', 'factor', 'b'), edge('factor', 'value', 'new-distance', 'a'), edge('radius', 'value', 'new-distance', 'b'), edge('safe-distance', 'value', 'safe-distance-vec2', 'value'), edge('delta', 'value', 'direction', 'a'), edge('safe-distance-vec2', 'value', 'direction', 'b'), edge('direction', 'value', 'radial-offset', 'a'), edge('new-distance', 'value', 'radial-offset', 'b'), edge('center', 'value', 'bulged-uv', 'a'), edge('radial-offset', 'value', 'bulged-uv', 'b'), edge('radius', 'value', 'inside-radius', 'a'), edge('distance', 'value', 'inside-radius', 'b'), edge('distance', 'value', 'outside-center', 'a'), edge('zero', 'value', 'outside-center', 'b'), edge('inside-radius', 'condition', 'active', 'a'), edge('outside-center', 'condition', 'active', 'b'), edge('uv', 'uv', 'final-uv', 'falseValue'), edge('bulged-uv', 'value', 'final-uv', 'trueValue'), edge('active', 'value', 'final-uv', 'condition'), ...sampleEdges('final-uv')];
  return finish(nodes, edges);
}
