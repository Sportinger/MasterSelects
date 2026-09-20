import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableColorEffectType = 'brightness' | 'contrast' | 'saturation';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

function base(nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph {
  const ordered = [node('frame', 'image.frame'), node('split', 'vector.split.rgba'), ...nodes,
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: ordered,
    edges: [edge('frame', 'image', 'split', 'image'), ...edges, edge('split', 'alpha', 'combine', 'alpha'),
      edge('combine', 'image', 'output', 'image')],
    layout: Object.fromEntries(ordered.map((item, index) => [item.id, { x: index * 260, y: item.id === 'split' || item.id === 'combine' ? 0 : 180 }])) };
}
const scalar = (id: string, value: number) => [node(id, 'values.number', {}, { value }), node(`${id}-rgb`, 'convert.scalar-to-rgb')] as const;
const scalarEdges = (id: string) => edge(id, 'value', `${id}-rgb`, 'value');
const clampTail = (source: string) => [
  edge(source, 'value', 'clamp', 'value'), edge('zero-rgb', 'rgb', 'clamp', 'min'), edge('one-rgb', 'rgb', 'clamp', 'max'),
  edge('clamp', 'value', 'combine', 'rgb'),
];

export function createDefaultBrightnessGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), node('amount-rgb', 'convert.scalar-to-rgb'), ...zero, ...one,
    node('add', 'math.add.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('amount', 'value', 'amount-rgb', 'value'), scalarEdges('zero'), scalarEdges('one'), edge('split', 'rgb', 'add', 'a'),
    edge('amount-rgb', 'rgb', 'add', 'b'), ...clampTail('add'),
  ]);
}

export function createDefaultContrastGraph(): EffectOperatorGraph {
  const half = scalar('half', 0.5), zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), node('amount-rgb', 'convert.scalar-to-rgb'), ...half, ...zero, ...one,
    node('subtract-half', 'math.subtract.rgb'), node('multiply', 'math.multiply.rgb'), node('add-half', 'math.add.rgb'), node('clamp', 'math.clamp.rgb')], [
    edge('amount', 'value', 'amount-rgb', 'value'), scalarEdges('half'), scalarEdges('zero'), scalarEdges('one'),
    edge('split', 'rgb', 'subtract-half', 'a'), edge('half-rgb', 'rgb', 'subtract-half', 'b'),
    edge('subtract-half', 'value', 'multiply', 'a'), edge('amount-rgb', 'rgb', 'multiply', 'b'),
    edge('multiply', 'value', 'add-half', 'a'), edge('half-rgb', 'rgb', 'add-half', 'b'), ...clampTail('add-half'),
  ]);
}

export function createDefaultSaturationGraph(): EffectOperatorGraph {
  const zero = scalar('zero', 0), one = scalar('one', 1);
  return base([node('amount', 'values.number', { value: 'amount' }), ...zero, ...one, node('luma', 'color.luminance-rec601.rgb'),
    node('luma-rgb', 'convert.scalar-to-rgb'), node('mix', 'math.mix.rgb'), node('clamp', 'math.clamp.rgb')], [
    scalarEdges('zero'), scalarEdges('one'), edge('split', 'rgb', 'luma', 'rgb'), edge('luma', 'value', 'luma-rgb', 'value'),
    edge('luma-rgb', 'rgb', 'mix', 'a'), edge('split', 'rgb', 'mix', 'b'), edge('amount', 'value', 'mix', 't'), ...clampTail('mix'),
  ]);
}

export function createDefaultColorEffectGraph(type: EditableColorEffectType): EffectOperatorGraph {
  return type === 'brightness' ? createDefaultBrightnessGraph()
    : type === 'contrast' ? createDefaultContrastGraph() : createDefaultSaturationGraph();
}
