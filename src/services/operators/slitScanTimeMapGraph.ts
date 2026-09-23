import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { withSlitScanTimeFields } from './slitScanTimeFieldsGraph';

export const SLIT_SCAN_TIME_MAP_RESOURCE = 'slit-scan:time-map';

/** Keep authored profile inputs, inserting a map mix before temporal band quantization. */
export function withSlitScanTimeMap(graph: EffectOperatorGraph): EffectOperatorGraph {
  if (graph.nodes.some(node => node.id.startsWith('time-map-'))) return withSlitScanTimeFields(graph);
  const routes = graph.edges.filter(edge => (edge.to === 'band-position' && edge.input === 'a')
    || (edge.to === 'smooth-or-banded' && edge.input === 'falseValue'));
  if (routes.length !== 2 || !['zero', 'one'].every(id => graph.nodes.some(node => node.id === id))) return graph;
  const nodes: BoundOperatorNode[] = [];
  const edges: OperatorEdge[] = [];
  const add = (id: string, operator: string, bindings: Record<string, string> = {}) => {
    nodes.push({ id: `time-map-${id}`, operator, operatorVersion: 1, bindings });
  };
  const link = (from: string, output: string, to: string, input: string) => {
    edges.push({ id: `time-map-${to}:${input}`, from, output, to: `time-map-${to}`, input });
  };
  add('source', 'image.named-input', { resource: SLIT_SCAN_TIME_MAP_RESOURCE });
  add('luma', 'color.luminance-rec709.image'); link('time-map-source', 'image', 'luma', 'image');
  add('rgba', 'convert.image-to-vec4'); link('time-map-source', 'image', 'rgba', 'image');
  add('channels', 'vector.split.vec4'); link('time-map-rgba', 'value', 'channels', 'value');
  add('channel', 'values.choice', { value: 'mapChannel' });
  add('alpha', 'compare.greater.scalar'); link('time-map-channel', 'value', 'alpha', 'a'); link('zero', 'value', 'alpha', 'b');
  add('value', 'select.scalar'); link('time-map-alpha', 'condition', 'value', 'condition');
  link('time-map-luma', 'value', 'value', 'falseValue'); link('time-map-channels', 'w', 'value', 'trueValue');
  add('invert', 'values.choice', { value: 'mapInvert' });
  add('inverted', 'math.subtract.scalar'); link('one', 'value', 'inverted', 'a'); link('time-map-value', 'value', 'inverted', 'b');
  add('invert-enabled', 'compare.greater.scalar'); link('time-map-invert', 'value', 'invert-enabled', 'a'); link('zero', 'value', 'invert-enabled', 'b');
  add('selected', 'select.scalar'); link('time-map-invert-enabled', 'condition', 'selected', 'condition');
  link('time-map-value', 'value', 'selected', 'falseValue'); link('time-map-inverted', 'value', 'selected', 'trueValue');
  add('amount', 'values.number', { value: 'mapAmount' });
  add('safe-amount', 'math.clamp.scalar'); link('time-map-amount', 'value', 'safe-amount', 'value');
  link('zero', 'value', 'safe-amount', 'min'); link('one', 'value', 'safe-amount', 'max');
  for (const [index, route] of routes.entries()) {
    add(`mix-${index}`, 'math.mix.scalar'); link(route.from, route.output, `mix-${index}`, 'a');
    link('time-map-selected', 'value', `mix-${index}`, 'b'); link('time-map-safe-amount', 'value', `mix-${index}`, 't');
  }
  return withSlitScanTimeFields({ ...graph, nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges.map(edge => {
      const index = routes.indexOf(edge);
      return index < 0 ? edge : { ...edge, from: `time-map-mix-${index}`, output: 'value' };
    }), ...edges],
    groups: [...graph.groups ?? [], { id: 'time-map', label: 'External Time Map', color: '#8b5cf6', nodeIds: nodes.map(node => node.id) }],
    layout: { ...graph.layout, ...Object.fromEntries(nodes.map((node, i) => [node.id, { x: 8400 + (i % 4) * 280, y: Math.floor(i / 4) * 180 }])) },
  });
}
