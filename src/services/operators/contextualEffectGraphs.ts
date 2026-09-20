import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableContextualEffectType = 'vignette';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const literal = (id: string, value: number) => node(id, 'values.number', {}, { value });

/** Exact legacy vignette math. UV is fragment context, deliberately not texture-transform UV. */
export function createDefaultVignetteGraph(): EffectOperatorGraph {
  const nodes = [
    node('frame', 'image.frame'), node('split', 'vector.split.rgba'), node('uv', 'image.normalized-uv'),
    literal('half', 0.5), node('half-vec2', 'convert.scalar-to-vec2'), node('center', 'math.subtract.vec2'),
    literal('one', 1), node('roundness', 'values.number', { value: 'roundness' }), node('aspect', 'vector.combine.vec2'),
    node('scaled-center', 'math.multiply.vec2'), node('radius', 'vector.length.vec2'), literal('two', 2),
    node('distance', 'math.multiply.scalar'), node('size', 'values.number', { value: 'size' }),
    node('softness', 'values.number', { value: 'softness' }), node('outer-edge', 'math.add.scalar'),
    node('edge-ramp', 'math.smoothstep.scalar'), node('factor', 'math.subtract.scalar'),
    node('amount', 'values.number', { value: 'amount' }), node('gain', 'math.mix.scalar'),
    node('gain-rgb', 'convert.scalar-to-rgb'), node('shade', 'math.multiply.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output'),
  ];
  return {
    version: 1, schemaVersion: 1, domain: 'image', nodes,
    edges: [
      edge('frame', 'image', 'split', 'image'), edge('uv', 'uv', 'center', 'a'), edge('half', 'value', 'half-vec2', 'value'),
      edge('half-vec2', 'value', 'center', 'b'), edge('one', 'value', 'aspect', 'x'), edge('roundness', 'value', 'aspect', 'y'),
      edge('center', 'value', 'scaled-center', 'a'), edge('aspect', 'value', 'scaled-center', 'b'),
      edge('scaled-center', 'value', 'radius', 'value'), edge('radius', 'value', 'distance', 'a'), edge('two', 'value', 'distance', 'b'),
      edge('size', 'value', 'outer-edge', 'a'), edge('softness', 'value', 'outer-edge', 'b'),
      edge('size', 'value', 'edge-ramp', 'edge0'), edge('outer-edge', 'value', 'edge-ramp', 'edge1'), edge('distance', 'value', 'edge-ramp', 'value'),
      edge('one', 'value', 'factor', 'a'), edge('edge-ramp', 'value', 'factor', 'b'),
      edge('one', 'value', 'gain', 'a'), edge('factor', 'value', 'gain', 'b'), edge('amount', 'value', 'gain', 't'),
      edge('gain', 'value', 'gain-rgb', 'value'), edge('split', 'rgb', 'shade', 'a'), edge('gain-rgb', 'rgb', 'shade', 'b'),
      edge('shade', 'value', 'combine', 'rgb'), edge('split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image'),
    ],
    layout: {
      frame: { x: 0, y: 0 }, split: { x: 260, y: 0 }, shade: { x: 1560, y: 0 },
      combine: { x: 1820, y: 0 }, output: { x: 2080, y: 0 },
      uv: { x: 0, y: 340 }, center: { x: 520, y: 340 }, aspect: { x: 780, y: 340 },
      'scaled-center': { x: 1040, y: 340 }, radius: { x: 1300, y: 340 }, distance: { x: 1560, y: 340 },
      'edge-ramp': { x: 1820, y: 340 }, factor: { x: 2080, y: 340 },
      half: { x: 0, y: 680 }, 'half-vec2': { x: 260, y: 680 }, one: { x: 520, y: 680 },
      roundness: { x: 780, y: 680 }, two: { x: 1300, y: 680 }, size: { x: 1560, y: 680 },
      'outer-edge': { x: 1820, y: 680 }, gain: { x: 2080, y: 680 },
      softness: { x: 1560, y: 1020 }, amount: { x: 1820, y: 1020 }, 'gain-rgb': { x: 2080, y: 1020 },
    },
  };
}

export function createDefaultContextualEffectGraph(type: EditableContextualEffectType): EffectOperatorGraph {
  if (type === 'vignette') return createDefaultVignetteGraph();
  throw new Error(`Unsupported contextual effect: ${String(type)}`);
}
