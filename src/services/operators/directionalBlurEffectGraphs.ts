import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableDirectionalBlurEffectType = 'motion-blur' | 'radial-blur' | 'zoom-blur';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const finish = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 270, y: Math.floor(index / 8) * 350 }])) });
const common = (maximum: number) => [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('sequence', 'image.sequence-index'),
  node('samples', 'values.number', { value: 'samples' }), number('minimum-samples', 4), node('samples-at-least-minimum', 'math.max.scalar'),
  number('maximum-samples', maximum), node('samples-over-maximum', 'compare.greater.scalar'), node('count', 'select.scalar'),
  node('sample', 'image.sample'), node('reduce', 'image.sequence-reduce'),
  node('weight-vec4', 'convert.scalar-to-vec4'), node('average', 'math.divide-ieee.vec4'), node('blurred', 'convert.vec4-to-image'), node('output', 'image.output')];
const reduceEdges = (sampleUv: string, weight: string): OperatorEdge[] => [edge('frame', 'image', 'sample', 'image'), edge(sampleUv, 'value', 'sample', 'uv'),
  edge('sample', 'image', 'reduce', 'sample'), edge(weight, 'value', 'reduce', 'weight'), edge('count', 'value', 'reduce', 'count'),
  edge('samples', 'value', 'samples-at-least-minimum', 'a'), edge('minimum-samples', 'value', 'samples-at-least-minimum', 'b'),
  edge('samples-at-least-minimum', 'value', 'samples-over-maximum', 'a'), edge('maximum-samples', 'value', 'samples-over-maximum', 'b'),
  edge('samples-at-least-minimum', 'value', 'count', 'falseValue'), edge('maximum-samples', 'value', 'count', 'trueValue'), edge('samples-over-maximum', 'condition', 'count', 'condition'),
  edge('reduce', 'weightSum', 'weight-vec4', 'value'), edge('reduce', 'sum', 'average', 'a'), edge('weight-vec4', 'value', 'average', 'b'), edge('average', 'value', 'blurred', 'value')];

export function createDefaultMotionBlurGraph(): EffectOperatorGraph {
  const nodes = [...common(128), node('amount', 'values.number', { value: 'amount' }), node('angle', 'values.number', { value: 'angle' }),
    node('cos', 'math.cos.scalar'), node('sin', 'math.sin.scalar'), node('direction', 'vector.combine.vec2'), number('half', .5), node('centered-t', 'math.subtract.scalar'),
    number('two', 2), node('signed-t', 'math.multiply.scalar'), node('signed-t-vec2', 'convert.scalar-to-vec2'), node('direction-t', 'math.multiply.vec2'),
    node('amount-vec2', 'convert.scalar-to-vec2'), node('offset', 'math.multiply.vec2'), node('sample-uv-unwrapped', 'math.add.vec2'),
    node('sample-uv', 'coordinates.mirror-repeat.vec2'), number('zero', 0), node('negative-t', 'math.subtract.scalar'), node('negative-t-squared', 'math.multiply.scalar'),
    node('weight-exponent', 'math.multiply.scalar'), node('weight', 'math.exp.scalar'), number('bypass-threshold', .001), node('bypass', 'compare.greater.scalar'),
    node('selected', 'control.select.image')];
  const edges = [...reduceEdges('sample-uv', 'weight'), edge('angle', 'value', 'cos', 'value'), edge('angle', 'value', 'sin', 'value'),
    edge('cos', 'value', 'direction', 'x'), edge('sin', 'value', 'direction', 'y'), edge('sequence', 't', 'centered-t', 'a'), edge('half', 'value', 'centered-t', 'b'),
    edge('centered-t', 'value', 'signed-t', 'a'), edge('two', 'value', 'signed-t', 'b'), edge('signed-t', 'value', 'signed-t-vec2', 'value'),
    edge('direction', 'value', 'direction-t', 'a'), edge('signed-t-vec2', 'value', 'direction-t', 'b'), edge('amount', 'value', 'amount-vec2', 'value'),
    edge('direction-t', 'value', 'offset', 'a'), edge('amount-vec2', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv-unwrapped', 'a'),
    edge('offset', 'value', 'sample-uv-unwrapped', 'b'), edge('sample-uv-unwrapped', 'value', 'sample-uv', 'value'), edge('zero', 'value', 'negative-t', 'a'),
    edge('signed-t', 'value', 'negative-t', 'b'), edge('negative-t', 'value', 'negative-t-squared', 'a'), edge('signed-t', 'value', 'negative-t-squared', 'b'),
    edge('negative-t-squared', 'value', 'weight-exponent', 'a'), edge('two', 'value', 'weight-exponent', 'b'), edge('weight-exponent', 'value', 'weight', 'value'),
    edge('bypass-threshold', 'value', 'bypass', 'a'), edge('amount', 'value', 'bypass', 'b'), edge('bypass', 'condition', 'selected', 'condition'),
    edge('blurred', 'image', 'selected', 'falseValue'), edge('frame', 'image', 'selected', 'trueValue'), edge('selected', 'image', 'output', 'image')];
  return finish(nodes, edges);
}

function radialNodes(): BoundOperatorNode[] { return [...common(256), node('amount', 'values.number', { value: 'amount' }),
  node('center-x', 'values.number', { value: 'centerX' }), node('center-y', 'values.number', { value: 'centerY' }), node('center', 'vector.combine.vec2'),
  node('direction', 'math.subtract.vec2'), number('one', 1)]; }
const radialBaseEdges = (): OperatorEdge[] => [edge('center-x', 'value', 'center', 'x'), edge('center-y', 'value', 'center', 'y'),
  edge('uv', 'uv', 'direction', 'a'), edge('center', 'value', 'direction', 'b')];

export function createDefaultRadialBlurGraph(): EffectOperatorGraph {
  const nodes = [...radialNodes(), node('distance', 'vector.length.vec2'), number('half', .5), number('amount-scale', .2), node('scaled-amount', 'math.multiply.scalar'), node('amount-t', 'math.multiply.scalar'),
    node('amount-t-distance', 'math.multiply.scalar'), node('scale', 'math.subtract.scalar'), node('scale-vec2', 'convert.scalar-to-vec2'), node('scaled-direction', 'math.multiply.vec2'),
    node('sample-uv', 'math.add.vec2'), node('t-half', 'math.multiply.scalar'), node('weight', 'math.subtract.scalar'), number('bypass-threshold', .01),
    node('bypass', 'compare.greater.scalar'), node('selected', 'control.select.image')];
  const edges = [...radialBaseEdges(), ...reduceEdges('sample-uv', 'weight'), edge('direction', 'value', 'distance', 'value'),
    edge('amount', 'value', 'scaled-amount', 'a'), edge('amount-scale', 'value', 'scaled-amount', 'b'), edge('scaled-amount', 'value', 'amount-t', 'a'),
    edge('sequence', 't', 'amount-t', 'b'), edge('amount-t', 'value', 'amount-t-distance', 'a'), edge('distance', 'value', 'amount-t-distance', 'b'),
    edge('one', 'value', 'scale', 'a'), edge('amount-t-distance', 'value', 'scale', 'b'), edge('scale', 'value', 'scale-vec2', 'value'),
    edge('direction', 'value', 'scaled-direction', 'a'), edge('scale-vec2', 'value', 'scaled-direction', 'b'), edge('center', 'value', 'sample-uv', 'a'),
    edge('scaled-direction', 'value', 'sample-uv', 'b'), edge('sequence', 't', 't-half', 'a'), edge('half', 'value', 't-half', 'b'),
    edge('one', 'value', 'weight', 'a'), edge('t-half', 'value', 'weight', 'b'), edge('bypass-threshold', 'value', 'bypass', 'a'), edge('amount', 'value', 'bypass', 'b'),
    edge('bypass', 'condition', 'selected', 'condition'), edge('blurred', 'image', 'selected', 'falseValue'), edge('frame', 'image', 'selected', 'trueValue'),
    edge('selected', 'image', 'output', 'image')];
  return finish(nodes, edges);
}

export function createDefaultZoomBlurGraph(): EffectOperatorGraph {
  const nodes = [...radialNodes(), number('amount-scale', .5), node('scaled-amount', 'math.multiply.scalar'), node('amount-t', 'math.multiply.scalar'),
    node('scale', 'math.add.scalar'), node('scale-vec2', 'convert.scalar-to-vec2'), node('scaled-direction', 'math.multiply.vec2'), node('sample-uv', 'math.add.vec2'), number('weight', 1)];
  const edges = [...radialBaseEdges(), ...reduceEdges('sample-uv', 'weight'), edge('amount', 'value', 'scaled-amount', 'a'), edge('amount-scale', 'value', 'scaled-amount', 'b'),
    edge('scaled-amount', 'value', 'amount-t', 'a'), edge('sequence', 't', 'amount-t', 'b'), edge('one', 'value', 'scale', 'a'), edge('amount-t', 'value', 'scale', 'b'),
    edge('scale', 'value', 'scale-vec2', 'value'), edge('direction', 'value', 'scaled-direction', 'a'), edge('scale-vec2', 'value', 'scaled-direction', 'b'),
    edge('center', 'value', 'sample-uv', 'a'), edge('scaled-direction', 'value', 'sample-uv', 'b'), edge('blurred', 'image', 'output', 'image')];
  return finish(nodes, edges);
}

export function createDefaultDirectionalBlurGraph(type: EditableDirectionalBlurEffectType) {
  return type === 'motion-blur' ? createDefaultMotionBlurGraph() : type === 'radial-blur' ? createDefaultRadialBlurGraph() : createDefaultZoomBlurGraph();
}
