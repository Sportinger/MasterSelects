import type { EffectOperatorGraph, OperatorEndpoint } from '../../types/operatorGraph';

/** Explicit neutral signals keep profile, mask and map settings intact while bypassed. */
export function withSlitScanGroupBypasses(graph: EffectOperatorGraph): EffectOperatorGraph {
  const input = (id: string, port: string): OperatorEndpoint | undefined => {
    const edge = graph.edges.find(edge => edge.to === id && edge.input === port);
    return edge && { nodeId: edge.from, portId: edge.output };
  };
  const number = (id: string, value: number): OperatorEndpoint | undefined =>
    graph.nodes.some(node => node.id === id && node.operator === 'values.number' && node.constants?.value === value)
      ? { nodeId: id, portId: 'value' } : undefined;
  return { ...graph, groups: graph.groups?.map(group => {
    if (group.bypassOutputs) return group;
    const outputs: Record<string, OperatorEndpoint> = {};
    const add = (id: string, operator: string, target?: OperatorEndpoint) => {
      if (target && group.nodeIds.includes(id) && graph.nodes.some(node => node.id === id && node.operator === operator)) outputs[`${id}:value`] = target;
    };
    if (group.id === 'time-map') {
      for (const id of ['time-map-mix-0', 'time-map-mix-1']) add(id, 'math.mix.scalar', input(id, 'a'));
    } else if (group.id === 'subject-protection') {
      add('subject-protected', 'math.multiply.scalar', input('subject-protected', 'a'));
      add('subject-clamp', 'math.clamp.scalar', number('zero', 0));
    } else if (group.id === 'scan-protection') {
      add('protection-mask', 'select.scalar', number('one', 1));
      add('spatial-profile', 'select.scalar', input('spatial-profile', 'falseValue'));
    }
    return Object.keys(outputs).length ? { ...group, bypassOutputs: outputs } : group;
  }) };
}
