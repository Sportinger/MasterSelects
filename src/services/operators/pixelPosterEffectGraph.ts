import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });

export function createDefaultPixelPosterGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'),
    node('scale', 'values.number', { value: 'scale' }), number('minimum-scale', 2), node('grid', 'math.max.scalar'),
    node('grid-vec2', 'convert.scalar-to-vec2'), node('uv-resolution', 'math.multiply.vec2'), node('cell', 'math.divide-ieee.vec2'),
    node('cell-floor', 'math.floor.vec2'), number('half', .5), node('half-vec2', 'convert.scalar-to-vec2'), node('cell-center', 'math.add.vec2'),
    node('pixel-center', 'math.multiply.vec2'), node('sample-uv', 'math.divide-ieee.vec2'), number('clamp-min', .001), number('clamp-max', .999),
    node('clamp-min-vec2', 'convert.scalar-to-vec2'), node('clamp-max-vec2', 'convert.scalar-to-vec2'), node('clamped-uv', 'math.clamp.vec2'),
    node('sampled', 'image.sample'), node('sampled-split', 'vector.split.rgba'), number('five', 5), node('five-rgb', 'convert.scalar-to-rgb'),
    node('scaled-rgb', 'math.multiply.rgb'), node('poster-floor', 'math.floor.rgb'), number('four', 4), node('four-rgb', 'convert.scalar-to-rgb'),
    node('poster', 'math.divide-ieee.rgb'), node('amount', 'values.number', { value: 'amount' }), node('mixed', 'math.mix.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  const edges = [edge('scale', 'value', 'grid', 'a'), edge('minimum-scale', 'value', 'grid', 'b'), edge('grid', 'value', 'grid-vec2', 'value'),
    edge('uv', 'uv', 'uv-resolution', 'a'), edge('resolution', 'value', 'uv-resolution', 'b'), edge('uv-resolution', 'value', 'cell', 'a'),
    edge('grid-vec2', 'value', 'cell', 'b'), edge('cell', 'value', 'cell-floor', 'value'), edge('half', 'value', 'half-vec2', 'value'),
    edge('cell-floor', 'value', 'cell-center', 'a'), edge('half-vec2', 'value', 'cell-center', 'b'), edge('cell-center', 'value', 'pixel-center', 'a'),
    edge('grid-vec2', 'value', 'pixel-center', 'b'), edge('pixel-center', 'value', 'sample-uv', 'a'), edge('resolution', 'value', 'sample-uv', 'b'),
    edge('clamp-min', 'value', 'clamp-min-vec2', 'value'), edge('clamp-max', 'value', 'clamp-max-vec2', 'value'),
    edge('sample-uv', 'value', 'clamped-uv', 'value'), edge('clamp-min-vec2', 'value', 'clamped-uv', 'min'), edge('clamp-max-vec2', 'value', 'clamped-uv', 'max'),
    edge('frame', 'image', 'sampled', 'image'), edge('clamped-uv', 'value', 'sampled', 'uv'), edge('sampled', 'image', 'sampled-split', 'image'),
    edge('five', 'value', 'five-rgb', 'value'), edge('sampled-split', 'rgb', 'scaled-rgb', 'a'), edge('five-rgb', 'rgb', 'scaled-rgb', 'b'),
    edge('scaled-rgb', 'value', 'poster-floor', 'value'), edge('four', 'value', 'four-rgb', 'value'), edge('poster-floor', 'value', 'poster', 'a'),
    edge('four-rgb', 'rgb', 'poster', 'b'), edge('sampled-split', 'rgb', 'mixed', 'a'), edge('poster', 'value', 'mixed', 'b'),
    edge('amount', 'value', 'mixed', 't'), edge('mixed', 'value', 'combine', 'rgb'), edge('sampled-split', 'alpha', 'combine', 'alpha'),
    edge('combine', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 9) * 340, y: Math.floor(index / 9) * 360 }])) };
}
