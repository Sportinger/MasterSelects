import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';

/** Stretch only the loose returns, after motion, leaving the knitted +Z dome intact. */
export function withJellyfishReturnLength(graph: EffectOperatorGraph): EffectOperatorGraph {
  const first = graph.nodes.length;
  type Port = [string, string];
  const value = (id: string): Port => [id, 'value'];
  const add = (id: string, operator: string, constants?: Record<string, OperatorValue>) => {
    const node: BoundOperatorNode = { id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) };
    graph.nodes.push(node); graph.layout[id] = { x: 7400 + ((graph.nodes.length - first - 1) % 4) * 280,
      y: 3500 + Math.floor((graph.nodes.length - first - 1) / 4) * 220 };
    return node;
  };
  const link = ([from, output]: Port, to: string, input: string) =>
    graph.edges.push({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
  const math = (id: string, op: string, a: Port, b: Port): Port => {
    add(id, `math.${op}.scalar`); link(a, id, 'a'); link(b, id, 'b'); return value(id);
  };
  const length = add('return-length', 'values.number', { value: 1.5 });
  length.bindings = { value: 'return-length_value' };
  length.exposed = { label: 'Return Length', min: 1, max: 3, step: .01 };
  add('return-length-position', 'geometry.position');
  add('return-length-split', 'vector.split.vec3'); link(['return-length-position', 'position'], 'return-length-split', 'value');
  add('return-length-boundary', 'values.number', { value: .55 });
  const anchor = math('return-length-anchor', 'multiply', value('return-length-boundary'), value('body-length'));
  const distance = math('return-length-distance', 'subtract', anchor, ['return-length-split', 'z']);
  const relative = math('return-length-relative', 'divide-ieee', distance, value('body-length'));
  add('return-length-blend', 'field.ramp', { x0: 0, y0: 0, x1: .1, y1: .5, x2: .2, y2: 1 });
  link(relative, 'return-length-blend', 'value');
  const extra = math('return-length-extra', 'subtract', value('return-length'), value('pulse-one'));
  const extension = math('return-length-extension', 'multiply', distance, extra);
  const blended = math('return-length-weighted', 'multiply', extension, value('return-length-blend'));
  const z = math('return-length-z', 'subtract', ['return-length-split', 'z'], blended);
  add('return-length-shape', 'vector.combine.vec3');
  link(['return-length-split', 'x'], 'return-length-shape', 'x');
  link(['return-length-split', 'y'], 'return-length-shape', 'y'); link(z, 'return-length-shape', 'z');
  add('return-length-set', 'geometry.set-position');
  link(['pulse-set', 'curves'], 'return-length-set', 'curves'); link(value('return-length-shape'), 'return-length-set', 'position');
  graph.edges = graph.edges.filter(edge => !(edge.to === 'yarn' && edge.input === 'curves'));
  link(['return-length-set', 'curves'], 'yarn', 'curves');
  graph.groups!.push({ id: 'return-length-group', label: 'Return Length', color: '#729b9f', nodeIds: graph.nodes.slice(first).map(n => n.id) });
  return graph;
}
