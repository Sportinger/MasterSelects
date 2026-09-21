import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

/** Eight-tap Sobel graph preserving the legacy scalar expression order. */
export function createDefaultEdgeDetectGraph(): EffectOperatorGraph {
  const taps = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const;
  const nodes: BoundOperatorNode[] = [
    node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), number('zero', 0), number('one', 1),
    node('one-vec2', 'convert.scalar-to-vec2'), node('texel', 'math.divide-ieee.vec2'), node('texel-split', 'vector.split.vec2'),
    node('horizontal', 'vector.combine.vec2'), node('vertical', 'vector.combine.vec2'),
    node('l-uv', 'math.subtract.vec2'), node('r-uv', 'math.add.vec2'), node('t-uv', 'math.subtract.vec2'), node('b-uv', 'math.add.vec2'),
    node('tl-uv', 'math.subtract.vec2'), node('bl-uv', 'math.add.vec2'), node('tr-uv', 'math.subtract.vec2'), node('br-uv', 'math.add.vec2'),
    ...taps.flatMap(id => [node(`${id}-sample`, 'image.sample'), node(id, 'color.luminance-rec709.image')]),
    number('two', 2), node('negative-tl', 'math.subtract.scalar'), node('two-l', 'math.multiply.scalar'), node('gx-left-mid', 'math.subtract.scalar'),
    node('gx-left', 'math.subtract.scalar'), node('gx-tr', 'math.add.scalar'), node('two-r', 'math.multiply.scalar'), node('gx-right-mid', 'math.add.scalar'),
    node('gx', 'math.add.scalar'), node('two-t', 'math.multiply.scalar'), node('gy-top-mid', 'math.subtract.scalar'), node('gy-top', 'math.subtract.scalar'),
    node('gy-bl', 'math.add.scalar'), node('two-b', 'math.multiply.scalar'), node('gy-bottom-mid', 'math.add.scalar'), node('gy', 'math.add.scalar'),
    node('gradient', 'vector.combine.vec2'), node('gradient-dot', 'vector.dot.vec2'), node('magnitude', 'math.sqrt.scalar'),
    node('strength', 'values.number', { value: 'strength' }), node('scaled', 'math.multiply.scalar'), node('clamped', 'math.clamp.scalar'),
    node('inverse', 'math.subtract.scalar'), node('invert', 'values.boolean', { value: 'invert' }), node('selected', 'select.scalar'),
    node('rgba', 'vector.combine.vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output'),
  ];
  const edges: OperatorEdge[] = [
    edge('one', 'value', 'one-vec2', 'value'), edge('one-vec2', 'value', 'texel', 'a'), edge('resolution', 'value', 'texel', 'b'),
    edge('texel', 'value', 'texel-split', 'value'), edge('texel-split', 'x', 'horizontal', 'x'), edge('zero', 'value', 'horizontal', 'y'),
    edge('zero', 'value', 'vertical', 'x'), edge('texel-split', 'y', 'vertical', 'y'),
    edge('uv', 'uv', 'l-uv', 'a'), edge('horizontal', 'value', 'l-uv', 'b'), edge('uv', 'uv', 'r-uv', 'a'), edge('horizontal', 'value', 'r-uv', 'b'),
    edge('uv', 'uv', 't-uv', 'a'), edge('vertical', 'value', 't-uv', 'b'), edge('uv', 'uv', 'b-uv', 'a'), edge('vertical', 'value', 'b-uv', 'b'),
    edge('l-uv', 'value', 'tl-uv', 'a'), edge('vertical', 'value', 'tl-uv', 'b'), edge('l-uv', 'value', 'bl-uv', 'a'), edge('vertical', 'value', 'bl-uv', 'b'),
    edge('r-uv', 'value', 'tr-uv', 'a'), edge('vertical', 'value', 'tr-uv', 'b'), edge('r-uv', 'value', 'br-uv', 'a'), edge('vertical', 'value', 'br-uv', 'b'),
    ...taps.flatMap(id => [edge('frame', 'image', `${id}-sample`, 'image'), edge(`${id}-uv`, 'value', `${id}-sample`, 'uv'), edge(`${id}-sample`, 'image', id, 'image')]),
    edge('zero', 'value', 'negative-tl', 'a'), edge('tl', 'value', 'negative-tl', 'b'), edge('two', 'value', 'two-l', 'a'), edge('l', 'value', 'two-l', 'b'),
    edge('negative-tl', 'value', 'gx-left-mid', 'a'), edge('two-l', 'value', 'gx-left-mid', 'b'), edge('gx-left-mid', 'value', 'gx-left', 'a'), edge('bl', 'value', 'gx-left', 'b'),
    edge('gx-left', 'value', 'gx-tr', 'a'), edge('tr', 'value', 'gx-tr', 'b'), edge('two', 'value', 'two-r', 'a'), edge('r', 'value', 'two-r', 'b'),
    edge('gx-tr', 'value', 'gx-right-mid', 'a'), edge('two-r', 'value', 'gx-right-mid', 'b'), edge('gx-right-mid', 'value', 'gx', 'a'), edge('br', 'value', 'gx', 'b'),
    edge('two', 'value', 'two-t', 'a'), edge('t', 'value', 'two-t', 'b'), edge('negative-tl', 'value', 'gy-top-mid', 'a'), edge('two-t', 'value', 'gy-top-mid', 'b'),
    edge('gy-top-mid', 'value', 'gy-top', 'a'), edge('tr', 'value', 'gy-top', 'b'), edge('gy-top', 'value', 'gy-bl', 'a'), edge('bl', 'value', 'gy-bl', 'b'),
    edge('two', 'value', 'two-b', 'a'), edge('b', 'value', 'two-b', 'b'), edge('gy-bl', 'value', 'gy-bottom-mid', 'a'), edge('two-b', 'value', 'gy-bottom-mid', 'b'),
    edge('gy-bottom-mid', 'value', 'gy', 'a'), edge('br', 'value', 'gy', 'b'), edge('gx', 'value', 'gradient', 'x'), edge('gy', 'value', 'gradient', 'y'),
    edge('gradient', 'value', 'gradient-dot', 'a'), edge('gradient', 'value', 'gradient-dot', 'b'), edge('gradient-dot', 'value', 'magnitude', 'value'),
    edge('magnitude', 'value', 'scaled', 'a'), edge('strength', 'value', 'scaled', 'b'), edge('scaled', 'value', 'clamped', 'value'),
    edge('zero', 'value', 'clamped', 'min'), edge('one', 'value', 'clamped', 'max'), edge('one', 'value', 'inverse', 'a'), edge('clamped', 'value', 'inverse', 'b'),
    edge('clamped', 'value', 'selected', 'falseValue'), edge('inverse', 'value', 'selected', 'trueValue'), edge('invert', 'value', 'selected', 'condition'),
    edge('selected', 'value', 'rgba', 'x'), edge('selected', 'value', 'rgba', 'y'), edge('selected', 'value', 'rgba', 'z'), edge('one', 'value', 'rgba', 'w'),
    edge('rgba', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image'),
  ];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) };
}
