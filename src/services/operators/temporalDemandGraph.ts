import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export interface TemporalGraphQuery {
  id: string;
  uv: OperatorEdge;
  delay: OperatorEdge;
  current: OperatorEdge;
}

/** Each temporal query retains its own authored coordinates, clock and current branch. */
export function temporalGraphQueries(graph: EffectOperatorGraph): TemporalGraphQuery[] {
  return graph.nodes.filter(node => node.operator === 'image.sample-history').map(node => {
    const input = (name: string) => {
      const edges = graph.edges.filter(edge => edge.to === node.id && edge.input === name);
      if (edges.length !== 1) throw new Error(`Temporal sampler ${node.id} requires one connected ${name} input.`);
      return edges[0];
    };
    return { id: node.id, uv: input('uv'), delay: input('delay'), current: input('current') };
  });
}

function selectQuery(graph: EffectOperatorGraph, samplerId?: string): TemporalGraphQuery {
  const histories = graph.nodes.filter(node => node.operator === 'image.sample-history');
  if (!samplerId && histories.length !== 1) throw new Error('Temporal preparation requires exactly one sampler or an explicit sampler ID.');
  const id = samplerId ?? histories[0].id;
  const selected = temporalGraphQueries({ ...graph, nodes: graph.nodes.filter(node => node.operator !== 'image.sample-history' || node.id === id) })[0];
  if (!selected) throw new Error(`Temporal sampler ${id} is unavailable.`);
  return selected;
}

/** Preserve authored processing of the selected sampler's current-image branch. */
export function temporalCurrentGraph(graph: EffectOperatorGraph, samplerId?: string): EffectOperatorGraph {
  const { current } = selectQuery(graph, samplerId);
  const output = graph.nodes.filter(node => node.operator === 'image.output');
  if (output.length !== 1) throw new Error('Hybrid rendering requires one graph output.');
  return { ...graph, edges: [...graph.edges.filter(edge => edge.to !== output[0].id),
    { ...current, id: '__hybrid_current_output', to: output[0].id, input: 'image' }] };
}

/** Evaluate the authored temporal request itself: RG = source UV, B = output delay.
 * The editor graph stays unchanged, including custom maps and protection wiring.
 */
export function temporalDemandGraph(graph: EffectOperatorGraph, samplerId?: string): EffectOperatorGraph {
  const { uv, delay } = selectQuery(graph, samplerId);
  const outputs = graph.nodes.filter(node => node.operator === 'image.output');
  if (outputs.length !== 1) throw new Error('Temporal preparation requires one graph output.');
  const prefix = '__native_demand_';
  if (graph.nodes.some(node => node.id.startsWith(prefix))) throw new Error('Temporal demand node IDs collide with the graph.');
  const nodes: BoundOperatorNode[] = [
    { id: `${prefix}uv`, operator: 'vector.split.vec2', operatorVersion: 1, bindings: {} },
    { id: `${prefix}one`, operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 1 } },
    { id: `${prefix}rgba`, operator: 'vector.combine.vec4', operatorVersion: 1, bindings: {} },
    { id: `${prefix}image`, operator: 'convert.vec4-to-image', operatorVersion: 1, bindings: {} },
  ];
  const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${to}:${input}`, from, output, to, input });
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [
    ...graph.edges.filter(item => item.to !== outputs[0].id),
    edge(uv.from, uv.output, `${prefix}uv`, 'value'),
    edge(`${prefix}uv`, 'x', `${prefix}rgba`, 'x'), edge(`${prefix}uv`, 'y', `${prefix}rgba`, 'y'),
    edge(delay.from, delay.output, `${prefix}rgba`, 'z'), edge(`${prefix}one`, 'value', `${prefix}rgba`, 'w'),
    edge(`${prefix}rgba`, 'value', `${prefix}image`, 'value'), edge(`${prefix}image`, 'image', outputs[0].id, 'image'),
  ] };
}
