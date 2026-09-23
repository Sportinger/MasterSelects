import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** Migrate only the generated detector. Authored time-map wiring and consumers
 * of the reusable motion nodes survive; unused generated analysis is removed. */
export function withSlitScanTimeGradient(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id === 'motion-scan-time-change')) return graph;
  const affected = graph.edges.find(edge => edge.to === 'motion-scan-affected' && edge.input === 'value'
    && edge.from === 'motion-scan-excess');
  const reliability = graph.edges.find(edge => edge.to === 'motion-scan-reliable-area' && edge.input === 'b'
    && edge.from === 'motion-scan-confidence');
  if (!affected || !reliability) return graph;
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const add = (suffix: string, operator: string, inputs: Record<string, [string, string]>, value?: number) => {
    const id = `motion-scan-${suffix}`;
    nodes.push({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
    for (const [input, [from, output]] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from, output, to: id, input });
    return [id, 'value'] as [string, string];
  };
  // dFdx/dFdy are per render pixel. Normalize to UV before measuring so adaptive
  // preview resolution cannot change the threshold. 1000 ms * 1% = 10.
  const normalized = add('time-gradient-uv', 'math.multiply.vec2', {
    a: ['motion-scan-gradient', 'gradient'], b: ['motion-scan-resolution', 'value'] });
  const magnitude = add('time-gradient-length', 'vector.length.vec2', { value: normalized });
  const sourceSeconds = add('time-gradient-source', 'math.multiply.scalar', { a: magnitude, b: ['motion-scan-safe-factor', 'value'] });
  const change = add('time-change', 'math.multiply.scalar', { a: sourceSeconds, b: add('time-units', 'values.number', {}, 10) });
  let next: EffectOperatorGraph = { ...graph, nodes: [...graph.nodes.map(node => node.id === 'motion-scan-threshold-control'
    ? { ...node, bindings: { ...node.bindings, value: 'scanTimeThreshold' } }
    : node.id === 'motion-scan-threshold-feather' ? { ...node, constants: { ...node.constants, value: 10 } } : node), ...nodes],
    edges: [...graph.edges.map(edge => edge === affected ? { ...edge, from: change[0], output: change[1] }
      : edge === reliability ? { ...edge, from: 'motion-scan-one', output: 'value' } : edge), ...edges],
    groups: graph.groups?.map(group => group.id === 'scan-motion'
      ? { ...group, label: 'Time Gradient Smoothing', nodeIds: [...group.nodeIds, ...nodes.map(node => node.id)] } : group),
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 10000 + i * 280, y: 1800 }])) } };
  const obsolete = new Set(['source-interval', 'interval', 'source', 'consistent-motion', 'region-radius',
    'deformation', 'components', 'excess', 'confidence', 'confidence-low', 'confidence-high',
    'distortion', 'compression', 'safe-compression', 'inverse-compression'].map(id => `motion-scan-${id}`));
  while (true) {
    const unused = new Set(next.nodes.filter(node => obsolete.has(node.id) && !next.edges.some(edge => edge.from === node.id)).map(node => node.id));
    if (!unused.size) break;
    next = { ...next, nodes: next.nodes.filter(node => !unused.has(node.id)), edges: next.edges.filter(edge => !unused.has(edge.to)),
      groups: next.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !unused.has(id)) })),
      layout: Object.fromEntries(Object.entries(next.layout ?? {}).filter(([id]) => !unused.has(id))) };
  }
  return next;
}
