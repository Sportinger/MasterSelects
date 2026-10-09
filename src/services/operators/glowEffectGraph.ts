import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

/** Canonical granular graph for the legacy single-pass Glow shader. */
export function createLegacyGlowGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('resolution-components', 'vector.split.vec2'),
    node('kernel-index', 'image.kernel-index'), node('index-components', 'vector.split.vec2'),
    number('one', 1), number('two', 2), number('ten', 10), number('tau', 6.283185307179586), number('half', .5), number('threshold-width', .1), number('softness-offset', .3),
    node('rings', 'values.number', { value: 'rings' }), number('rings-limit', 32), node('rings-clamped', 'math.clamp.scalar'), node('rings-count', 'math.floor.scalar'),
    node('samples', 'values.number', { value: 'samplesPerRing' }), number('samples-minimum', 4), number('samples-limit', 64), node('samples-clamped', 'math.clamp.scalar'), node('samples-count', 'math.floor.scalar'),
    node('ring', 'math.add.scalar'), node('angle-turn', 'math.multiply.scalar'), node('angle-base', 'math.divide-ieee.scalar'), node('angle-stagger', 'math.multiply.scalar'), node('angle', 'math.add.scalar'), node('direction', 'vector.unit-direction.scalar'),
    node('radius', 'values.number', { value: 'radius' }), node('ring-radius', 'math.multiply.scalar'), node('width-reciprocal', 'math.reciprocal.scalar'), node('radius-pixels', 'math.multiply.scalar'), node('radius-scale', 'math.multiply.scalar'), node('offset', 'math.multiply.vec2-scalar'), node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'),
    node('ring-progress', 'math.divide-ieee.scalar'), node('softness', 'values.number', { value: 'softness' }), node('gaussian-sigma', 'math.add.scalar'), node('ring-weight', 'math.gaussian.scalar'),
    node('threshold', 'values.number', { value: 'threshold' }), node('threshold-low', 'math.subtract.scalar'), node('threshold-high', 'math.add.scalar'), node('sample-luma', 'color.luminance-rec709.image'), node('sample-bright', 'math.smoothstep.scalar'), node('bright-sample', 'math.multiply.image-scalar'),
    node('reduce', 'image.kernel-rect-reduce'), node('reduced-rgb', 'convert.vec4-to-rgb'),
    node('center-split', 'vector.split.rgba'), node('center-luma', 'color.luminance-rec709.image'), node('center-bright', 'math.smoothstep.scalar'), node('center-lit', 'math.multiply.rgb-scalar'), node('center-double', 'math.multiply.rgb-scalar'),
    node('glow-sum', 'math.add.rgb'), node('total-weight', 'math.add.scalar'), node('glow-average', 'math.divide-ieee.rgb-scalar'),
    node('amount', 'values.number', { value: 'amount' }), node('amount-scaled-glow', 'math.multiply.rgb-scalar'), node('scaled-glow', 'math.multiply.rgb-scalar'), node('result', 'math.add.rgb'),
    number('zero', 0), node('clamped', 'math.clamp.rgb-scalar'), node('combine', 'vector.combine.rgba'), node('output', 'image.output'),
  ];
  const edges: OperatorEdge[] = [
    edge('resolution', 'value', 'resolution-components', 'value'), edge('kernel-index', 'value', 'index-components', 'value'),
    edge('rings', 'value', 'rings-clamped', 'value'), edge('one', 'value', 'rings-clamped', 'min'), edge('rings-limit', 'value', 'rings-clamped', 'max'), edge('rings-clamped', 'value', 'rings-count', 'value'),
    edge('samples', 'value', 'samples-clamped', 'value'), edge('samples-minimum', 'value', 'samples-clamped', 'min'), edge('samples-limit', 'value', 'samples-clamped', 'max'), edge('samples-clamped', 'value', 'samples-count', 'value'),
    edge('index-components', 'x', 'ring', 'a'), edge('one', 'value', 'ring', 'b'), edge('index-components', 'y', 'angle-turn', 'a'), edge('tau', 'value', 'angle-turn', 'b'), edge('angle-turn', 'value', 'angle-base', 'a'), edge('samples-count', 'value', 'angle-base', 'b'), edge('ring', 'value', 'angle-stagger', 'a'), edge('half', 'value', 'angle-stagger', 'b'), edge('angle-base', 'value', 'angle', 'a'), edge('angle-stagger', 'value', 'angle', 'b'), edge('angle', 'value', 'direction', 'angle'),
    edge('ring', 'value', 'ring-radius', 'a'), edge('radius', 'value', 'ring-radius', 'b'), edge('resolution-components', 'x', 'width-reciprocal', 'value'), edge('ring-radius', 'value', 'radius-pixels', 'a'), edge('width-reciprocal', 'value', 'radius-pixels', 'b'), edge('radius-pixels', 'value', 'radius-scale', 'a'), edge('ten', 'value', 'radius-scale', 'b'), edge('direction', 'value', 'offset', 'a'), edge('radius-scale', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge('offset', 'value', 'sample-uv', 'b'), edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'),
    edge('ring', 'value', 'ring-progress', 'a'), edge('rings-count', 'value', 'ring-progress', 'b'), edge('softness', 'value', 'gaussian-sigma', 'a'), edge('softness-offset', 'value', 'gaussian-sigma', 'b'), edge('ring-progress', 'value', 'ring-weight', 'value'), edge('gaussian-sigma', 'value', 'ring-weight', 'sigma'),
    edge('threshold', 'value', 'threshold-low', 'a'), edge('threshold-width', 'value', 'threshold-low', 'b'), edge('threshold', 'value', 'threshold-high', 'a'), edge('threshold-width', 'value', 'threshold-high', 'b'), edge('sample', 'image', 'sample-luma', 'image'), edge('threshold-low', 'value', 'sample-bright', 'edge0'), edge('threshold-high', 'value', 'sample-bright', 'edge1'), edge('sample-luma', 'value', 'sample-bright', 'value'), edge('sample', 'image', 'bright-sample', 'a'), edge('sample-bright', 'value', 'bright-sample', 'b'),
    edge('bright-sample', 'value', 'reduce', 'sample'), edge('ring-weight', 'value', 'reduce', 'weight'), edge('rings-count', 'value', 'reduce', 'width'), edge('samples-count', 'value', 'reduce', 'height'), edge('reduce', 'sum', 'reduced-rgb', 'value'),
    edge('frame', 'image', 'center-split', 'image'), edge('frame', 'image', 'center-luma', 'image'), edge('threshold-low', 'value', 'center-bright', 'edge0'), edge('threshold-high', 'value', 'center-bright', 'edge1'), edge('center-luma', 'value', 'center-bright', 'value'), edge('center-split', 'rgb', 'center-lit', 'a'), edge('center-bright', 'value', 'center-lit', 'b'), edge('center-lit', 'value', 'center-double', 'a'), edge('two', 'value', 'center-double', 'b'),
    edge('reduced-rgb', 'rgb', 'glow-sum', 'a'), edge('center-double', 'value', 'glow-sum', 'b'), edge('reduce', 'weightSum', 'total-weight', 'a'), edge('two', 'value', 'total-weight', 'b'), edge('glow-sum', 'value', 'glow-average', 'a'), edge('total-weight', 'value', 'glow-average', 'b'),
    edge('glow-average', 'value', 'amount-scaled-glow', 'a'), edge('amount', 'value', 'amount-scaled-glow', 'b'), edge('amount-scaled-glow', 'value', 'scaled-glow', 'a'), edge('two', 'value', 'scaled-glow', 'b'), edge('center-split', 'rgb', 'result', 'a'), edge('scaled-glow', 'value', 'result', 'b'), edge('result', 'value', 'clamped', 'value'), edge('zero', 'value', 'clamped', 'min'), edge('one', 'value', 'clamped', 'max'), edge('clamped', 'value', 'combine', 'rgb'), edge('center-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image'),
  ];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) };
}

/** Upgrade the known legacy wiring, retaining user parameter values and layout. */
export function upgradeGlowGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(n => n.id === 'halo-coverage')) return graph;
  const legacy = createLegacyGlowGraph();
  // Only the original complete recipe is migrated; independently authored graphs keep their semantics.
  const literal = (n: BoundOperatorNode) => n.operator.startsWith('values.') && n.constants && !Object.keys(n.bindings).length;
  const key = (n: BoundOperatorNode) => JSON.stringify([n.operator, n.constants]);
  const names = new Map(graph.nodes.map(n => [n.id, literal(n) ? legacy.nodes.find(other => literal(other) && key(other) === key(n))?.id ?? n.id : n.id]));
  const normalized = graph.edges.map(e => ({ ...e, from: names.get(e.from) ?? e.from, to: names.get(e.to) ?? e.to }));
  if (graph.nodes.filter(n => !literal(n)).length !== legacy.nodes.filter(n => !literal(n)).length
    || legacy.nodes.filter(n => !literal(n)).some(n => !graph.nodes.some(other => other.id === n.id && other.operator === n.operator))
    || normalized.length !== legacy.edges.length || legacy.edges.some(e => !normalized.some(other => other.from === e.from && other.output === e.output && other.to === e.to && other.input === e.input))) return graph;
  const nodes = [...graph.nodes], edges = [...graph.edges];
  const add = (id: string, operator: string) => nodes.push(node(id, operator));
  const link = (from: string, output: string, to: string, input: string) => {
    const index = edges.findIndex(e => e.to === to && e.input === input);
    if (index >= 0) edges.splice(index, 1);
    edges.push(edge(from, output, to, input));
  };
  add('sample-split', 'vector.split.rgba'); add('sample-alpha', 'convert.alpha-to-scalar');
  add('sample-energy', 'math.multiply.image-scalar');
  link('sample', 'image', 'sample-split', 'image'); link('sample-split', 'alpha', 'sample-alpha', 'alpha');
  link('sample', 'image', 'sample-energy', 'a'); link('sample-alpha', 'value', 'sample-energy', 'b');
  link('sample-energy', 'value', 'bright-sample', 'a');
  add('center-alpha', 'convert.alpha-to-scalar'); add('center-energy', 'math.multiply.rgb-scalar');
  link('center-split', 'alpha', 'center-alpha', 'alpha'); link('center-split', 'rgb', 'center-energy', 'a');
  link('center-alpha', 'value', 'center-energy', 'b'); link('center-energy', 'value', 'center-lit', 'a');
  link('center-energy', 'value', 'result', 'a');
  add('halo-vector', 'convert.rgb-to-vec3'); add('halo-components', 'vector.split.vec3');
  add('halo-rg', 'math.max.scalar'); add('halo-maximum', 'math.max.scalar'); add('halo-coverage', 'math.clamp.scalar');
  link('scaled-glow', 'value', 'halo-vector', 'rgb'); link('halo-vector', 'value', 'halo-components', 'value');
  link('halo-components', 'x', 'halo-rg', 'a'); link('halo-components', 'y', 'halo-rg', 'b');
  link('halo-rg', 'value', 'halo-maximum', 'a'); link('halo-components', 'z', 'halo-maximum', 'b');
  link('halo-maximum', 'value', 'halo-coverage', 'value'); link('zero', 'value', 'halo-coverage', 'min'); link('one', 'value', 'halo-coverage', 'max');
  add('alpha-room', 'math.subtract.scalar'); add('halo-alpha', 'math.multiply.scalar'); add('result-alpha', 'math.add.scalar');
  add('safe-alpha', 'math.max.scalar'); nodes.push(number('epsilon-alpha', 0.000001));
  add('straight-result', 'math.divide-ieee.rgb-scalar'); add('alpha-output', 'convert.scalar-to-alpha');
  link('one', 'value', 'alpha-room', 'a'); link('center-alpha', 'value', 'alpha-room', 'b');
  link('halo-coverage', 'value', 'halo-alpha', 'a'); link('alpha-room', 'value', 'halo-alpha', 'b');
  link('center-alpha', 'value', 'result-alpha', 'a'); link('halo-alpha', 'value', 'result-alpha', 'b');
  link('result-alpha', 'value', 'safe-alpha', 'a'); link('epsilon-alpha', 'value', 'safe-alpha', 'b');
  link('result', 'value', 'straight-result', 'a'); link('safe-alpha', 'value', 'straight-result', 'b');
  link('straight-result', 'value', 'clamped', 'value'); link('result-alpha', 'value', 'alpha-output', 'value');
  link('alpha-output', 'alpha', 'combine', 'alpha');
  // Divide the pixel offset by both dimensions, preserving circular halos on portrait images.
  add('pixel-radius', 'math.multiply.scalar'); add('pixel-offset', 'math.multiply.vec2-scalar'); add('normalized-offset', 'math.divide-ieee.vec2');
  link('ring-radius', 'value', 'pixel-radius', 'a'); link('ten', 'value', 'pixel-radius', 'b');
  link('direction', 'value', 'pixel-offset', 'a'); link('pixel-radius', 'value', 'pixel-offset', 'b');
  link('pixel-offset', 'value', 'normalized-offset', 'a'); link('resolution', 'value', 'normalized-offset', 'b');
  link('normalized-offset', 'value', 'sample-uv', 'b');
  return { ...graph, nodes, edges, layout: { ...graph.layout,
    ...Object.fromEntries(nodes.slice(graph.nodes.length).map((n, i) => [n.id, { x: (i % 8) * 280, y: 3400 + Math.floor(i / 8) * 360 }])) } };
}

export function createDefaultGlowGraph(): EffectOperatorGraph { return upgradeGlowGraph(createLegacyGlowGraph()); }
