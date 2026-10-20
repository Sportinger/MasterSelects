import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/** A node output: a node id (output `value`) or `[nodeId, outputPort]`. */
export type GraphPort = string | readonly [string, string];

/** Small recipe builder for the blur graphs: nodes and explicitly named edges, nothing implicit. */
export class BlurGraphBuilder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];

  add(id: string, operator: string, inputs: Record<string, GraphPort> = {}, extra: Pick<BoundOperatorNode, 'bindings' | 'constants'> = { bindings: {} }): string {
    if (this.nodes.some(node => node.id === id)) throw new Error(`Duplicate blur graph node ${id}.`);
    this.nodes.push({ id, operator, operatorVersion: 1, bindings: extra.bindings, ...(extra.constants ? { constants: extra.constants } : {}) });
    for (const [input, port] of Object.entries(inputs)) this.link(port, id, input);
    return id;
  }

  number(id: string, value: number): string { return this.add(id, 'values.number', {}, { bindings: {}, constants: { value } }); }
  bound(id: string, parameter: string, operator = 'values.number'): string { return this.add(id, operator, {}, { bindings: { value: parameter } }); }
  binary(id: string, operator: string, a: GraphPort, b: GraphPort): string { return this.add(id, operator, { a, b }); }
  unary(id: string, operator: string, value: GraphPort): string { return this.add(id, operator, { value }); }

  link(from: GraphPort, to: string, input: string): void {
    const [source, output] = typeof from === 'string' ? [from, 'value'] : from;
    this.edges.push({ id: `${source}-${output}-${to}-${input}`, from: source, output, to, input });
  }

  graph(columns = 8): EffectOperatorGraph {
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: this.nodes, edges: this.edges,
      layout: Object.fromEntries(this.nodes.map((item, index) => [item.id, { x: (index % columns) * 280, y: Math.floor(index / columns) * 360 }])) };
  }
}

/** Straight RGBA sample → (rgb * alpha, alpha), so averages are not darkened by transparent texels. */
export function premultiplyNodes(g: BlurGraphBuilder, prefix: string, sample: GraphPort): GraphPort {
  const split = g.add(`${prefix}-split`, 'vector.split.rgba', { image: sample });
  const alpha = g.add(`${prefix}-alpha`, 'convert.alpha-to-scalar', { alpha: [split, 'alpha'] });
  const rgb = g.add(`${prefix}-rgb`, 'math.multiply.rgb-scalar', { a: [split, 'rgb'], b: alpha });
  return [g.add(prefix, 'vector.combine.rgba', { rgb, alpha: [split, 'alpha'] }), 'image'];
}

/** Weighted sum → average image (weight sums are always positive in the blur recipes). */
export function normalizeNodes(g: BlurGraphBuilder, prefix: string, reduce: string): GraphPort {
  const weight = g.add(`${prefix}-weight-vec4`, 'convert.scalar-to-vec4', { value: [reduce, 'weightSum'] });
  const average = g.add(`${prefix}-average`, 'math.divide-ieee.vec4', { a: [reduce, 'sum'], b: weight });
  return [g.add(`${prefix}-image`, 'convert.vec4-to-image', { value: average }), 'image'];
}

/** Premultiplied average → straight RGBA output; fully transparent results stay black. */
export function unpremultiplyNodes(g: BlurGraphBuilder, image: GraphPort): void {
  const split = g.add('result-split', 'vector.split.rgba', { image });
  const alpha = g.add('result-alpha', 'convert.alpha-to-scalar', { alpha: [split, 'alpha'] });
  const floor = g.number('coverage-floor', 1e-6);
  const safe = g.binary('result-safe-alpha', 'math.max.scalar', alpha, floor);
  const rgb = g.add('result-rgb', 'math.divide-ieee.rgb-scalar', { a: [split, 'rgb'], b: safe });
  const result = g.add('result', 'vector.combine.rgba', { rgb, alpha: [split, 'alpha'] });
  g.add('output', 'image.output', { image: [result, 'image'] });
}
