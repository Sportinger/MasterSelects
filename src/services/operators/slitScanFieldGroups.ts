import { compositionGroupInterface } from './operatorComposition';
﻿import type { EffectOperatorGraph, OperatorEndpoint, OperatorGroup } from '../../types/operatorGraph';

/** Inspector switches are the same persisted group bypasses as the node canvas. */
export function withSlitScanFieldGroups(original: EffectOperatorGraph): EffectOperatorGraph {
  let graph = original;
  const noiseWeight = graph.edges.find(edge => edge.to === 'time-field-noise-weight' && edge.input === 'trueValue' && edge.from === 'time-field-one');
  if (noiseWeight && !graph.nodes.some(node => node.id === 'time-field-noise-valid')) {
    graph = { ...graph, nodes: [...graph.nodes, { id: 'time-field-noise-valid', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } }],
      edges: graph.edges.map(edge => edge === noiseWeight ? { ...edge, from: 'time-field-noise-valid' } : edge),
      groups: graph.groups?.map(group => group.id === 'time-map' ? { ...group, nodeIds: [...group.nodeIds, 'time-field-noise-valid'] } : group) };
  }
  const endpoint = (nodeId: string, portId = 'value'): OperatorEndpoint => {
    const composition = graph.groups?.find(group => group.composition?.instance.id === nodeId);
    return composition && compositionGroupInterface(graph, composition)?.outputs.find(output => output.id === portId)?.endpoints[0]
      || { nodeId, portId };
  };
  const input = (id: string, port: string) => {
    const composition = graph.groups?.find(group => group.composition?.instance.id === id);
    const target = composition && compositionGroupInterface(graph, composition)?.inputs.find(input => input.id === port)?.endpoints[0];
    const edge = graph.edges.find(edge => edge.to === (target?.nodeId ?? id) && edge.input === (target?.portId ?? port));
    return edge && endpoint(edge.from, edge.output);
  };
  const groups: OperatorGroup[] = [...graph.groups ?? []];
  const add = (id: string, label: string, nodeIds: string[], bypassOutputs: Record<string, OperatorEndpoint | undefined>) => {
    if (groups.some(group => group.id === id) || Object.values(bypassOutputs).some(value => !value)) return;
    const parent = groups.find(group => group.id === 'time-map');
    const members = nodeIds.filter(id => parent?.nodeIds.includes(id));
    const children = groups.filter(group => group.parentId === 'time-map' && group.composition && nodeIds.includes(group.composition.instance.id));
    if (!members.length && !children.length) return;
    parent!.nodeIds = parent!.nodeIds.filter(id => !members.includes(id));
    children.forEach(group => { group.parentId = id; });
    const outputs = Object.fromEntries(Object.entries(bypassOutputs).map(([key, target]) => {
      const at = key.lastIndexOf(':'), mapped = endpoint(key.slice(0, at), key.slice(at + 1));
      return [`${mapped.nodeId}:${mapped.portId}`, target!];
    }));
    groups.push({ id, label, parentId: 'time-map', nodeIds: members, color: '#8b5cf6', bypassOutputs: outputs });
  };
  // Copy group containers before removing members; saved graphs remain immutable.
  for (let i = 0; i < groups.length; i++) groups[i] = { ...groups[i], nodeIds: [...groups[i].nodeIds] };
  add('field-shaping', 'Field shaping', ['time-field-shaped', 'time-field-mapMin', 'time-field-mapMax', 'time-field-mapGamma'],
    { 'time-field-shaped:value': input('time-field-shaped', 'value') });
  add('field-combination', 'Field combination', ['time-field-combined', 'time-field-mapCombine'],
    { 'time-field-combined:value': input('time-field-combined', 'a') });
  add('field-noise', 'Field noise', ['time-field-noise', 'time-field-drift', 'time-field-mapNoiseScale', 'time-field-mapNoiseSeed',
    'time-field-mapNoiseDriftX', 'time-field-mapNoiseDriftY', 'time-field-mapNoiseMode', 'time-field-mapNoiseAmount', 'time-field-noise-valid'],
    { 'time-field-noise:value': endpoint('half'), 'time-field-mapNoiseAmount:value': endpoint('zero'), 'time-field-noise-valid:value': endpoint('zero') });
  const switches = new Set(['time-field-motion-selected', 'time-field-motion-threshold', 'time-field-motion-value', 'time-field-motion-weight']);
  add('field-motion', 'Motion field', [...graph.nodes.filter(node => node.id.startsWith('time-field-motion-') && !switches.has(node.id)).map(node => node.id), 'time-field-motion-field'],
    { 'time-field-motion-field:value': endpoint('zero'), 'time-field-motion-field:weight': endpoint('zero') });
  const rgb = groups.find(group => group.id === 'rgb-time');
  if (rgb && !rgb.bypassOutputs) {
    const result = input('rgb-time-result', 'falseValue'), preview = input('rgb-time-preview', 'falseValue');
    if (result && preview) rgb.bypassOutputs = { 'rgb-time-result:image': result, 'rgb-time-preview:value': preview };
  }
  return { ...graph, groups };
}
