import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1,
  bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const endpoint = (nodeId: string, portId: string): OperatorEndpoint => ({ nodeId, portId });
const port = (id: string, label: string, type: OperatorPort['type']): OperatorPort => ({ id, label, type, required: true });
const graph = (nodes: BoundOperatorNode[], links: [string, string, string, string][]): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', nodes,
  edges: links.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index * 280, y: 0 }])),
});
const definition = (id: string, label: string, description: string, inputs: OperatorPort[], outputs: OperatorPort[],
  composition: NonNullable<OperatorDefinition['composition']>): OperatorDefinition => ({
  id, version: 1, label, description, inputs, outputs, composition, parameters: [], runtime: 'builtin',
  invalidates: 'appearance', addable: true, state: 'stateless', fusion: 'inline', implementation: 'shared',
  consumers: ['Image graphs', 'Gaussian Blur', 'Box Blur', 'Sharpen'],
});

/** V1 formulas preserve existing arithmetic and lexical sampling; no new GPU operator or render pass. */
export const SAMPLING_COMPOSITIONS: readonly OperatorDefinition[] = [
  definition('sampling.texel-offset.vec2', 'Texel Offset',
    'Convert a pixel offset to normalized UV using the image resolution. Resolution must be nonzero.',
    [port('index', 'Pixel offset', 'vec2'), port('resolution', 'Resolution (px)', 'vec2')], [port('offset', 'UV offset', 'vec2')], {
      graph: graph([node('one', 'values.number', 1), node('one-vec2', 'convert.scalar-to-vec2'),
        node('texel-size', 'math.divide-ieee.vec2'), node('offset', 'math.multiply.vec2')], [
        ['one', 'value', 'one-vec2', 'value'], ['one-vec2', 'value', 'texel-size', 'a'], ['texel-size', 'value', 'offset', 'b'],
      ]),
      inputs: { index: [endpoint('offset', 'a')], resolution: [endpoint('texel-size', 'b')] },
      outputs: { offset: endpoint('offset', 'value') },
    }),
  definition('sampling.gaussian-weight.vec2', 'Gaussian Weight',
    'Compute exp(-dot(offset, offset) / (2 * sigma * sigma)). Offset and nonzero sigma must use the same units. Kernel indices remain scoped to their reducer.',
    [port('offset', 'Offset', 'vec2'), port('sigma', 'Sigma', 'number')], [port('weight', 'Weight', 'number')], {
      graph: graph([node('two', 'values.number', 2), node('two-sigma', 'math.multiply.scalar'), node('two-sigma-squared', 'math.multiply.scalar'),
        node('distance-squared', 'vector.dot.vec2'), node('zero', 'values.number', 0), node('negative-distance', 'math.subtract.scalar'),
        node('exponent', 'math.divide-ieee.scalar'), node('weight', 'math.exp.scalar')], [
        ['two', 'value', 'two-sigma', 'a'], ['two-sigma', 'value', 'two-sigma-squared', 'a'],
        ['zero', 'value', 'negative-distance', 'a'], ['distance-squared', 'value', 'negative-distance', 'b'],
        ['negative-distance', 'value', 'exponent', 'a'], ['two-sigma-squared', 'value', 'exponent', 'b'], ['exponent', 'value', 'weight', 'value'],
      ]),
      inputs: { offset: [endpoint('distance-squared', 'a'), endpoint('distance-squared', 'b')],
        sigma: [endpoint('two-sigma', 'b'), endpoint('two-sigma-squared', 'b')] },
      outputs: { weight: endpoint('weight', 'value') },
    }),
  definition('sampling.normalize-rgba', 'Normalize by Weight',
    'Divide an accumulated RGBA sum by its nonzero total weight, then return an image. Reuses any compatible grid or sequence reducer without another sampling pass.',
    [port('sum', 'RGBA sum', 'vec4'), port('weightSum', 'Weight sum', 'number')], [port('image', 'Image', 'image')], {
      graph: graph([node('weight-vec4', 'convert.scalar-to-vec4'), node('average', 'math.divide-ieee.vec4'), node('blurred', 'convert.vec4-to-image')], [
        ['weight-vec4', 'value', 'average', 'b'], ['average', 'value', 'blurred', 'value'],
      ]),
      inputs: { sum: [endpoint('average', 'a')], weightSum: [endpoint('weight-vec4', 'value')] },
      outputs: { image: endpoint('blurred', 'image') },
    }),
];
