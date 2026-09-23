import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Preserve authored processing of the sampler's current-image branch. */
export function temporalCurrentGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  const history = graph.nodes.filter(node => node.operator === 'image.sample-history');
  const output = graph.nodes.filter(node => node.operator === 'image.output');
  const current = graph.edges.find(edge => edge.to === history[0]?.id && edge.input === 'current');
  if (history.length !== 1 || output.length !== 1 || !current) throw new Error('Hybrid rendering requires one connected temporal sampler.');
  return { ...graph, edges: [...graph.edges.filter(edge => edge.to !== output[0].id),
    { ...current, id: '__hybrid_current_output', to: output[0].id, input: 'image' }] };
}

/** Evaluate the authored temporal request itself: RG = source UV, B = output delay.
 * The editor graph stays unchanged, including custom maps and protection wiring.
 */
export function temporalDemandGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  const histories = graph.nodes.filter(node => node.operator === 'image.sample-history');
  const outputs = graph.nodes.filter(node => node.operator === 'image.output');
  if (histories.length !== 1 || outputs.length !== 1) throw new Error('Full-resolution preparation requires exactly one temporal sampler in the graph.');
  const uv = graph.edges.find(edge => edge.to === histories[0].id && edge.input === 'uv');
  const delay = graph.edges.find(edge => edge.to === histories[0].id && edge.input === 'delay');
  if (!uv || !delay) throw new Error('Temporal sampler requires connected coordinates and delay.');
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
