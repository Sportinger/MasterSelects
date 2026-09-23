import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
type Ref = { node: string; port: string };

/** Current-source analysis is independent of the delay it will calculate. */
export function withSlitScanMotionTimeField(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id === 'time-field-motion-source')) return graph;
  const valueRoute = graph.edges.find(edge => edge.to === 'time-field-shaped' && edge.input === 'value'
    && edge.from === 'time-field-source-value' && edge.output === 'value');
  const weights = graph.edges.filter(edge => ['time-field-result-0', 'time-field-result-1'].includes(edge.to)
    && edge.input === 't' && edge.from === 'time-field-source-weight' && edge.output === 'value');
  if (!valueRoute || weights.length !== 2) return graph;
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const ref = (node: string, port = 'value'): Ref => ({ node, port });
  const add = (name: string, operator: string, inputs: Record<string, Ref> = {}, port = 'value',
    bindings: Record<string, string> = {}, constants?: BoundOperatorNode['constants']): Ref => {
    const id = `time-field-motion-${name}`;
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    for (const [input, source] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from: source.node, output: source.port, to: id, input });
    return ref(id, port);
  };
  const num = (name: string, value: number) => add(name, 'values.number', {}, 'value', {}, { value });
  const bound = (key: string, choice = false) => add(key, choice ? 'values.choice' : 'values.number', {}, 'value', { value: key });
  const factor = add('factor', 'math.max.scalar', { a: bound('timeFactor'), b: num('one', 1) });
  const interval = add('interval', 'math.divide-ieee.scalar', { a: num('source-interval', 1 / 30), b: factor });
  const motion = add('source', 'image.source-motion', { uv: ref('uv', 'uv'), delay: num('zero', 0), interval }, 'image',
    { timeFactor: 'timeFactor' }, { lookback: 0, stabilize: true, required: true });
  const radians = add('radians', 'math.multiply.scalar', { a: bound('mapMotionAngle'), b: num('degrees', Math.PI / 180) });
  const field = add('field', 'field.motion', { image: motion, mode: bound('mapMotionMode', true), angle: radians,
    min: bound('mapMotionMin'), max: bound('mapMotionMax'), confidence: bound('mapMotionConfidence') });
  const selected = add('selected', 'compare.greater.scalar', { a: ref('time-field-mapSource'), b: num('threshold', 3.5) }, 'condition');
  const value = add('value', 'select.scalar', { condition: selected, falseValue: ref(valueRoute.from, valueRoute.output), trueValue: field });
  const weight = add('weight', 'select.scalar', { condition: selected, falseValue: ref('time-field-source-weight'), trueValue: { ...field, port: 'weight' } });
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges.map(edge => edge === valueRoute
    ? { ...edge, from: value.node, output: value.port } : weights.includes(edge) ? { ...edge, from: weight.node, output: weight.port } : edge), ...edges],
    groups: graph.groups?.map(group => group.id === 'time-map' ? { ...group, nodeIds: [...group.nodeIds, ...nodes.map(node => node.id)] } : group),
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 13200 + i % 5 * 280, y: Math.floor(i / 5) * 220 }])) } };
}
