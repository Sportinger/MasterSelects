import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { withSlitScanTimeGradient } from './slitScanTimeGradient';
import { withSlitScanDisMask } from './slitScanDisGraph';

type Ref = { node: string; port: string };

/** Authored, reusable image nodes. Insert before the existing diagnostic preview
 * selector; never replace the user's scan expression or time-map wiring. */
export function withSlitScanMotion(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id.startsWith('motion-scan-'))) return withSlitScanDisMask(withSlitScanTimeGradient(repairInitialMotionGraph(graph)));
  const history = graph.nodes.filter(node => node.operator === 'image.sample-history');
  if (history.length !== 1) return graph;
  const delay = graph.edges.find(edge => edge.to === history[0].id && edge.input === 'delay');
  const uv = graph.edges.find(edge => edge.to === history[0].id && edge.input === 'uv');
  const route = graph.edges.find(edge => edge.to === 'scan-preview-output' && edge.input === 'falseValue')
    ?? graph.edges.find(edge => edge.to === 'output' && edge.input === 'image');
  if (!delay || !uv || !route) return graph;
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const ref = (edge: OperatorEdge): Ref => ({ node: edge.from, port: edge.output });
  const node = (suffix: string, operator: string, inputs: Record<string, Ref> = {}, port = 'value',
    bindings: Record<string, string> = {}, constants?: BoundOperatorNode['constants']): Ref => {
    const id = `motion-scan-${suffix}`;
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    for (const [input, from] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from: from.node, output: from.port, to: id, input });
    return { node: id, port };
  };
  const n = (id: string, value: number) => node(id, 'values.number', {}, 'value', {}, { value });
  const bound = (id: string, key: string) => node(id, 'values.number', {}, 'value', { value: key });
  const binary = (id: string, operator: string, a: Ref, b: Ref) => node(id, operator, { a, b });
  const mul = (id: string, a: Ref, b: Ref) => binary(id, 'math.multiply.scalar', a, b);
  const zero = n('zero', 0), one = n('one', 1);
  const factor = binary('safe-factor', 'math.max.scalar', bound('factor', 'timeFactor'), one);
  const gradient = node('gradient', 'image.derivative.auto.scalar', { value: ref(delay) }, 'gradient');
  const resolution = node('resolution', 'image.resolution');
  const normalized = binary('time-gradient-uv', 'math.multiply.vec2', gradient, resolution);
  const magnitude = node('time-gradient-length', 'vector.length.vec2', { value: normalized });
  const sourceSeconds = mul('time-gradient-source', magnitude, factor);
  // Milliseconds of delay change over 1% of normalized image space. This stays
  // constant when the preview resolution changes; it is not scene deformation.
  const change = mul('time-change', sourceSeconds, n('time-units', 10));
  const threshold = binary('threshold', 'math.max.scalar', bound('threshold-control', 'scanTimeThreshold'), zero);
  const affected = node('affected', 'math.smoothstep.scalar', { value: change, edge0: threshold,
    edge1: binary('threshold-end', 'math.add.scalar', threshold, n('threshold-feather', 10)) });
  const hasDelay = node('has-delay', 'compare.greater.scalar', { a: ref(delay), b: n('epsilon', .000001) }, 'condition');
  const unprotected = node('unprotected', 'select.scalar', { condition: hasDelay, falseValue: zero, trueValue: one });
  const mix = node('mix', 'math.clamp.scalar', { value: bound('mix-control', 'mix'), min: zero, max: one });
  const mask = mul('mask', mul('reliable-area', affected, one), mul('active-area', unprotected, mix));
  const radius = bound('radius', 'scanSmoothing');
  const smooth = node('smooth', 'image.directional-smooth', { image: ref(route), direction: gradient, radius, mask }, 'image');
  const preview = node('preview', 'values.boolean', {}, 'value', { value: 'scanSmoothingPreview' });
  const visibleMask = node('visible-mask', 'select.scalar', { condition: preview, falseValue: zero, trueValue: mask });
  const rgba = node('color', 'values.color', {}, 'value', {}, { value: [1, .04, .02, 1] });
  const color = node('tint', 'convert.vec4-to-rgb', { value: rgba }, 'rgb');
  const overlay = node('overlay', 'image.mask-overlay', { image: smooth, mask: visibleMask, color, opacity: n('opacity', .55) }, 'image');
  // Derivatives execute in a root fragment scope, outside the lazy diagnostic selector.
  const result = node('result', 'image.materialize', { image: overlay }, 'image');
  return withSlitScanDisMask(withSlitScanTimeGradient({ ...graph, nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges.map(edge => edge === route ? { ...edge, from: result.node, output: result.port } : edge), ...edges],
    groups: [...graph.groups ?? [], { id: 'scan-motion', label: 'Time Gradient Smoothing', color: '#ef4444', nodeIds: nodes.map(item => item.id) }],
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((item, i) => [item.id, { x: 10000 + (i % 5) * 280, y: Math.floor(i / 5) * 180 }])) },
  }));
}

/** Repair only the initial generated wiring, including graphs already in a store. */
function repairInitialMotionGraph(graph: EffectOperatorGraph): EffectOperatorGraph {
  const rawMotion = graph.edges.find(edge => edge.from === 'motion-scan-source' && edge.output === 'image'
    && edge.to === 'motion-scan-deformation' && edge.input === 'motion');
  if (rawMotion && !graph.nodes.some(node => ['motion-scan-consistent-motion', 'motion-scan-region-radius'].includes(node.id))) {
    graph = { ...graph, nodes: [...graph.nodes,
      { id: 'motion-scan-consistent-motion', operator: 'image.motion-consistency', operatorVersion: 1, bindings: {} },
      { id: 'motion-scan-region-radius', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: .02 } }],
      edges: [...graph.edges.map(edge => edge === rawMotion ? { ...edge, from: 'motion-scan-consistent-motion' } : edge),
        { id: 'motion-scan-consistent-motion:image', from: rawMotion.from, output: 'image', to: 'motion-scan-consistent-motion', input: 'image' },
        { id: 'motion-scan-consistent-motion:radius', from: 'motion-scan-region-radius', output: 'value', to: 'motion-scan-consistent-motion', input: 'radius' }],
      groups: graph.groups?.map(group => group.id === 'scan-motion' ? { ...group, nodeIds: [...group.nodeIds, 'motion-scan-consistent-motion', 'motion-scan-region-radius'] } : group),
      layout: { ...graph.layout, 'motion-scan-consistent-motion': { x: 10000, y: 1800 }, 'motion-scan-region-radius': { x: 10280, y: 1800 } } };
  }
  const distortion = graph.nodes.find(node => node.id === 'motion-scan-distortion' && node.operator === 'math.max.scalar');
  const stretch = graph.edges.find(edge => edge.to === distortion?.id && edge.input === 'a'
    && edge.from === 'motion-scan-components' && edge.output === 'x');
  const amount = graph.edges.find(edge => edge.from === distortion?.id && edge.output === 'value'
    && edge.to === 'motion-scan-excess' && edge.input === 'a');
  if (stretch && amount) graph = { ...graph, edges: graph.edges.map(edge => edge === amount
    ? { ...edge, from: stretch.from, output: stretch.output } : edge) };
  const color = graph.nodes.find(node => node.id === 'motion-scan-color' && node.operator === 'values.color');
  const legacy = graph.edges.find(edge => edge.from === color?.id && edge.output === 'value'
    && edge.to === 'motion-scan-overlay' && edge.input === 'color');
  if (legacy && !graph.nodes.some(node => node.id === 'motion-scan-tint')) {
    graph = { ...graph, nodes: [...graph.nodes.map(node => node === color && Array.isArray(node.constants?.value)
      && node.constants.value.length === 3 ? { ...node, constants: { ...node.constants, value: [...node.constants.value, 1] as [number, number, number, number] } } : node),
    { id: 'motion-scan-tint', operator: 'convert.vec4-to-rgb', operatorVersion: 1, bindings: {} }],
    edges: [...graph.edges.map(edge => edge === legacy ? { ...edge, from: 'motion-scan-tint', output: 'rgb' } : edge),
      { id: 'motion-scan-tint:value', from: color!.id, output: 'value', to: 'motion-scan-tint', input: 'value' }],
    groups: graph.groups?.map(group => group.id === 'scan-motion' ? { ...group, nodeIds: [...group.nodeIds, 'motion-scan-tint'] } : group) };
  }
  const tint = graph.nodes.find(node => node.id === 'motion-scan-tint' && node.operator === 'convert.vec4-to-rgb');
  if (tint && graph.edges.some(edge => edge.from === tint.id && edge.output === 'value'
    && edge.to === 'motion-scan-overlay' && edge.input === 'color')) {
    graph = { ...graph, edges: graph.edges.map(edge => edge.from === tint.id && edge.output === 'value'
      && edge.to === 'motion-scan-overlay' && edge.input === 'color' ? { ...edge, output: 'rgb' } : edge) };
  }
  const route = graph.edges.find(edge => edge.from === 'motion-scan-overlay' && edge.output === 'image'
    && ((edge.to === 'scan-preview-output' && edge.input === 'falseValue') || (edge.to === 'output' && edge.input === 'image')));
  if (route && !graph.nodes.some(node => node.id === 'motion-scan-result')) {
    graph = { ...graph, nodes: [...graph.nodes, { id: 'motion-scan-result', operator: 'image.materialize', operatorVersion: 1, bindings: {} }],
      edges: [...graph.edges.map(edge => edge === route ? { ...edge, from: 'motion-scan-result' } : edge),
        { id: 'motion-scan-result:image', from: 'motion-scan-overlay', output: 'image', to: 'motion-scan-result', input: 'image' }],
      groups: graph.groups?.map(group => group.id === 'scan-motion' ? { ...group, nodeIds: [...group.nodeIds, 'motion-scan-result'] } : group) };
  }
  return graph;
}
