import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { recognizeOperatorCompositions } from './recognizeOperatorCompositions';

/**
 * The Pixelate, Mirror, RGB Split, Blockify, Block Mosaic and Kaleidoscope recipes as they shipped
 * before the mirror/pixel review (render-pixel cells sampled at their top-left-anchored centre,
 * UV-space kaleidoscope wedges, straight-alpha reads, clamped frame edges). Kept byte-stable only
 * to recognize untouched saved graphs; `mirrorPixelGraphUpgrade.ts` replaces those with the
 * current recipes. Never extend these.
 */
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const literal = (id: string, value: number) => node(id, 'values.number', {}, { value });
const number = literal;
const graph = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 10) * 300, y: Math.floor(index / 10) * 400 }])) });
const blockGraph = graph;
const sampleEdges = (uv: string, sample: string): OperatorEdge[] => [edge('frame', 'image', sample, 'image'), edge(uv, 'value', sample, 'uv')];
const finish = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) });
const sampleTail = (): BoundOperatorNode[] => [node('sample', 'image.sample'), node('output', 'image.output')];
const uvSampleEdges = (uvNode: string): OperatorEdge[] => [edge('frame', 'image', 'sample', 'image'), edge(uvNode, 'value', 'sample', 'uv'), edge('sample', 'image', 'output', 'image')];

export function createLegacyPixelateGraph(): EffectOperatorGraph {
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

export function createLegacyMirrorGraph(): EffectOperatorGraph {
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

export function createLegacyRgbSplitGraph(): EffectOperatorGraph {
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

export function createLegacyBlockifyGraph(): EffectOperatorGraph {
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
  return blockGraph(nodes, [edge('scale', 'value', 'block', 'a'), edge('minimum-scale', 'value', 'block', 'b'), edge('block', 'value', 'block2', 'value'),
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

export function createLegacyBlockMosaicGraph(): EffectOperatorGraph {
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
  return blockGraph(nodes, [edge('scale', 'value', 'base', 'a'), edge('minimum-scale', 'value', 'base', 'b'), edge('base', 'value', 'base2', 'value'),
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

function kaleidoscopeGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), number('half', .5), node('half-vec2', 'convert.scalar-to-vec2'), node('centered', 'math.subtract.vec2'), node('centered-components', 'vector.split.vec2'), node('base-angle', 'math.atan2.scalar'), node('rotation', 'values.number', { value: 'rotation' }), node('angle', 'math.add.scalar'), node('radius', 'vector.length.vec2'), number('tau', Math.PI * 2), node('segments', 'values.number', { value: 'segments' }), node('segment-angle', 'math.divide-ieee.scalar'), node('segment-progress', 'math.divide-ieee.scalar'), node('segment-fract', 'math.fract.scalar'), node('fold-angle', 'math.multiply.scalar'), node('half-segment', 'math.multiply.scalar'), node('past-half', 'compare.greater.scalar'), node('reflected-angle', 'math.subtract.scalar'), node('selected-angle', 'select.scalar'), node('direction', 'vector.unit-direction.scalar'), node('radial', 'math.multiply.vec2-scalar'), node('final-uv', 'math.add.vec2'), ...sampleTail()];
  const edges = [edge('half', 'value', 'half-vec2', 'value'), edge('uv', 'uv', 'centered', 'a'), edge('half-vec2', 'value', 'centered', 'b'), edge('centered', 'value', 'centered-components', 'value'), edge('centered-components', 'y', 'base-angle', 'y'), edge('centered-components', 'x', 'base-angle', 'x'), edge('base-angle', 'value', 'angle', 'a'), edge('rotation', 'value', 'angle', 'b'), edge('centered', 'value', 'radius', 'value'), edge('tau', 'value', 'segment-angle', 'a'), edge('segments', 'value', 'segment-angle', 'b'), edge('angle', 'value', 'segment-progress', 'a'), edge('segment-angle', 'value', 'segment-progress', 'b'), edge('segment-progress', 'value', 'segment-fract', 'value'), edge('segment-fract', 'value', 'fold-angle', 'a'), edge('segment-angle', 'value', 'fold-angle', 'b'), edge('segment-angle', 'value', 'half-segment', 'a'), edge('half', 'value', 'half-segment', 'b'), edge('fold-angle', 'value', 'past-half', 'a'), edge('half-segment', 'value', 'past-half', 'b'), edge('segment-angle', 'value', 'reflected-angle', 'a'), edge('fold-angle', 'value', 'reflected-angle', 'b'), edge('fold-angle', 'value', 'selected-angle', 'falseValue'), edge('reflected-angle', 'value', 'selected-angle', 'trueValue'), edge('past-half', 'condition', 'selected-angle', 'condition'), edge('selected-angle', 'value', 'direction', 'angle'), edge('direction', 'value', 'radial', 'a'), edge('radius', 'value', 'radial', 'b'), edge('radial', 'value', 'final-uv', 'a'), edge('half-vec2', 'value', 'final-uv', 'b'), ...uvSampleEdges('final-uv')];
  return finish(nodes, edges);
}


export function createLegacyKaleidoscopeGraph(): EffectOperatorGraph {
  return recognizeOperatorCompositions(kaleidoscopeGraph());
}
