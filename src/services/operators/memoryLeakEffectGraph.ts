import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };
class Graph {
  readonly nodes: BoundOperatorNode[] = []; readonly edges: OperatorEdge[] = []; readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 10) * 320, y: Math.floor(this.nodes.length / 10) * 260 }; return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${from.port}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value', port = 'value') { const out = this.node(id, operator, port); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
}

/** Granular expansion of the legacy memory-window byte reinterpretation effect. */
export function createDefaultMemoryLeakGraph(): EffectOperatorGraph {
  const g = new Graph(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const memory = g.node('memory', 'source.memory-window', 'memory', {
    size: 'size', depth: 'depth', offset: 'offset', motion: 'motion', stride: 'stride', seed: 'seed', snapshot: 'snapshot',
  });
  const metadata = { node: memory.node, port: 'metadata' }, metadataParts = g.node('metadata-parts', 'vector.split.vec4', 'x'); g.edge(metadata, metadataParts, 'value');
  const available = { node: metadataParts.node, port: 'x' }, wordWidth = { node: metadataParts.node, port: 'y' }, rows = { node: metadataParts.node, port: 'z' };
  const depth = g.node('depth', 'values.choice', 'value', { value: 'depth' }), floatMode = g.node('float-mode', 'values.choice', 'value', { value: 'floatMode' });
  const floatGain = g.node('float-gain', 'values.number', 'value', { value: 'floatGain' }), opaque = g.node('opaque', 'values.boolean', 'value', { value: 'opaque' });
  const mix = g.node('mix', 'values.number', 'value', { value: 'mix' }), zero = g.number('zero', 0), one = g.number('one', 1), half = g.number('half', .5), tiny = g.number('tiny', .001);
  const wordsPerPixel = g.unary('words-per-pixel', 'math.exp2.scalar', depth), interpretedWidth = g.binary('interpreted-width', 'math.divide-ieee.scalar', wordWidth, wordsPerPixel);
  const dimensions = g.node('interpreted-size', 'vector.combine.vec2'); g.edge(interpretedWidth, dimensions, 'x'); g.edge(rows, dimensions, 'y');
  const pixel = g.unary('memory-pixel', 'math.floor.vec2', g.binary('scaled-uv', 'math.multiply.vec2', uv, dimensions));
  const safeGain = g.binary('safe-float-gain', 'math.max.scalar', floatGain, tiny), decoded = g.node('decoded', 'data.decode-byte-pixel');
  g.edge(memory, decoded, 'memory'); g.edge(pixel, decoded, 'pixel'); g.edge(depth, decoded, 'depth'); g.edge(floatMode, decoded, 'floatMode'); g.edge(safeGain, decoded, 'floatGain');
  const decodedParts = g.node('decoded-parts', 'vector.split.vec4', 'x'); g.edge(decoded, decodedParts, 'value');
  const alpha = g.node('decoded-alpha', 'select.scalar'); g.edge({ node: decodedParts.node, port: 'w' }, alpha, 'falseValue'); g.edge(one, alpha, 'trueValue'); g.edge(opaque, alpha, 'condition');
  const decodedOpaque = g.node('decoded-opaque', 'vector.combine.vec4');
  for (const component of ['x', 'y', 'z'] as const) g.edge({ node: decodedParts.node, port: component }, decodedOpaque, component); g.edge(alpha, decodedOpaque, 'w');
  const sourceValue = g.unary('source-value', 'convert.image-to-vec4', frame, 'image'), mixClamp = g.node('mix-clamp', 'math.clamp.scalar');
  g.edge(mix, mixClamp, 'value'); g.edge(zero, mixClamp, 'min'); g.edge(one, mixClamp, 'max');
  const mixed = g.node('mixed', 'math.mix.vec4'); g.edge(sourceValue, mixed, 'a'); g.edge(decodedOpaque, mixed, 'b'); g.edge(mixClamp, mixed, 't');
  const mixedImage = g.unary('mixed-image', 'convert.vec4-to-image', mixed, 'value', 'image'), hasMemory = g.node('has-memory', 'compare.greater.scalar', 'condition');
  g.edge(available, hasMemory, 'a'); g.edge(half, hasMemory, 'b');
  const selected = g.node('selected', 'control.select.image', 'image'); g.edge(hasMemory, selected, 'condition'); g.edge(frame, selected, 'falseValue'); g.edge(mixedImage, selected, 'trueValue');
  const output = g.node('output', 'image.output', ''); g.edge(selected, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
