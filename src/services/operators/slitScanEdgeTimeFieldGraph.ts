import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { compositionGroupInterface } from './operatorComposition';

/** Add an edge field only at the generated source-selector boundary. */
export function withSlitScanEdgeTimeField(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id === 'time-field-edge-source')) return graph;
  const shape = graph.groups?.find(group => group.composition?.instance.id === 'time-field-shaped');
  const target = shape && compositionGroupInterface(graph, shape)?.inputs.find(port => port.id === 'value')?.endpoints[0];
  const route = graph.edges.find(edge => edge.to === (target?.nodeId ?? 'time-field-shaped') && edge.input === (target?.portId ?? 'value')
    && edge.from === 'time-field-motion-value');
  const weights = graph.edges.filter(edge => ['time-field-result-0', 'time-field-result-1'].includes(edge.to)
    && edge.input === 't' && edge.from === 'time-field-motion-weight');
  if (!route || weights.length !== 2) return graph;
  const nodes: EffectOperatorGraph['nodes'] = [
    { id: 'time-field-edge-source', operator: 'field.sobel', operatorVersion: 1, bindings: {} },
    { id: 'time-field-edge-resolution', operator: 'image.resolution', operatorVersion: 1, bindings: {} },
    { id: 'time-field-edge-threshold', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 4.5 } },
    { id: 'time-field-edge-selected', operator: 'compare.greater.scalar', operatorVersion: 1, bindings: {} },
    { id: 'time-field-edge-value', operator: 'select.scalar', operatorVersion: 1, bindings: {} },
    { id: 'time-field-edge-weight', operator: 'select.scalar', operatorVersion: 1, bindings: {} },
  ];
  const edge = (from: string, output: string, to: string, input: string) => ({ id: `${to}:${input}`, from, output, to, input });
  const links = [edge('frame', 'image', 'time-field-edge-source', 'image'), edge('uv', 'uv', 'time-field-edge-source', 'uv'),
    edge('time-field-edge-resolution', 'value', 'time-field-edge-source', 'resolution'),
    edge('time-field-mapSource', 'value', 'time-field-edge-selected', 'a'), edge('time-field-edge-threshold', 'value', 'time-field-edge-selected', 'b'),
    edge('time-field-edge-selected', 'condition', 'time-field-edge-value', 'condition'),
    edge('time-field-motion-value', 'value', 'time-field-edge-value', 'falseValue'), edge('time-field-edge-source', 'value', 'time-field-edge-value', 'trueValue'),
    edge('time-field-edge-selected', 'condition', 'time-field-edge-weight', 'condition'),
    edge('time-field-motion-weight', 'value', 'time-field-edge-weight', 'falseValue'), edge('one', 'value', 'time-field-edge-weight', 'trueValue')];
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges.map(item => item === route ? { ...item, from: 'time-field-edge-value' }
    : weights.includes(item) ? { ...item, from: 'time-field-edge-weight' } : item), ...links],
    groups: graph.groups?.map(group => group.id === 'time-map' ? { ...group, nodeIds: [...group.nodeIds, ...nodes.map(node => node.id)] } : group),
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 14800 + i * 280, y: 1000 }])) } };
}
