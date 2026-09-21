import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${to}-${input}`, from, output, to, input });

/** Canonical one-pass Pixel Sort graph. The bounded stable segment sort remains
 * one granular image expression; eligibility, color mixing, and alpha are explicit. */
export function createDefaultPixelSortGraph(): EffectOperatorGraph {
  const nodes = [
    node('frame', 'image.frame'),
    node('scale', 'values.number', { value: 'scale' }),
    node('threshold', 'values.number', { value: 'threshold' }),
    node('amount', 'values.number', { value: 'amount' }),
    node('sorted', 'image.segment-sort-luma'),
    node('original-color', 'vector.split.rgba'),
    node('sorted-color', 'vector.split.rgba'),
    node('luminance', 'color.luminance-rec709.rgb'),
    node('eligible', 'math.step.scalar'),
    node('mix-amount', 'math.multiply.scalar'),
    node('mixed', 'math.mix.rgb'),
    node('combined', 'vector.combine.rgba'),
    node('output', 'image.output'),
  ];
  const edges = [
    edge('frame', 'image', 'sorted', 'image'),
    edge('scale', 'value', 'sorted', 'scale'),
    edge('frame', 'image', 'original-color', 'image'),
    edge('sorted', 'image', 'sorted-color', 'image'),
    edge('original-color', 'rgb', 'luminance', 'rgb'),
    edge('threshold', 'value', 'eligible', 'edge'),
    edge('luminance', 'value', 'eligible', 'value'),
    edge('amount', 'value', 'mix-amount', 'a'),
    edge('eligible', 'value', 'mix-amount', 'b'),
    edge('original-color', 'rgb', 'mixed', 'a'),
    edge('sorted-color', 'rgb', 'mixed', 'b'),
    edge('mix-amount', 'value', 'mixed', 't'),
    edge('mixed', 'value', 'combined', 'rgb'),
    edge('original-color', 'alpha', 'combined', 'alpha'),
    edge('combined', 'image', 'output', 'image'),
  ];
  return {
    version: 1,
    schemaVersion: 1,
    domain: 'compute-image',
    nodes,
    edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 5) * 320, y: Math.floor(index / 5) * 240 }])),
  };
}
