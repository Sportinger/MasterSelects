import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { compositionGroupInterface } from './operatorComposition';
export const SHAPE_TIME_RESOURCE = 'slit-scan:shape-time';

/** A recorded-motion time map feeds the existing sampler and all its protection/mix controls. */
export function withSlitScanShapeTimeField(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id === 'time-field-shape-source')) return graph;
  const shape = graph.groups?.find(group => group.composition?.instance.id === 'time-field-shaped');
  const target = shape && compositionGroupInterface(graph, shape)?.inputs.find(port => port.id === 'value')?.endpoints[0];
  const route = graph.edges.find(edge => edge.to === (target?.nodeId ?? 'time-field-shaped') && edge.input === (target?.portId ?? 'value')
    && edge.from === 'time-field-edge-value');
  const weights = graph.edges.filter(edge => ['time-field-result-0', 'time-field-result-1'].includes(edge.to)
    && edge.input === 't' && edge.from === 'time-field-edge-weight');
  if (!route || weights.length !== 2) return graph;
  const nodes: EffectOperatorGraph['nodes'] = [
    { id: 'time-field-shape-source', operator: 'image.named-input', operatorVersion: 1, bindings: { resource: SHAPE_TIME_RESOURCE } },
    { id: 'time-field-shape-luma', operator: 'color.luminance-rec709.image', operatorVersion: 1, bindings: {} },
    { id: 'time-field-shape-threshold', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 5.5 } },
    { id: 'time-field-shape-selected', operator: 'compare.greater.scalar', operatorVersion: 1, bindings: {} },
    { id: 'time-field-shape-value', operator: 'select.scalar', operatorVersion: 1, bindings: {} },
    { id: 'time-field-shape-weight', operator: 'select.scalar', operatorVersion: 1, bindings: {} },
  ];
  const edge = (from: string, output: string, to: string, input: string) => ({ id: `${to}:${input}`, from, output, to, input });
  const links = [edge('time-field-shape-source', 'image', 'time-field-shape-luma', 'image'),
    edge('time-field-mapSource', 'value', 'time-field-shape-selected', 'a'), edge('time-field-shape-threshold', 'value', 'time-field-shape-selected', 'b'),
    edge('time-field-shape-selected', 'condition', 'time-field-shape-value', 'condition'),
    edge('time-field-edge-value', 'value', 'time-field-shape-value', 'falseValue'), edge('time-field-shape-luma', 'value', 'time-field-shape-value', 'trueValue'),
    edge('time-field-shape-selected', 'condition', 'time-field-shape-weight', 'condition'),
    edge('time-field-edge-weight', 'value', 'time-field-shape-weight', 'falseValue'), edge('one', 'value', 'time-field-shape-weight', 'trueValue')];
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges.map(item => item === route ? { ...item, from: 'time-field-shape-value' }
    : weights.includes(item) ? { ...item, from: 'time-field-shape-weight' } : item), ...links],
    groups: graph.groups?.map(group => group.id === 'time-map' ? { ...group, nodeIds: [...group.nodeIds, ...nodes.map(node => node.id)] } : group),
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 14800 + i * 280, y: 1240 }])) } };
}
