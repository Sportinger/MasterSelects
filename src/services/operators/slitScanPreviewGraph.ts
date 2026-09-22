import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Preview the actual authored delay/protection signals using ordinary graph operators. */
export function withSlitScanPreviews(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id.startsWith('scan-preview-'))) return graph;
  const route = graph.edges.find(edge => edge.to === 'output' && edge.input === 'image');
  if (!route || !['masked-delay', 'subject-clamp', 'zero', 'one'].every(id => graph.nodes.some(node => node.id === id))) return graph;
  const definitions = [
    ['mode', 'values.choice'], ['enabled', 'compare.greater.scalar'], ['mask', 'compare.greater.scalar'],
    ['value', 'select.scalar'], ['rgba', 'vector.combine.vec4'], ['image', 'convert.vec4-to-image'], ['output', 'control.select.image'],
  ];
  const nodes = definitions.map(([id, operator]): BoundOperatorNode => ({ id: `scan-preview-${id}`, operator, operatorVersion: 1,
    bindings: id === 'mode' ? { value: 'preview' } : {} }));
  const e = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `scan-preview-${to}:${input}`, from, output, to: `scan-preview-${to}`, input });
  const edges = [e('scan-preview-mode', 'value', 'enabled', 'a'), e('zero', 'value', 'enabled', 'b'),
    e('scan-preview-mode', 'value', 'mask', 'a'), e('one', 'value', 'mask', 'b'),
    e('scan-preview-mask', 'condition', 'value', 'condition'), e('masked-delay', 'value', 'value', 'falseValue'),
    e('subject-clamp', 'value', 'value', 'trueValue'),
    ...['x', 'y', 'z'].map(input => e('scan-preview-value', 'value', 'rgba', input)), e('one', 'value', 'rgba', 'w'),
    e('scan-preview-rgba', 'value', 'image', 'value'), e('scan-preview-enabled', 'condition', 'output', 'condition'),
    e(route.from, route.output, 'output', 'falseValue'), e('scan-preview-image', 'image', 'output', 'trueValue')];
  return { ...graph, nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges.map(edge => edge === route ? { ...edge, from: 'scan-preview-output', output: 'image' } : edge), ...edges],
    groups: [...graph.groups ?? [], { id: 'scan-preview', label: 'Time Map & Protection Preview', color: '#64748b', nodeIds: nodes.map(node => node.id) }],
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 7200 + (i % 4) * 280, y: Math.floor(i / 4) * 180 }])) },
  };
}
