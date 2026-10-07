import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';

/** Coherent head wobble and smooth, independently seeded loose yarn motion. */
export function withJellyfishSoftMotion(graph: EffectOperatorGraph): EffectOperatorGraph {
  const first = graph.nodes.length;
  type Port = [string, string];
  const value = (id: string): Port => [id, 'value'];
  const add = (id: string, operator: string, constants?: Record<string, OperatorValue>) => {
    const node: BoundOperatorNode = { id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) };
    graph.nodes.push(node);
    graph.layout[id] = { x: 5200 + ((graph.nodes.length - first - 1) % 6) * 280,
      y: 1800 + Math.floor((graph.nodes.length - first - 1) / 6) * 230 };
    return node;
  };
  const link = ([from, output]: Port, to: string, input: string) =>
    graph.edges.push({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
  const math = (id: string, op: string, a: Port, b: Port): Port => {
    add(id, `math.${op}.scalar`); link(a, id, 'a'); link(b, id, 'b'); return value(id);
  };
  const control = (id: string, label: string, amount: number, max: number) => {
    const node = add(id, 'values.number', { value: amount });
    node.bindings = { value: `${id}_value` }; node.exposed = { label, min: 0, max, step: .005 };
    return value(id);
  };
  const head = control('soft-head', 'Head Wobble', .035, .15);
  const tail = control('soft-tail', 'Tail Soft Noise', .075, .3);
  const speed = control('soft-speed', 'Soft Motion', .15, .5);
  const time = math('soft-time', 'multiply', value('pulse-clock'), speed);
  const movingY = math('soft-moving-y', 'add', ['return-split', 'y'], time);
  add('soft-head-position', 'vector.combine.vec3');
  link(['return-split', 'x'], 'soft-head-position', 'x');
  link(movingY, 'soft-head-position', 'y'); link(['return-split', 'z'], 'soft-head-position', 'z');
  add('soft-head-mask', 'field.ramp', { x0: .3, y0: 0, x1: .6, y1: .5, x2: .8, y2: 1 });
  link(value('curl-longitudinal'), 'soft-head-mask', 'value');
  const headAmount = math('soft-head-amount', 'multiply', head, value('soft-head-mask'));
  const tailAmount = math('soft-tail-amount', 'multiply', tail, value('curl-mask'));

  // The strand index decorrelates neighbouring courses without adding high
  // spatial frequencies along each yarn. Repeated endpoints keep the same seed.
  add('soft-info', 'geometry.curve-info');
  add('soft-seed-spacing', 'values.number', { value: 17.31 });
  const seed = math('soft-strand-seed', 'multiply', ['soft-info', 'strand'], value('soft-seed-spacing'));
  const strandX = math('soft-strand-x', 'add', ['return-split', 'x'], seed);
  // Blend the two sampled fields, never their travelling coordinates. Mixing
  // z +/- time*speed first compresses more noise into the rear seam over time.
  const strandZ = math('soft-strand-z', 'add', ['return-split', 'z'], value('return-drift-z'));
  const incomingZ = math('soft-incoming-sample-z', 'subtract', ['return-split', 'z'], value('return-drift-z'));
  for (const [id, z] of [['soft-tail-position', strandZ], ['soft-incoming-position', incomingZ]] as const) {
    add(id, 'vector.combine.vec3');
    link(strandX, id, 'x'); link(movingY, id, 'y'); link(z, id, 'z');
  }

  add('soft-curl-vector', 'vector.split.vec3'); link(value('curl-offset'), 'soft-curl-vector', 'value');
  add('soft-offset', 'vector.combine.vec3');
  for (const [axis, seed] of [['x', 401], ['y', 503], ['z', 607]] as const) {
    // One octave only: broad rounded bends, no fine jagged detail or blur pass.
    add(`soft-head-${axis}`, 'field.noise', { frequency: 1.1, amplitude: 1, seed, octaves: 1 });
    link(value('soft-head-position'), `soft-head-${axis}`, 'position');
    link(headAmount, `soft-head-${axis}`, 'amplitude');
    add(`soft-tail-${axis}`, 'field.noise', { frequency: 1.3, amplitude: 1, seed: seed + 1009, octaves: 1 });
    link(value('soft-tail-position'), `soft-tail-${axis}`, 'position');
    link(tailAmount, `soft-tail-${axis}`, 'amplitude');
    add(`soft-incoming-${axis}`, 'field.noise', { frequency: 1.3, amplitude: 1, seed: seed + 1009, octaves: 1 });
    link(value('soft-incoming-position'), `soft-incoming-${axis}`, 'position');
    link(tailAmount, `soft-incoming-${axis}`, 'amplitude');
    add(`soft-blend-${axis}`, 'math.mix.scalar');
    link(value(`soft-incoming-${axis}`), `soft-blend-${axis}`, 'a');
    link(value(`soft-tail-${axis}`), `soft-blend-${axis}`, 'b');
    link(value('curl-side'), `soft-blend-${axis}`, 't');
    const motion = math(`soft-motion-${axis}`, 'add', value(`soft-head-${axis}`), value(`soft-blend-${axis}`));
    const combined = math(`soft-total-${axis}`, 'add', ['soft-curl-vector', axis], motion);
    link(combined, 'soft-offset', axis);
  }
  graph.edges = graph.edges.filter(edge => !(edge.to === 'handmade' && edge.input === 'offset'));
  link(value('soft-offset'), 'handmade', 'offset');
  graph.groups!.push({ id: 'soft-jellyfish-motion', label: 'Soft Head & Yarn Motion', color: '#88aaa0',
    nodeIds: graph.nodes.slice(first).map(node => node.id) });
  return graph;
}
