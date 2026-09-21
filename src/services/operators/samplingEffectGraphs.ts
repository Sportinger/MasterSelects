import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableSamplingEffectType = 'pixelate' | 'mirror' | 'rgb-split';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const literal = (id: string, value: number) => node(id, 'values.number', {}, { value });
const graph = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 10) * 300, y: Math.floor(index / 10) * 400 }])) });

export function createDefaultPixelateGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('size', 'values.number', { value: 'size' }),
    node('size2', 'convert.scalar-to-vec2'), node('pixel', 'math.divide-ieee.vec2'), node('cell', 'math.divide-ieee.vec2'), node('floor', 'math.floor.vec2'),
    node('corner', 'math.multiply.vec2'), literal('half', .5), node('half2', 'convert.scalar-to-vec2'), node('half-pixel', 'math.multiply.vec2'),
    node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'), node('output', 'image.output')];
  return graph(nodes, [edge('size', 'value', 'size2', 'value'), edge('size2', 'value', 'pixel', 'a'), edge('resolution', 'value', 'pixel', 'b'),
    edge('uv', 'uv', 'cell', 'a'), edge('pixel', 'value', 'cell', 'b'), edge('cell', 'value', 'floor', 'value'), edge('floor', 'value', 'corner', 'a'),
    edge('pixel', 'value', 'corner', 'b'), edge('half', 'value', 'half2', 'value'), edge('pixel', 'value', 'half-pixel', 'a'), edge('half2', 'value', 'half-pixel', 'b'),
    edge('corner', 'value', 'sample-uv', 'a'), edge('half-pixel', 'value', 'sample-uv', 'b'), edge('frame', 'image', 'sample', 'image'),
    edge('sample-uv', 'value', 'sample', 'uv'), edge('sample', 'image', 'output', 'image')]);
}

export function createDefaultMirrorGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('split', 'vector.split.vec2'), literal('half', .5), literal('one', 1),
    node('x-right', 'compare.greater.scalar'), node('y-bottom', 'compare.greater.scalar'), node('horizontal', 'values.boolean', { value: 'horizontal' }),
    node('vertical', 'values.boolean', { value: 'vertical' }), node('mirror-x', 'logic.and.boolean'), node('mirror-y', 'logic.and.boolean'),
    node('inverse-x', 'math.subtract.scalar'), node('inverse-y', 'math.subtract.scalar'), node('select-x', 'select.scalar'), node('select-y', 'select.scalar'),
    node('sample-uv', 'vector.combine.vec2'), node('sample', 'image.sample'), node('output', 'image.output')];
  return graph(nodes, [edge('uv', 'uv', 'split', 'value'), edge('split', 'x', 'x-right', 'a'), edge('half', 'value', 'x-right', 'b'),
    edge('split', 'y', 'y-bottom', 'a'), edge('half', 'value', 'y-bottom', 'b'), edge('horizontal', 'value', 'mirror-x', 'a'), edge('x-right', 'condition', 'mirror-x', 'b'),
    edge('vertical', 'value', 'mirror-y', 'a'), edge('y-bottom', 'condition', 'mirror-y', 'b'), edge('one', 'value', 'inverse-x', 'a'), edge('split', 'x', 'inverse-x', 'b'),
    edge('one', 'value', 'inverse-y', 'a'), edge('split', 'y', 'inverse-y', 'b'), edge('split', 'x', 'select-x', 'falseValue'), edge('inverse-x', 'value', 'select-x', 'trueValue'),
    edge('mirror-x', 'value', 'select-x', 'condition'), edge('split', 'y', 'select-y', 'falseValue'), edge('inverse-y', 'value', 'select-y', 'trueValue'),
    edge('mirror-y', 'value', 'select-y', 'condition'), edge('select-x', 'value', 'sample-uv', 'x'), edge('select-y', 'value', 'sample-uv', 'y'),
    edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'), edge('sample', 'image', 'output', 'image')]);
}

export function createDefaultRgbSplitGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('angle', 'values.number', { value: 'angle' }), node('cos', 'math.cos.scalar'),
    node('sin', 'math.sin.scalar'), node('direction', 'vector.combine.vec2'), node('amount', 'values.number', { value: 'amount' }), node('amount2', 'convert.scalar-to-vec2'),
    node('offset', 'math.multiply.vec2'), node('plus-uv', 'math.add.vec2'), node('minus-uv', 'math.subtract.vec2'), node('plus', 'image.sample'),
    node('center', 'image.sample'), node('minus', 'image.sample'), node('plus4', 'convert.image-to-vec4'), node('center4', 'convert.image-to-vec4'),
    node('minus4', 'convert.image-to-vec4'), node('plus-split', 'vector.split.vec4'), node('center-split', 'vector.split.vec4'), node('minus-split', 'vector.split.vec4'),
    node('combine', 'vector.combine.vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')];
  return graph(nodes, [edge('angle', 'value', 'cos', 'value'), edge('angle', 'value', 'sin', 'value'), edge('cos', 'value', 'direction', 'x'), edge('sin', 'value', 'direction', 'y'),
    edge('amount', 'value', 'amount2', 'value'), edge('direction', 'value', 'offset', 'a'), edge('amount2', 'value', 'offset', 'b'), edge('uv', 'uv', 'plus-uv', 'a'),
    edge('offset', 'value', 'plus-uv', 'b'), edge('uv', 'uv', 'minus-uv', 'a'), edge('offset', 'value', 'minus-uv', 'b'),
    ...[['plus-uv', 'plus'], ['uv', 'center'], ['minus-uv', 'minus']].flatMap(([from, to]) => [edge('frame', 'image', to, 'image'), edge(from, from === 'uv' ? 'uv' : 'value', to, 'uv')]),
    ...['plus', 'center', 'minus'].flatMap(id => [edge(id, 'image', `${id}4`, 'image'), edge(`${id}4`, 'value', `${id}-split`, 'value')]),
    edge('plus-split', 'x', 'combine', 'x'), edge('center-split', 'y', 'combine', 'y'), edge('minus-split', 'z', 'combine', 'z'), edge('center-split', 'w', 'combine', 'w'),
    edge('combine', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image')]);
}

export function createDefaultSamplingEffectGraph(type: EditableSamplingEffectType): EffectOperatorGraph {
  if (type === 'pixelate') return createDefaultPixelateGraph();
  if (type === 'mirror') return createDefaultMirrorGraph();
  return createDefaultRgbSplitGraph();
}
