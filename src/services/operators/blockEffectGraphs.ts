import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableBlockEffectType = 'blockify' | 'block-mosaic';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const base = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 10) * 300, y: Math.floor(index / 10) * 400 }])) });
const sampleEdges = (uv: string, sample: string): OperatorEdge[] => [edge('frame', 'image', sample, 'image'), edge(uv, 'value', sample, 'uv')];

export function createDefaultBlockifyGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('scale', 'values.number', { value: 'scale' }),
    number('minimum-scale', 2), node('block', 'math.max.scalar'), node('block2', 'convert.scalar-to-vec2'), node('uv-resolution', 'math.multiply.vec2'),
    node('cell', 'math.divide-ieee.vec2'), node('floor-cell', 'math.floor.vec2'), number('half', .5), node('half2', 'convert.scalar-to-vec2'),
    node('center-cell', 'math.add.vec2'), node('center-pixels', 'math.multiply.vec2'), node('sample-uv', 'math.divide-ieee.vec2'), number('clamp-min', .001),
    number('clamp-max', .999), node('clamp-min2', 'convert.scalar-to-vec2'), node('clamp-max2', 'convert.scalar-to-vec2'), node('clamped-sample-uv', 'math.clamp.vec2'),
    node('current-uv', 'math.clamp.vec2'), node('sampled', 'image.sample'), node('current', 'image.sample'),
    node('sampled-split', 'vector.split.rgba'), node('current-split', 'vector.split.rgba'), number('eight', 8), node('eight-rgb', 'convert.scalar-to-rgb'),
    node('scaled-color', 'math.multiply.rgb'), node('poster-floor', 'math.floor.rgb'), number('seven', 7), node('seven-rgb', 'convert.scalar-to-rgb'),
    node('poster', 'math.divide-ieee.rgb'), node('amount', 'values.number', { value: 'amount' }), node('mixed', 'math.mix.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return base(nodes, [edge('scale', 'value', 'block', 'a'), edge('minimum-scale', 'value', 'block', 'b'), edge('block', 'value', 'block2', 'value'),
    edge('uv', 'uv', 'uv-resolution', 'a'), edge('resolution', 'value', 'uv-resolution', 'b'), edge('uv-resolution', 'value', 'cell', 'a'), edge('block2', 'value', 'cell', 'b'),
    edge('cell', 'value', 'floor-cell', 'value'), edge('half', 'value', 'half2', 'value'), edge('floor-cell', 'value', 'center-cell', 'a'), edge('half2', 'value', 'center-cell', 'b'),
    edge('center-cell', 'value', 'center-pixels', 'a'), edge('block2', 'value', 'center-pixels', 'b'), edge('center-pixels', 'value', 'sample-uv', 'a'),
    edge('resolution', 'value', 'sample-uv', 'b'), edge('clamp-min', 'value', 'clamp-min2', 'value'), edge('clamp-max', 'value', 'clamp-max2', 'value'),
    edge('sample-uv', 'value', 'clamped-sample-uv', 'value'), edge('clamp-min2', 'value', 'clamped-sample-uv', 'min'), edge('clamp-max2', 'value', 'clamped-sample-uv', 'max'),
    edge('uv', 'uv', 'current-uv', 'value'), edge('clamp-min2', 'value', 'current-uv', 'min'), edge('clamp-max2', 'value', 'current-uv', 'max'),
    ...sampleEdges('clamped-sample-uv', 'sampled'), ...sampleEdges('current-uv', 'current'), edge('sampled', 'image', 'sampled-split', 'image'), edge('current', 'image', 'current-split', 'image'),
    edge('eight', 'value', 'eight-rgb', 'value'), edge('sampled-split', 'rgb', 'scaled-color', 'a'), edge('eight-rgb', 'rgb', 'scaled-color', 'b'), edge('scaled-color', 'value', 'poster-floor', 'value'),
    edge('seven', 'value', 'seven-rgb', 'value'), edge('poster-floor', 'value', 'poster', 'a'), edge('seven-rgb', 'rgb', 'poster', 'b'),
    edge('current-split', 'rgb', 'mixed', 'a'), edge('poster', 'value', 'mixed', 'b'), edge('amount', 'value', 'mixed', 't'),
    edge('mixed', 'value', 'combine', 'rgb'), edge('sampled-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')]);
}

export function createDefaultBlockMosaicGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('time', 'image.timeline-time'),
    node('scale', 'values.number', { value: 'scale' }), number('minimum-scale', 4), node('base', 'math.max.scalar'), node('base2', 'convert.scalar-to-vec2'),
    node('uv-resolution', 'math.multiply.vec2'), node('coarse-divide', 'math.divide-ieee.vec2'), node('coarse-cell', 'math.floor.vec2'), node('speed', 'values.number', { value: 'speed' }),
    node('time-speed', 'math.multiply.scalar'), node('time-floor', 'math.floor.scalar'), node('time2', 'convert.scalar-to-vec2'), node('hash-input', 'math.add.vec2'),
    node('hash', 'noise.hash2d.vec2'), number('threshold', .68), node('large-cell', 'compare.greater.scalar'), number('one', 1), number('two', 2),
    node('multiplier', 'select.scalar'), node('block', 'math.multiply.scalar'), node('block2', 'convert.scalar-to-vec2'), node('cell-divide', 'math.divide-ieee.vec2'),
    node('floor-cell', 'math.floor.vec2'), number('half', .5), node('half2', 'convert.scalar-to-vec2'), node('center-cell', 'math.add.vec2'),
    node('center-pixels', 'math.multiply.vec2'), node('sample-uv', 'math.divide-ieee.vec2'), number('clamp-min', .001), number('clamp-max', .999),
    node('clamp-min2', 'convert.scalar-to-vec2'), node('clamp-max2', 'convert.scalar-to-vec2'), node('clamped-sample-uv', 'math.clamp.vec2'),
    node('current-uv', 'math.clamp.vec2'), node('sampled', 'image.sample'), node('current', 'image.sample'), node('sampled-split', 'vector.split.rgba'),
    node('current-split', 'vector.split.rgba'), node('cell-fract', 'math.fract.vec2'), node('border-min', 'vector.reduce-min.vec2'), number('border-edge', .04), node('border', 'math.step.scalar'),
    node('color-a', 'values.color', { value: 'colorA' }), node('color-image', 'convert.vec4-to-image'), node('color-split', 'vector.split.rgba'), number('ink-scale', .35),
    node('ink-scale-rgb', 'convert.scalar-to-rgb'), node('ink', 'math.multiply.rgb'), node('mosaic', 'math.mix.rgb'), node('amount', 'values.number', { value: 'amount' }),
    node('mixed', 'math.mix.rgb'), node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return base(nodes, [edge('scale', 'value', 'base', 'a'), edge('minimum-scale', 'value', 'base', 'b'), edge('base', 'value', 'base2', 'value'),
    edge('uv', 'uv', 'uv-resolution', 'a'), edge('resolution', 'value', 'uv-resolution', 'b'), edge('uv-resolution', 'value', 'coarse-divide', 'a'), edge('base2', 'value', 'coarse-divide', 'b'),
    edge('coarse-divide', 'value', 'coarse-cell', 'value'), edge('time', 'value', 'time-speed', 'a'), edge('speed', 'value', 'time-speed', 'b'), edge('time-speed', 'value', 'time-floor', 'value'),
    edge('time-floor', 'value', 'time2', 'value'), edge('coarse-cell', 'value', 'hash-input', 'a'), edge('time2', 'value', 'hash-input', 'b'), edge('hash-input', 'value', 'hash', 'value'),
    edge('hash', 'value', 'large-cell', 'a'), edge('threshold', 'value', 'large-cell', 'b'), edge('one', 'value', 'multiplier', 'falseValue'), edge('two', 'value', 'multiplier', 'trueValue'),
    edge('large-cell', 'condition', 'multiplier', 'condition'), edge('base', 'value', 'block', 'a'), edge('multiplier', 'value', 'block', 'b'), edge('block', 'value', 'block2', 'value'),
    edge('uv-resolution', 'value', 'cell-divide', 'a'), edge('block2', 'value', 'cell-divide', 'b'), edge('cell-divide', 'value', 'floor-cell', 'value'),
    edge('half', 'value', 'half2', 'value'), edge('floor-cell', 'value', 'center-cell', 'a'), edge('half2', 'value', 'center-cell', 'b'), edge('center-cell', 'value', 'center-pixels', 'a'),
    edge('block2', 'value', 'center-pixels', 'b'), edge('center-pixels', 'value', 'sample-uv', 'a'), edge('resolution', 'value', 'sample-uv', 'b'),
    edge('clamp-min', 'value', 'clamp-min2', 'value'), edge('clamp-max', 'value', 'clamp-max2', 'value'), edge('sample-uv', 'value', 'clamped-sample-uv', 'value'),
    edge('clamp-min2', 'value', 'clamped-sample-uv', 'min'), edge('clamp-max2', 'value', 'clamped-sample-uv', 'max'), edge('uv', 'uv', 'current-uv', 'value'),
    edge('clamp-min2', 'value', 'current-uv', 'min'), edge('clamp-max2', 'value', 'current-uv', 'max'), ...sampleEdges('clamped-sample-uv', 'sampled'), ...sampleEdges('current-uv', 'current'),
    edge('sampled', 'image', 'sampled-split', 'image'), edge('current', 'image', 'current-split', 'image'), edge('cell-divide', 'value', 'cell-fract', 'value'),
    edge('cell-fract', 'value', 'border-min', 'value'), edge('border-edge', 'value', 'border', 'edge'), edge('border-min', 'value', 'border', 'value'),
    edge('color-a', 'value', 'color-image', 'value'), edge('color-image', 'image', 'color-split', 'image'), edge('ink-scale', 'value', 'ink-scale-rgb', 'value'),
    edge('color-split', 'rgb', 'ink', 'a'), edge('ink-scale-rgb', 'rgb', 'ink', 'b'), edge('ink', 'value', 'mosaic', 'a'), edge('sampled-split', 'rgb', 'mosaic', 'b'),
    edge('border', 'value', 'mosaic', 't'), edge('current-split', 'rgb', 'mixed', 'a'), edge('mosaic', 'value', 'mixed', 'b'), edge('amount', 'value', 'mixed', 't'),
    edge('mixed', 'value', 'combine', 'rgb'), edge('sampled-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')]);
}

export function createDefaultBlockEffectGraph(type: EditableBlockEffectType): EffectOperatorGraph {
  return type === 'blockify' ? createDefaultBlockifyGraph() : createDefaultBlockMosaicGraph();
}
