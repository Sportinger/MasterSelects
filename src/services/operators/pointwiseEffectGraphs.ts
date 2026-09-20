import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditablePointwiseEffectType = 'threshold' | 'posterize';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const literal = (id: string, value: number) => node(id, 'values.number', {}, { value });
function graph(nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph {
  const ordered = [node('frame', 'image.frame'), node('split', 'vector.split.rgba'), ...nodes,
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: ordered,
    edges: [edge('frame', 'image', 'split', 'image'), ...edges, edge('split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')],
    layout: Object.fromEntries(ordered.map((item, index) => [item.id, { x: index * 260, y: ['split', 'combine'].includes(item.id) ? 0 : 180 }])) };
}

export function createDefaultThresholdGraph(): EffectOperatorGraph {
  return graph([node('luma', 'color.luminance-rec709.rgb'), node('level', 'values.number', { value: 'level' }),
    node('compare', 'compare.greater.scalar'), literal('black', 0), literal('white', 1), node('select', 'select.scalar'),
    node('result-rgb', 'convert.scalar-to-rgb')], [
    edge('split', 'rgb', 'luma', 'rgb'), edge('luma', 'value', 'compare', 'a'), edge('level', 'value', 'compare', 'b'),
    edge('black', 'value', 'select', 'falseValue'), edge('white', 'value', 'select', 'trueValue'), edge('compare', 'condition', 'select', 'condition'),
    edge('select', 'value', 'result-rgb', 'value'), edge('result-rgb', 'rgb', 'combine', 'rgb'),
  ]);
}

export function createDefaultPosterizeGraph(): EffectOperatorGraph {
  return graph([node('levels', 'values.number', { value: 'levels' }), literal('minimum-levels', 2), node('effective-levels', 'math.max.scalar'),
    node('levels-rgb', 'convert.scalar-to-rgb'), node('multiply', 'math.multiply.rgb'), node('floor', 'math.floor.rgb'), literal('one', 1),
    node('denominator', 'math.subtract.scalar'), node('denominator-rgb', 'convert.scalar-to-rgb'), node('divide', 'math.divide-ieee.rgb')], [
    edge('levels', 'value', 'effective-levels', 'a'), edge('minimum-levels', 'value', 'effective-levels', 'b'),
    edge('effective-levels', 'value', 'levels-rgb', 'value'), edge('split', 'rgb', 'multiply', 'a'), edge('levels-rgb', 'rgb', 'multiply', 'b'),
    edge('multiply', 'value', 'floor', 'value'), edge('effective-levels', 'value', 'denominator', 'a'), edge('one', 'value', 'denominator', 'b'),
    edge('denominator', 'value', 'denominator-rgb', 'value'), edge('floor', 'value', 'divide', 'a'), edge('denominator-rgb', 'rgb', 'divide', 'b'),
    edge('divide', 'value', 'combine', 'rgb'),
  ]);
}

export function createDefaultPointwiseEffectGraph(type: EditablePointwiseEffectType): EffectOperatorGraph {
  return type === 'threshold' ? createDefaultThresholdGraph() : createDefaultPosterizeGraph();
}
