import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { withSlitScanPreviews } from './slitScanPreviewGraph';

export const SLIT_SCAN_PROTECTION_RESOURCE = 'slit-scan:protection';

/** Insert at the existing delay input, preserving its authored upstream wiring. */
export function withSlitScanProtection(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id.startsWith('subject-'))) return withSlitScanPreviews(graph);
  const route = graph.edges.find(edge => edge.to === 'masked-delay' && edge.input === 'b');
  if (!route || !['one', 'zero'].every(id => graph.nodes.some(node => node.id === id))) return graph;
  const nodes: BoundOperatorNode[] = [
    { id: 'subject-mask', operator: 'image.named-input', operatorVersion: 1, bindings: { resource: SLIT_SCAN_PROTECTION_RESOURCE } },
    { id: 'subject-rgba', operator: 'convert.image-to-vec4', operatorVersion: 1, bindings: {} },
    { id: 'subject-value', operator: 'vector.split.vec4', operatorVersion: 1, bindings: {} },
    { id: 'subject-strength', operator: 'values.number', operatorVersion: 1, bindings: { value: 'maskStrength' } },
    { id: 'subject-weight', operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {} },
    { id: 'subject-clamp', operator: 'math.clamp.scalar', operatorVersion: 1, bindings: {} },
    { id: 'subject-outside', operator: 'math.subtract.scalar', operatorVersion: 1, bindings: {} },
    { id: 'subject-protected', operator: 'math.multiply.scalar', operatorVersion: 1, bindings: {} },
  ];
  const link = (from: string, output: string, to: string, input: string): OperatorEdge =>
    ({ id: `${to}:${input}`, from, output, to, input });
  const edges = [
    link('subject-mask', 'image', 'subject-rgba', 'image'), link('subject-rgba', 'value', 'subject-value', 'value'),
    link('subject-value', 'x', 'subject-weight', 'a'), link('subject-strength', 'value', 'subject-weight', 'b'),
    link('subject-weight', 'value', 'subject-clamp', 'value'), link('zero', 'value', 'subject-clamp', 'min'),
    link('one', 'value', 'subject-clamp', 'max'), link('one', 'value', 'subject-outside', 'a'),
    link('subject-clamp', 'value', 'subject-outside', 'b'), link('subject-outside', 'value', 'subject-protected', 'b'),
    link(route.from, route.output, 'subject-protected', 'a'),
  ];
  return withSlitScanPreviews({ ...graph, nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges.map(edge => edge === route ? { ...edge, from: 'subject-protected', output: 'value' } : edge), ...edges],
    groups: [...graph.groups ?? [], { id: 'subject-protection', label: 'Subject Protection', color: '#f59e0b', nodeIds: nodes.map(node => node.id) }],
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 6000 + (i % 4) * 280, y: Math.floor(i / 4) * 180 }])) },
  });
}
