import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };
class Builder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 11) * 300, y: Math.floor(this.nodes.length / 11) * 220 };
    return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator, 'value'); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator, 'value'); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  vec2(id: string, x: Ref, y: Ref) { const out = this.node(id, 'vector.combine.vec2', 'value'); this.edge(x, out, 'x'); this.edge(y, out, 'y'); return out; }
}

/** Granular equivalent of crystalFragment. Requires generic vector.normalize.vec2 lowering. */
export function createDefaultCrystalGraph(): EffectOperatorGraph {
  const g = new Builder();
  const frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const time = g.node('time', 'image.timeline-time', 'value'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
  const four = g.number('four', 4), half = g.number('half', .5), thirteenSeven = g.number('thirteen-seven', 13.7);
  const tiny = g.number('tiny', .001), refractionScale = g.number('refraction-scale', .08), shimmerScale = g.number('shimmer-scale', .003);
  const tau = g.number('tau', Math.PI * 2), clampMin = g.number('clamp-min', .001), clampMax = g.number('clamp-max', .999);
  const cells = g.node('cells', 'math.max.scalar', 'value'); g.edge(scale, cells, 'a'); g.edge(four, cells, 'b');
  const gridUv = g.binary('grid-uv', 'math.multiply.vec2-scalar', uv, cells), id = g.unary('cell-id', 'math.floor.vec2', gridUv);
  const fraction = g.unary('cell-fract', 'math.fract.vec2', gridUv), half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half);
  const local = g.binary('local', 'math.subtract.vec2', fraction, half2), hashX = g.unary('facet-hash-x', 'noise.hash2d.vec2', id);
  const thirteen2 = g.unary('thirteen-seven-vec2', 'convert.scalar-to-vec2', thirteenSeven), shiftedId = g.binary('shifted-id', 'math.add.vec2', id, thirteen2);
  const hashY = g.unary('facet-hash-y', 'noise.hash2d.vec2', shiftedId), facetX = g.binary('facet-x', 'math.subtract.scalar', hashX, half);
  const facetY = g.binary('facet-y', 'math.subtract.scalar', hashY, half), facetRaw = g.vec2('facet-raw', facetX, facetY);
  const tiny2 = g.unary('tiny-vec2', 'convert.scalar-to-vec2', tiny), facetBiased = g.binary('facet-biased', 'math.add.vec2', facetRaw, tiny2);
  const facet = g.unary('facet', 'vector.normalize.vec2', facetBiased), projection = g.node('projection', 'vector.dot.vec2', 'value');
  g.edge(local, projection, 'a'); g.edge(facet, projection, 'b');
  const projectedFacet = g.binary('projected-facet', 'math.multiply.vec2-scalar', facet, projection);
  const amountFacet = g.binary('amount-facet', 'math.multiply.vec2-scalar', projectedFacet, amount);
  const refraction = g.binary('refraction', 'math.multiply.vec2-scalar', amountFacet, refractionScale);
  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed), hashAngle = g.binary('hash-angle', 'math.multiply.scalar', hashX, tau);
  const shimmerPhase = g.binary('shimmer-phase', 'math.add.scalar', timeSpeed, hashAngle), shimmerWave = g.unary('shimmer-wave', 'math.sin.scalar', shimmerPhase);
  const shimmer = g.binary('shimmer', 'math.multiply.scalar', shimmerWave, shimmerScale), refractedUv = g.binary('refracted-uv', 'math.add.vec2', uv, refraction);
  const shimmer2 = g.unary('shimmer-vec2', 'convert.scalar-to-vec2', shimmer), sampleUv = g.binary('sample-uv', 'math.add.vec2', refractedUv, shimmer2);
  const min2 = g.unary('clamp-min-vec2', 'convert.scalar-to-vec2', clampMin), max2 = g.unary('clamp-max-vec2', 'convert.scalar-to-vec2', clampMax);
  const clamped = g.node('clamped-uv', 'math.clamp.vec2', 'value'); g.edge(sampleUv, clamped, 'value'); g.edge(min2, clamped, 'min'); g.edge(max2, clamped, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clamped, sample, 'uv');
  const output = g.node('output', 'image.output', ''); g.edge(sample, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
