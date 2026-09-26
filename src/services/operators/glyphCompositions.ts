import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorEndpoint, OperatorPort } from '../../types/operatorGraph';

const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({ id, operator, operatorVersion: 1,
  bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
const endpoint = (nodeId: string, portId: string): OperatorEndpoint => ({ nodeId, portId });
const port = (id: string, label: string, type: OperatorPort['type']): OperatorPort => ({ id, label, type, required: true });
const graph = (nodes: BoundOperatorNode[], links: [string, string, string, string][]): EffectOperatorGraph => ({
  version: 1, schemaVersion: 1, domain: 'image', nodes,
  edges: links.map(([from, output, to, input]) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input })),
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 6) * 280, y: Math.floor(index / 6) * 200 }])),
});

/**
 * Draws one glyph of any atlas by index. The index is rounded to the nearest glyph and the atlas row is
 * derived from the glyph centre, so computed integer indices never land on the previous row through
 * float division error (index = columns * n used to fall outside the atlas).
 */
export const GLYPH_COMPOSITIONS: readonly OperatorDefinition[] = [{
  id: 'glyph.sample', version: 1, label: 'Sample Glyph',
  description: 'Coverage of glyph Index at the local cell UV (0–1, top-left origin) in a connected Text Atlas or Glyph Atlas. Index rounds to the nearest glyph.',
  inputs: [port('atlas', 'Atlas', 'image'), port('columns', 'Columns', 'number'), port('rows', 'Rows', 'number'),
    port('index', 'Index', 'number'), port('uv', 'Local UV', 'vec2')],
  outputs: [port('coverage', 'Coverage', 'number')],
  parameters: [], runtime: 'builtin', invalidates: 'appearance', addable: true, state: 'stateless', fusion: 'inline',
  implementation: 'shared', consumers: ['Image graphs', 'Text Atlas'],
  composition: {
    graph: graph([
      node('half', 'values.number', 0.5), node('one', 'values.number', 1), node('tiny', 'values.number', 0.001), node('almost', 'values.number', 0.999),
      node('rounded-index', 'math.add.scalar'), node('glyph', 'math.floor.scalar'), node('glyph-center', 'math.add.scalar'),
      node('safe-columns', 'math.max.scalar'), node('safe-rows', 'math.max.scalar'),
      node('row-ratio', 'math.divide-ieee.scalar'), node('row', 'math.floor.scalar'), node('row-start', 'math.multiply.scalar'),
      node('column', 'math.subtract.scalar'), node('tile', 'vector.combine.vec2'),
      node('tiny-vec2', 'convert.scalar-to-vec2'), node('almost-vec2', 'convert.scalar-to-vec2'), node('clamped-uv', 'math.clamp.vec2'),
      node('atlas-pixel', 'math.add.vec2'), node('atlas-size', 'vector.combine.vec2'), node('atlas-uv', 'math.divide-ieee.vec2'),
      node('atlas-sample', 'image.sample'), node('atlas-rgba', 'convert.image-to-vec4'), node('atlas-split', 'vector.split.vec4'),
    ], [
      ['half', 'value', 'rounded-index', 'b'], ['rounded-index', 'value', 'glyph', 'value'],
      ['glyph', 'value', 'glyph-center', 'a'], ['half', 'value', 'glyph-center', 'b'],
      ['one', 'value', 'safe-columns', 'b'], ['one', 'value', 'safe-rows', 'b'],
      ['glyph-center', 'value', 'row-ratio', 'a'], ['safe-columns', 'value', 'row-ratio', 'b'], ['row-ratio', 'value', 'row', 'value'],
      ['row', 'value', 'row-start', 'a'], ['safe-columns', 'value', 'row-start', 'b'],
      ['glyph', 'value', 'column', 'a'], ['row-start', 'value', 'column', 'b'],
      ['column', 'value', 'tile', 'x'], ['row', 'value', 'tile', 'y'],
      ['tiny', 'value', 'tiny-vec2', 'value'], ['almost', 'value', 'almost-vec2', 'value'],
      ['tiny-vec2', 'value', 'clamped-uv', 'min'], ['almost-vec2', 'value', 'clamped-uv', 'max'],
      ['tile', 'value', 'atlas-pixel', 'a'], ['clamped-uv', 'value', 'atlas-pixel', 'b'],
      ['safe-columns', 'value', 'atlas-size', 'x'], ['safe-rows', 'value', 'atlas-size', 'y'],
      ['atlas-pixel', 'value', 'atlas-uv', 'a'], ['atlas-size', 'value', 'atlas-uv', 'b'],
      ['atlas-uv', 'value', 'atlas-sample', 'uv'], ['atlas-sample', 'image', 'atlas-rgba', 'image'], ['atlas-rgba', 'value', 'atlas-split', 'value'],
    ]),
    inputs: {
      atlas: [endpoint('atlas-sample', 'image')], columns: [endpoint('safe-columns', 'a')], rows: [endpoint('safe-rows', 'a')],
      index: [endpoint('rounded-index', 'a')], uv: [endpoint('clamped-uv', 'value')],
    },
    outputs: { coverage: endpoint('atlas-split', 'w') },
  },
}];
