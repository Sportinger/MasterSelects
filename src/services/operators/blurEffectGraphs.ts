import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableBlurEffectType = 'box-blur' | 'gaussian-blur' | 'sharpen';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const graph = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 7) * 280, y: Math.floor(index / 7) * 360 }])) });

function sharedNodes(): BoundOperatorNode[] {
  return [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('index', 'image.kernel-index'),
    number('one', 1), node('one-vec2', 'convert.scalar-to-vec2'), node('texel-size', 'math.divide-ieee.vec2'), node('offset', 'math.multiply.vec2'),
    node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'), number('half', .5), node('enabled', 'compare.greater.scalar'),
    node('reduce', 'image.kernel-grid-reduce'), node('weight-vec4', 'convert.scalar-to-vec4'), node('average', 'math.divide-ieee.vec4'),
    node('blurred', 'convert.vec4-to-image'), node('selected', 'control.select.image'), node('output', 'image.output')];
}

function sharedEdges(extent: string, weight: string, sampleOffset = 'offset'): OperatorEdge[] {
  return [edge('one', 'value', 'one-vec2', 'value'), edge('one-vec2', 'value', 'texel-size', 'a'), edge('resolution', 'value', 'texel-size', 'b'),
    edge('index', 'value', 'offset', 'a'), edge('texel-size', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge(sampleOffset, 'value', 'sample-uv', 'b'),
    edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'), edge('sample', 'image', 'reduce', 'sample'),
    edge(weight, 'value', 'reduce', 'weight'), edge(extent, 'value', 'reduce', 'extent'), edge('reduce', 'weightSum', 'weight-vec4', 'value'),
    edge('reduce', 'sum', 'average', 'a'), edge('weight-vec4', 'value', 'average', 'b'), edge('average', 'value', 'blurred', 'value'),
    edge('half', 'value', 'enabled', 'a'), edge('radius', 'value', 'enabled', 'b'), edge('enabled', 'condition', 'selected', 'condition'),
    edge('blurred', 'image', 'selected', 'falseValue'), edge('frame', 'image', 'selected', 'trueValue'), edge('selected', 'image', 'output', 'image')];
}

export function createDefaultBoxBlurGraph(): EffectOperatorGraph {
  const nodes = [...sharedNodes(), node('radius', 'values.number', { value: 'radius' }), number('weight', 1)];
  const edges = sharedEdges('radius', 'weight');
  return graph(nodes, edges);
}

export function createDefaultGaussianBlurGraph(): EffectOperatorGraph {
  const nodes = [...sharedNodes(), node('radius', 'values.number', { value: 'radius' }), node('samples', 'values.number', { value: 'samples' }),
    number('minimum-samples', 1), node('samples-at-least-one', 'math.max.scalar'), number('maximum-samples', 64), node('samples-over-maximum', 'compare.greater.scalar'),
    node('clamped-samples', 'select.scalar'), node('extent', 'math.floor.scalar'),
    node('radius-per-sample', 'math.divide-ieee.scalar'), node('radius-per-sample-vec2', 'convert.scalar-to-vec2'), node('scaled-offset', 'math.multiply.vec2'),
    number('three', 3), node('sigma', 'math.divide-ieee.scalar'), number('two', 2), node('two-sigma', 'math.multiply.scalar'), node('two-sigma-squared', 'math.multiply.scalar'),
    node('distance-squared', 'vector.dot.vec2'), number('zero', 0), node('negative-distance', 'math.subtract.scalar'), node('exponent', 'math.divide-ieee.scalar'), node('weight', 'math.exp.scalar')];
  const edges = [...sharedEdges('extent', 'weight', 'scaled-offset'), edge('samples', 'value', 'samples-at-least-one', 'a'), edge('minimum-samples', 'value', 'samples-at-least-one', 'b'),
    edge('samples-at-least-one', 'value', 'samples-over-maximum', 'a'), edge('maximum-samples', 'value', 'samples-over-maximum', 'b'),
    edge('samples-at-least-one', 'value', 'clamped-samples', 'falseValue'), edge('maximum-samples', 'value', 'clamped-samples', 'trueValue'),
    edge('samples-over-maximum', 'condition', 'clamped-samples', 'condition'), edge('clamped-samples', 'value', 'extent', 'value'),
    edge('radius', 'value', 'radius-per-sample', 'a'), edge('extent', 'value', 'radius-per-sample', 'b'),
    edge('radius-per-sample', 'value', 'radius-per-sample-vec2', 'value'), edge('offset', 'value', 'scaled-offset', 'a'), edge('radius-per-sample-vec2', 'value', 'scaled-offset', 'b'),
    edge('radius', 'value', 'sigma', 'a'), edge('three', 'value', 'sigma', 'b'), edge('two', 'value', 'two-sigma', 'a'), edge('sigma', 'value', 'two-sigma', 'b'),
    edge('two-sigma', 'value', 'two-sigma-squared', 'a'), edge('sigma', 'value', 'two-sigma-squared', 'b'), edge('index', 'value', 'distance-squared', 'a'),
    edge('index', 'value', 'distance-squared', 'b'), edge('zero', 'value', 'negative-distance', 'a'), edge('distance-squared', 'value', 'negative-distance', 'b'),
    edge('negative-distance', 'value', 'exponent', 'a'), edge('two-sigma-squared', 'value', 'exponent', 'b'), edge('exponent', 'value', 'weight', 'value')];
  return graph(nodes, edges);
}

export function createDefaultSharpenGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('index', 'image.kernel-index'),
    number('one', 1), node('one-vec2', 'convert.scalar-to-vec2'), node('texel-size', 'math.divide-ieee.vec2'), node('offset', 'math.multiply.vec2'),
    node('radius', 'values.number', { value: 'radius' }), node('radius-vec2', 'convert.scalar-to-vec2'), node('scaled-offset', 'math.multiply.vec2'),
    node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'), number('extent', 3),
    number('half', .5), node('radius-half', 'math.multiply.scalar'), node('sigma', 'math.add.scalar'), number('two', 2), node('two-sigma', 'math.multiply.scalar'),
    node('two-sigma-squared', 'math.multiply.scalar'), node('distance-squared', 'vector.dot.vec2'), number('zero', 0), node('negative-distance', 'math.subtract.scalar'),
    node('exponent', 'math.divide-ieee.scalar'), node('weight', 'math.exp.scalar'), node('reduce', 'image.kernel-grid-reduce'),
    node('weight-vec4', 'convert.scalar-to-vec4'), node('average', 'math.divide-ieee.vec4'), node('blurred', 'convert.vec4-to-image'),
    node('center-split', 'vector.split.rgba'), node('blurred-split', 'vector.split.rgba'), node('difference', 'math.subtract.rgb'),
    node('amount', 'values.number', { value: 'amount' }), node('amount-rgb', 'convert.scalar-to-rgb'), node('scaled-difference', 'math.multiply.rgb'), node('sharpened', 'math.add.rgb'),
    number('clamp-min', 0), node('clamp-min-rgb', 'convert.scalar-to-rgb'), number('clamp-max', 1), node('clamp-max-rgb', 'convert.scalar-to-rgb'), node('clamped', 'math.clamp.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  const edges = [edge('one', 'value', 'one-vec2', 'value'), edge('one-vec2', 'value', 'texel-size', 'a'), edge('resolution', 'value', 'texel-size', 'b'),
    edge('index', 'value', 'offset', 'a'), edge('texel-size', 'value', 'offset', 'b'), edge('radius', 'value', 'radius-vec2', 'value'),
    edge('offset', 'value', 'scaled-offset', 'a'), edge('radius-vec2', 'value', 'scaled-offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge('scaled-offset', 'value', 'sample-uv', 'b'),
    edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'), edge('radius', 'value', 'radius-half', 'a'), edge('half', 'value', 'radius-half', 'b'),
    edge('radius-half', 'value', 'sigma', 'a'), edge('half', 'value', 'sigma', 'b'), edge('two', 'value', 'two-sigma', 'a'), edge('sigma', 'value', 'two-sigma', 'b'),
    edge('two-sigma', 'value', 'two-sigma-squared', 'a'), edge('sigma', 'value', 'two-sigma-squared', 'b'), edge('index', 'value', 'distance-squared', 'a'),
    edge('index', 'value', 'distance-squared', 'b'), edge('zero', 'value', 'negative-distance', 'a'), edge('distance-squared', 'value', 'negative-distance', 'b'),
    edge('negative-distance', 'value', 'exponent', 'a'), edge('two-sigma-squared', 'value', 'exponent', 'b'), edge('exponent', 'value', 'weight', 'value'),
    edge('sample', 'image', 'reduce', 'sample'), edge('weight', 'value', 'reduce', 'weight'), edge('extent', 'value', 'reduce', 'extent'),
    edge('reduce', 'weightSum', 'weight-vec4', 'value'), edge('reduce', 'sum', 'average', 'a'), edge('weight-vec4', 'value', 'average', 'b'), edge('average', 'value', 'blurred', 'value'),
    edge('frame', 'image', 'center-split', 'image'), edge('blurred', 'image', 'blurred-split', 'image'), edge('center-split', 'rgb', 'difference', 'a'), edge('blurred-split', 'rgb', 'difference', 'b'),
    edge('amount', 'value', 'amount-rgb', 'value'), edge('difference', 'value', 'scaled-difference', 'a'), edge('amount-rgb', 'rgb', 'scaled-difference', 'b'),
    edge('center-split', 'rgb', 'sharpened', 'a'), edge('scaled-difference', 'value', 'sharpened', 'b'), edge('clamp-min', 'value', 'clamp-min-rgb', 'value'),
    edge('clamp-max', 'value', 'clamp-max-rgb', 'value'), edge('sharpened', 'value', 'clamped', 'value'), edge('clamp-min-rgb', 'rgb', 'clamped', 'min'),
    edge('clamp-max-rgb', 'rgb', 'clamped', 'max'), edge('clamped', 'value', 'combine', 'rgb'), edge('center-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')];
  return graph(nodes, edges);
}

export function createDefaultBlurEffectGraph(type: EditableBlurEffectType): EffectOperatorGraph {
  return type === 'box-blur' ? createDefaultBoxBlurGraph() : type === 'gaussian-blur' ? createDefaultGaussianBlurGraph() : createDefaultSharpenGraph();
}
