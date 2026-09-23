import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
type Ref = { node: string; port: string };

/** Separate color queries share source history; alpha retains the original base query. */
export function withSlitScanRgbTime(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id.startsWith('rgb-time-'))) return graph;
  const edge = (to: string, input: string) => graph.edges.find(item => item.to === to && item.input === input);
  const delay = edge('history', 'delay'), uv = edge('history', 'uv'), current = edge('history', 'current');
  const field = edge('masked-delay', 'a'), protection = edge('masked-delay', 'b');
  const route = edge('scan-preview-output', 'falseValue');
  if (delay?.from !== 'sample-delay' || !uv || !current || !field || !protection || !route
    || !['safe-delay', 'original-rgba', 'delayed-rgba', 'safe-mix', 'zero'].every(id => graph.nodes.some(node => node.id === id))) return graph;
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const ref = (node: string, port = 'value'): Ref => ({ node, port });
  const linked = (item: OperatorEdge): Ref => ref(item.from, item.output);
  const add = (name: string, operator: string, inputs: Record<string, Ref> = {}, port = 'value',
    bindings: Record<string, string> = {}, constants?: BoundOperatorNode['constants']): Ref => {
    const id = `rgb-time-${name}`;
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    for (const [input, from] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from: from.node, output: from.port, to: id, input });
    return ref(id, port);
  };
  const bound = (key: string, choice = false) => add(key, choice ? 'values.choice' : 'values.number', {}, 'value', { value: key });
  const enabled = add('enabled', 'compare.greater.scalar', { a: bound('rgbTimeMode', true), b: ref('zero') }, 'condition');
  const base = add('unprotected', 'math.multiply.scalar', { a: linked(field), b: ref('safe-delay') });
  const channelDelays: Ref[] = [];
  const channels = ['Red', 'Green', 'Blue'].map((color, i) => {
    const offset = add(`${color}-offset`, 'math.add.scalar', { a: base, b: bound(`rgb${color}Offset`) });
    const clamped = add(`${color}-clamped`, 'math.clamp.scalar', { value: offset, min: ref('zero'), max: ref('safe-delay') });
    const seconds = add(`${color}-delay`, 'math.multiply.scalar', { a: clamped, b: linked(protection) });
    channelDelays.push(seconds);
    const history = add(`${color}-history`, 'image.sample-history', { uv: linked(uv), delay: seconds, current: linked(current) }, 'image');
    const captured = add(`${color}-sample`, 'image.materialize', { image: history }, 'image');
    const rgba = add(`${color}-rgba`, 'convert.image-to-vec4', { image: captured });
    return add(`${color}-channel`, 'vector.split.vec4', { value: rgba }, ['x', 'y', 'z'][i]);
  });
  const baseSample = add('base-sample', 'image.materialize', { image: ref('history', 'image') }, 'image');
  const baseRgba = add('base-rgba', 'convert.image-to-vec4', { image: baseSample });
  const alpha = add('alpha', 'vector.split.vec4', { value: baseRgba }, 'w');
  const rgba = add('rgba', 'vector.combine.vec4', { x: channels[0], y: channels[1], z: channels[2], w: alpha });
  const mix = add('mix', 'math.mix.vec4', { a: ref('original-rgba'), b: rgba, t: ref('safe-mix') });
  const image = add('image', 'convert.vec4-to-image', { value: mix }, 'image');
  // RGB bypasses the single-delay smoothing branch; it cannot reuse its gradient.
  const result = add('result', 'control.select.image', { condition: enabled, falseValue: linked(route), trueValue: image }, 'image');
  const previewRoute = edge('scan-preview-value', 'falseValue');
  let preview: Ref | undefined;
  if (previewRoute?.from === 'masked-delay') {
    const choice = bound('rgbTimePreview', true);
    let seconds = ref('sample-delay');
    channelDelays.forEach((value, i) => {
      const threshold = add(`preview-threshold-${i}`, 'values.number', {}, 'value', {}, { value: i + .5 });
      const selected = add(`preview-selected-${i}`, 'compare.greater.scalar', { a: choice, b: threshold }, 'condition');
      seconds = add(`preview-channel-${i}`, 'select.scalar', { condition: selected, falseValue: seconds, trueValue: value });
    });
    const epsilon = add('epsilon', 'values.number', {}, 'value', {}, { value: .000001 });
    const divisor = add('preview-divisor', 'math.max.scalar', { a: ref('safe-delay'), b: epsilon });
    const normalized = add('preview-normalized', 'math.divide-ieee.scalar', { a: seconds, b: divisor });
    preview = add('preview', 'select.scalar', { condition: enabled, falseValue: linked(previewRoute), trueValue: normalized });
  }
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges.map(item => item === route
    ? { ...item, from: result.node, output: result.port } : item === previewRoute && preview ? { ...item, from: preview.node, output: preview.port } : item), ...edges],
    groups: [...graph.groups ?? [], { id: 'rgb-time', label: 'RGB Time', color: '#ec4899', nodeIds: nodes.map(node => node.id) }],
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 15000 + i % 5 * 280, y: Math.floor(i / 5) * 220 }])) } };
}
