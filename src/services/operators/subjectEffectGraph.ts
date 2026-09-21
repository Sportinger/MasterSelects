import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };

class SubjectGraphBuilder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};

  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    const index = this.nodes.length - 1;
    this.layout[id] = { x: (index % 10) * 280, y: Math.floor(index / 10) * 210 };
    return { node: id, port };
  }

  number(id: string, value: number): Ref { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string): void {
    this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input });
  }
  unary(id: string, operator: string, value: Ref, input = 'value'): Ref {
    const result = this.node(id, operator); this.edge(value, result, input); return result;
  }
  binary(id: string, operator: string, a: Ref, b: Ref): Ref {
    const result = this.node(id, operator); this.edge(a, result, 'a'); this.edge(b, result, 'b'); return result;
  }
}

/** Granular equivalent of subjectFragment; landmark selection remains a typed runtime source. */
export function createDefaultSubjectGraph(): EffectOperatorGraph {
  const g = new SubjectGraphBuilder();
  const frame = g.node('frame', 'image.frame', 'image');
  const uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution');
  const tracking = g.node('tracking', 'source.tracking-landmarks', 'landmarks', {}, { policy: 'pose-first-face' });
  const metadata = { node: tracking.node, port: 'metadata' };
  const metadataParts = g.node('metadata-parts', 'vector.split.vec4', 'x'); g.edge(metadata, metadataParts, 'value');
  const count = { node: metadataParts.node, port: 'x' };
  const centerX = { node: metadataParts.node, port: 'y' }, centerY = { node: metadataParts.node, port: 'z' };
  const spread = { node: metadataParts.node, port: 'w' };

  const one = g.number('one', 1), half = g.number('half', .5);
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999);
  const minUv = g.unary('minimum-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('maximum-uv', 'convert.scalar-to-vec2', almost);
  const clampedUv = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(uv, clampedUv, 'value'); g.edge(minUv, clampedUv, 'min'); g.edge(maxUv, clampedUv, 'max');
  const source = g.node('source', 'image.sample', 'image'); g.edge(frame, source, 'image'); g.edge(clampedUv, source, 'uv');

  const center = g.node('tracking-center', 'vector.combine.vec2'); g.edge(centerX, center, 'x'); g.edge(centerY, center, 'y');
  const centeredUv = g.binary('centered-uv', 'math.subtract.vec2', uv, center);
  const resolutionParts = g.node('resolution-parts', 'vector.split.vec2', 'x'); g.edge(resolution, resolutionParts, 'value');
  const safeHeight = g.binary('safe-height', 'math.max.scalar', one, { node: resolutionParts.node, port: 'y' });
  const aspect = g.binary('aspect', 'math.divide-ieee.scalar', { node: resolutionParts.node, port: 'x' }, safeHeight);
  const aspectVector = g.node('aspect-vector', 'vector.combine.vec2'); g.edge(aspect, aspectVector, 'x'); g.edge(one, aspectVector, 'y');
  const centered = g.binary('aspect-centered-uv', 'math.multiply.vec2', centeredUv, aspectVector);
  const centerDistance = g.unary('center-distance', 'vector.length.vec2', centered);

  const radiusScale = g.number('radius-scale', .8), minimumRadius = g.number('minimum-radius', .035);
  const radius = g.binary('radius', 'math.max.scalar', minimumRadius, g.binary('spread-radius', 'math.multiply.scalar', spread, radiusScale));
  const field = g.node('landmark-field', 'tracking.landmark-field.scalar');
  g.edge({ node: tracking.node, port: 'landmarks' }, field, 'landmarks'); g.edge(uv, field, 'uv'); g.edge(radius, field, 'radius'); g.edge(resolution, field, 'resolution');

  const inner = g.binary('fallback-inner', 'math.multiply.scalar', spread, g.number('fallback-inner-scale', 1.4));
  const outer = g.binary('fallback-outer', 'math.multiply.scalar', spread, g.number('fallback-outer-scale', 2.8));
  const falloff = g.node('fallback-smoothstep', 'math.smoothstep.scalar'); g.edge(inner, falloff, 'edge0'); g.edge(outer, falloff, 'edge1'); g.edge(centerDistance, falloff, 'value');
  const noLandmarks = g.node('empty-landmark-step', 'math.step.scalar'); g.edge(count, noLandmarks, 'edge'); g.edge(half, noLandmarks, 'value');
  // Preserve legacy grouping exactly: 1 - (smoothstep * step(count, .5)).
  const gatedFalloff = g.binary('fallback-gated-falloff', 'math.multiply.scalar', falloff, noLandmarks);
  const fallback = g.binary('fallback-focus', 'math.subtract.scalar', one, gatedFalloff);
  const focus = g.binary('focus', 'math.max.scalar', field, fallback);

  const sourceValue = g.node('source-value', 'convert.image-to-vec4'); g.edge(source, sourceValue, 'image');
  const sourceParts = g.node('source-parts', 'vector.split.vec4', 'x'); g.edge(sourceValue, sourceParts, 'value');
  const rgb = g.node('source-rgb', 'vector.combine.vec3');
  for (const component of ['x', 'y', 'z'] as const) g.edge({ node: sourceParts.node, port: component }, rgb, component);
  const sourceRgb = g.node('source-rgb-color', 'convert.vec3-to-rgb', 'rgb'); g.edge(rgb, sourceRgb, 'value');
  const rgbGain = g.binary('rgb-gain', 'math.add.scalar', g.number('base-gain', .75), g.binary('focus-gain', 'math.multiply.scalar', focus, g.number('focus-gain-scale', .35)));
  const isolatedRgb = g.node('isolated-rgb', 'math.multiply.rgb-scalar', 'value'); g.edge(sourceRgb, isolatedRgb, 'a'); g.edge(rgbGain, isolatedRgb, 'b');
  const alphaMax = g.binary('alpha-max', 'math.max.scalar', focus, { node: sourceParts.node, port: 'w' });
  const isolatedAlpha = g.binary('isolated-alpha', 'math.multiply.scalar', { node: sourceParts.node, port: 'w' }, alphaMax);
  const isolatedRgbVector = g.node('isolated-rgb-vector', 'convert.rgb-to-vec3'); g.edge(isolatedRgb, isolatedRgbVector, 'rgb');
  const isolatedParts = g.node('isolated-rgb-parts', 'vector.split.vec3', 'x'); g.edge(isolatedRgbVector, isolatedParts, 'value');
  const isolated = g.node('isolated', 'vector.combine.vec4');
  for (const component of ['x', 'y', 'z'] as const) g.edge({ node: isolatedParts.node, port: component }, isolated, component);
  g.edge(isolatedAlpha, isolated, 'w');
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const mixed = g.node('mixed', 'math.mix.vec4'); g.edge(sourceValue, mixed, 'a'); g.edge(isolated, mixed, 'b'); g.edge(amount, mixed, 't');
  const image = g.node('mixed-image', 'convert.vec4-to-image', 'image'); g.edge(mixed, image, 'value');
  const output = g.node('output', 'image.output', ''); g.edge(image, output, 'image');

  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
