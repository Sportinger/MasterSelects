import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { createLegacyGlowGraph } from './glowEffectGraph';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

/** Historical alpha-aware single-pass recipe, retained only for saved-graph recognition. */
export function createLegacyAlphaGlowGraph(): EffectOperatorGraph {
  const graph = createLegacyGlowGraph();
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
