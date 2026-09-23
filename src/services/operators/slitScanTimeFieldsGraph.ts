import { withSlitScanMotionTimeField } from './slitScanMotionTimeFieldGraph';
import { withSlitScanEdgeTimeField } from './slitScanEdgeTimeFieldGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export const SLIT_SCAN_TIME_MASK_RESOURCE = 'slit-scan:time-mask';
type Ref = { node: string; port: string };

/** Extend only the known map output; preserve authored profile and legacy channel processing. */
export function withSlitScanTimeFields(graph: EffectOperatorGraph): EffectOperatorGraph {
  return withSlitScanEdgeTimeField(withSlitScanMotionTimeField(withBaseTimeFields(graph)));
}

function withBaseTimeFields(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id.startsWith('time-field-'))) return graph;
  const routes = graph.edges.filter(edge => ['time-map-mix-0', 'time-map-mix-1'].includes(edge.to)
    && edge.input === 'b' && edge.from === 'time-map-selected' && edge.output === 'value');
  const standard = [
    ['time-map-value', 'value', 'time-map-inverted', 'b'], ['one', 'value', 'time-map-inverted', 'a'],
    ['time-map-value', 'value', 'time-map-selected', 'falseValue'],
    ['time-map-inverted', 'value', 'time-map-selected', 'trueValue'],
    ['time-map-invert-enabled', 'condition', 'time-map-selected', 'condition'],
  ];
  if (routes.length !== 2 || !standard.every(([from, output, to, input]) => graph.edges.some(edge =>
    edge.from === from && edge.output === output && edge.to === to && edge.input === input))) return graph;
  if (routes.some(route => !graph.edges.some(edge => edge.to === route.to && edge.input === 'a'))) return graph;
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [];
  const ref = (node: string, port = 'value'): Ref => ({ node, port });
  const node = (suffix: string, operator: string, inputs: Record<string, Ref> = {}, port = 'value', bindings: Record<string, string> = {}, value?: number): Ref => {
    const id = `time-field-${suffix}`;
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(value === undefined ? {} : { constants: { value } }) });
    for (const [input, from] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from: from.node, output: from.port, to: id, input });
    return ref(id, port);
  };
  const n = (id: string, value: number) => node(id, 'values.number', {}, 'value', {}, value);
  const bound = (key: string, choice = false) => node(key, choice ? 'values.choice' : 'values.number', {}, 'value', { value: key });
  const select = (id: string, condition: Ref, falseValue: Ref, trueValue: Ref) => node(id, 'select.scalar', { condition, falseValue, trueValue });
  const greater = (id: string, a: Ref, value: number) => node(id, 'compare.greater.scalar', { a, b: n(`${id}-threshold`, value) }, 'condition');
  const zero = n('zero', 0), one = n('one', 1), source = bound('mapSource', true);
  const inputSelected = greater('input-selected', source, .5);
  const inputRgba = node('input-rgba', 'convert.image-to-vec4', { image: ref('frame', 'image') });
  const imageRgba = node('image-rgba', 'math.mix.vec4', { a: ref('time-map-rgba'), b: inputRgba,
    t: select('image-weight', inputSelected, zero, one) });
  const image = node('image', 'convert.vec4-to-image', { value: imageRgba }, 'image');
  const channel = node('channel', 'field.image-channel', { image, channel: ref('time-map-channel'),
    phase: bound('mapHuePhase'), hueRamp: bound('mapHueMode', true) });
  const extendedChannel = select('external-channel', greater('extended-channel', ref('time-map-channel'), 1.5), ref('time-map-value'), channel);
  const imageField = select('image-field', inputSelected, extendedChannel, channel);
  const drift = node('drift', 'vector.combine.vec2', { x: bound('mapNoiseDriftX'), y: bound('mapNoiseDriftY') });
  const noise = node('noise', 'field.noise2d', { uv: ref('uv', 'uv'), scale: bound('mapNoiseScale'), seed: bound('mapNoiseSeed'),
    time: ref('time'), drift, hard: bound('mapNoiseMode', true) });
  const mask = node('mask', 'image.named-input', {}, 'image', { resource: SLIT_SCAN_TIME_MASK_RESOURCE });
  const maskRgba = node('mask-rgba', 'convert.image-to-vec4', { image: mask });
  const maskParts = node('mask-parts', 'vector.split.vec4', { value: maskRgba }, 'x');
  const noiseSelected = greater('noise-selected', source, 1.5), maskSelected = greater('mask-selected', source, 2.5);
  const value = select('source-value', maskSelected, select('noise-or-image', noiseSelected, imageField, noise), maskParts);
  const weight = select('source-weight', maskSelected, select('noise-weight', noiseSelected, { ...channel, port: 'weight' }, one), { ...maskParts, port: 'w' });
  const shaped = node('shaped', 'field.normalize', { value, min: bound('mapMin'), max: bound('mapMax'),
    gamma: bound('mapGamma'), invert: ref('time-map-invert') });
  const combined = node('combined', 'field.combine', { a: shaped, b: noise, amount: bound('mapNoiseAmount'), operation: bound('mapCombine', true) });
  const routed = routes.map((route, index) => {
    const profile = graph.edges.find(edge => edge.to === route.to && edge.input === 'a')!;
    return node(`result-${index}`, 'math.mix.scalar', { a: ref(profile.from, profile.output), b: combined, t: weight });
  });
  return { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges.map(edge => {
    const index = routes.indexOf(edge);
    return index < 0 ? edge : { ...edge, from: routed[index].node, output: routed[index].port };
  }), ...edges], groups: graph.groups?.map(group => group.id === 'time-map'
    ? { ...group, label: 'Time Field', nodeIds: [...group.nodeIds, ...nodes.map(item => item.id)] } : group),
  layout: { ...graph.layout, ...Object.fromEntries(nodes.map((item, i) => [item.id, { x: 11600 + (i % 5) * 280, y: Math.floor(i / 5) * 220 }])) } };
}
