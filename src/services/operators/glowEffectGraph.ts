import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

/** Canonical granular graph for the legacy single-pass Glow shader. */
export function createDefaultGlowGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('resolution-components', 'vector.split.vec2'),
    node('kernel-index', 'image.kernel-index'), node('index-components', 'vector.split.vec2'),
    number('one', 1), number('two', 2), number('ten', 10), number('tau', 6.283185307179586), number('half', .5), number('threshold-width', .1), number('softness-offset', .3),
    node('rings', 'values.number', { value: 'rings' }), number('rings-limit', 32), node('rings-clamped', 'math.clamp.scalar'), node('rings-count', 'math.floor.scalar'),
    node('samples', 'values.number', { value: 'samplesPerRing' }), number('samples-minimum', 4), number('samples-limit', 64), node('samples-clamped', 'math.clamp.scalar'), node('samples-count', 'math.floor.scalar'),
    node('ring', 'math.add.scalar'), node('angle-turn', 'math.multiply.scalar'), node('angle-base', 'math.divide-ieee.scalar'), node('angle-stagger', 'math.multiply.scalar'), node('angle', 'math.add.scalar'), node('direction', 'vector.unit-direction.scalar'),
    node('radius', 'values.number', { value: 'radius' }), node('ring-radius', 'math.multiply.scalar'), node('width-reciprocal', 'math.reciprocal.scalar'), node('radius-pixels', 'math.multiply.scalar'), node('radius-scale', 'math.multiply.scalar'), node('offset', 'math.multiply.vec2-scalar'), node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'),
    node('ring-progress', 'math.divide-ieee.scalar'), node('softness', 'values.number', { value: 'softness' }), node('gaussian-sigma', 'math.add.scalar'), node('ring-weight', 'math.gaussian.scalar'),
    node('threshold', 'values.number', { value: 'threshold' }), node('threshold-low', 'math.subtract.scalar'), node('threshold-high', 'math.add.scalar'), node('sample-luma', 'color.luminance-rec709.image'), node('sample-bright', 'math.smoothstep.scalar'), node('bright-sample', 'math.multiply.image-scalar'),
    node('reduce', 'image.kernel-rect-reduce'), node('reduced-rgb', 'convert.vec4-to-rgb'),
    node('center-split', 'vector.split.rgba'), node('center-luma', 'color.luminance-rec709.image'), node('center-bright', 'math.smoothstep.scalar'), node('center-lit', 'math.multiply.rgb-scalar'), node('center-double', 'math.multiply.rgb-scalar'),
    node('glow-sum', 'math.add.rgb'), node('total-weight', 'math.add.scalar'), node('glow-average', 'math.divide-ieee.rgb-scalar'),
    node('amount', 'values.number', { value: 'amount' }), node('amount-scaled-glow', 'math.multiply.rgb-scalar'), node('scaled-glow', 'math.multiply.rgb-scalar'), node('result', 'math.add.rgb'),
    number('zero', 0), node('clamped', 'math.clamp.rgb-scalar'), node('combine', 'vector.combine.rgba'), node('output', 'image.output'),
  ];
  const edges: OperatorEdge[] = [
    edge('resolution', 'value', 'resolution-components', 'value'), edge('kernel-index', 'value', 'index-components', 'value'),
    edge('rings', 'value', 'rings-clamped', 'value'), edge('one', 'value', 'rings-clamped', 'min'), edge('rings-limit', 'value', 'rings-clamped', 'max'), edge('rings-clamped', 'value', 'rings-count', 'value'),
    edge('samples', 'value', 'samples-clamped', 'value'), edge('samples-minimum', 'value', 'samples-clamped', 'min'), edge('samples-limit', 'value', 'samples-clamped', 'max'), edge('samples-clamped', 'value', 'samples-count', 'value'),
    edge('index-components', 'x', 'ring', 'a'), edge('one', 'value', 'ring', 'b'), edge('index-components', 'y', 'angle-turn', 'a'), edge('tau', 'value', 'angle-turn', 'b'), edge('angle-turn', 'value', 'angle-base', 'a'), edge('samples-count', 'value', 'angle-base', 'b'), edge('ring', 'value', 'angle-stagger', 'a'), edge('half', 'value', 'angle-stagger', 'b'), edge('angle-base', 'value', 'angle', 'a'), edge('angle-stagger', 'value', 'angle', 'b'), edge('angle', 'value', 'direction', 'angle'),
    edge('ring', 'value', 'ring-radius', 'a'), edge('radius', 'value', 'ring-radius', 'b'), edge('resolution-components', 'x', 'width-reciprocal', 'value'), edge('ring-radius', 'value', 'radius-pixels', 'a'), edge('width-reciprocal', 'value', 'radius-pixels', 'b'), edge('radius-pixels', 'value', 'radius-scale', 'a'), edge('ten', 'value', 'radius-scale', 'b'), edge('direction', 'value', 'offset', 'a'), edge('radius-scale', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge('offset', 'value', 'sample-uv', 'b'), edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'),
    edge('ring', 'value', 'ring-progress', 'a'), edge('rings-count', 'value', 'ring-progress', 'b'), edge('softness', 'value', 'gaussian-sigma', 'a'), edge('softness-offset', 'value', 'gaussian-sigma', 'b'), edge('ring-progress', 'value', 'ring-weight', 'value'), edge('gaussian-sigma', 'value', 'ring-weight', 'sigma'),
    edge('threshold', 'value', 'threshold-low', 'a'), edge('threshold-width', 'value', 'threshold-low', 'b'), edge('threshold', 'value', 'threshold-high', 'a'), edge('threshold-width', 'value', 'threshold-high', 'b'), edge('sample', 'image', 'sample-luma', 'image'), edge('threshold-low', 'value', 'sample-bright', 'edge0'), edge('threshold-high', 'value', 'sample-bright', 'edge1'), edge('sample-luma', 'value', 'sample-bright', 'value'), edge('sample', 'image', 'bright-sample', 'a'), edge('sample-bright', 'value', 'bright-sample', 'b'),
    edge('bright-sample', 'value', 'reduce', 'sample'), edge('ring-weight', 'value', 'reduce', 'weight'), edge('rings-count', 'value', 'reduce', 'width'), edge('samples-count', 'value', 'reduce', 'height'), edge('reduce', 'sum', 'reduced-rgb', 'value'),
    edge('frame', 'image', 'center-split', 'image'), edge('frame', 'image', 'center-luma', 'image'), edge('threshold-low', 'value', 'center-bright', 'edge0'), edge('threshold-high', 'value', 'center-bright', 'edge1'), edge('center-luma', 'value', 'center-bright', 'value'), edge('center-split', 'rgb', 'center-lit', 'a'), edge('center-bright', 'value', 'center-lit', 'b'), edge('center-lit', 'value', 'center-double', 'a'), edge('two', 'value', 'center-double', 'b'),
    edge('reduced-rgb', 'rgb', 'glow-sum', 'a'), edge('center-double', 'value', 'glow-sum', 'b'), edge('reduce', 'weightSum', 'total-weight', 'a'), edge('two', 'value', 'total-weight', 'b'), edge('glow-sum', 'value', 'glow-average', 'a'), edge('total-weight', 'value', 'glow-average', 'b'),
    edge('glow-average', 'value', 'amount-scaled-glow', 'a'), edge('amount', 'value', 'amount-scaled-glow', 'b'), edge('amount-scaled-glow', 'value', 'scaled-glow', 'a'), edge('two', 'value', 'scaled-glow', 'b'), edge('center-split', 'rgb', 'result', 'a'), edge('scaled-glow', 'value', 'result', 'b'), edge('result', 'value', 'clamped', 'value'), edge('zero', 'value', 'clamped', 'min'), edge('one', 'value', 'clamped', 'max'), edge('clamped', 'value', 'combine', 'rgb'), edge('center-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image'),
  ];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) };
}
