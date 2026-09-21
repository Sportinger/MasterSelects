import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableDitherEffectType = 'dither' | 'dither-studio';
type Ref = { node: string; port: string };
class Builder {
  nodes: BoundOperatorNode[] = []; edges: OperatorEdge[] = []; layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 11) * 300, y: Math.floor(this.nodes.length / 11) * 220 }; return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
}

/** Shared granular construction for Dithering and Dither Studio. */
export function createDefaultDitherGraph(type: EditableDitherEffectType): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), zero = g.number('zero', 0), one = g.number('one', 1), half = g.number('half', .5);
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almost);
  const clampedUv = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(uv, clampedUv, 'value'); g.edge(minUv, clampedUv, 'min'); g.edge(maxUv, clampedUv, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clampedUv, sample, 'uv');
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image'); const rgb = { node: split.node, port: 'rgb' };
  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution);
  let threshold: Ref;
  if (type === 'dither') {
    const safeScale = g.node('safe-scale', 'math.max.scalar'); g.edge(scale, safeScale, 'a'); g.edge(one, safeScale, 'b');
    const scale2 = g.unary('scale-vec2', 'convert.scalar-to-vec2', safeScale), cells = g.binary('cells', 'math.divide-ieee.vec2', pixel, scale2);
    threshold = g.unary('threshold', 'pattern.bayer4.vec2', cells);
    const thresholdRgb = g.node('threshold-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(threshold, thresholdRgb, 'value');
    const halfRgb = g.node('half-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(half, halfRgb, 'value');
    const raised = g.binary('raised', 'math.add.rgb', rgb, thresholdRgb), centered = g.binary('centered', 'math.subtract.rgb', raised, halfRgb);
    const clamped = g.node('quantize-clamp', 'math.clamp.rgb-scalar'); g.edge(centered, clamped, 'value'); g.edge(zero, clamped, 'min'); g.edge(almost, clamped, 'max');
    const four = g.number('four', 4), three = g.number('three', 3), multiplied = g.node('quantize-four', 'math.multiply.rgb-scalar'); g.edge(clamped, multiplied, 'a'); g.edge(four, multiplied, 'b');
    const floored = g.unary('quantize-floor', 'math.floor.rgb', multiplied), quantized = g.node('quantized', 'math.divide-ieee.rgb-scalar'); g.edge(floored, quantized, 'a'); g.edge(three, quantized, 'b');
    const mixed = g.node('mixed-color', 'math.mix.rgb'); g.edge(rgb, mixed, 'a'); g.edge(quantized, mixed, 'b'); g.edge(amount, mixed, 't');
    const combined = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combined, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combined, 'alpha');
    const output = g.node('output', 'image.output', ''); g.edge(combined, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  const pointThreeFive = g.number('point-three-five', .35), scaled = g.binary('scaled', 'math.multiply.scalar', scale, pointThreeFive);
  const safeScale = g.node('safe-scale', 'math.max.scalar'); g.edge(scaled, safeScale, 'a'); g.edge(one, safeScale, 'b');
  const scale2 = g.unary('scale-vec2', 'convert.scalar-to-vec2', safeScale), cells = g.binary('cells', 'math.divide-ieee.vec2', pixel, scale2);
  const bayer4 = g.unary('bayer-four', 'pattern.bayer4.vec2', cells), flooredPixel = g.unary('pixel-floor', 'math.floor.vec2', pixel);
  const dotVector = g.node('dot-vector', 'vector.combine.vec2'); g.edge(half, dotVector, 'x'); g.edge(g.number('three-quarters', .75), dotVector, 'y');
  const dot = g.node('bayer-two-dot', 'vector.dot.vec2'); g.edge(flooredPixel, dot, 'a'); g.edge(dotVector, dot, 'b');
  const bayer2 = g.unary('bayer-two', 'math.fract.scalar', dot), uvSplit = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, uvSplit, 'value');
  const resolutionSplit = g.node('resolution-split', 'vector.split.vec2', 'x'); g.edge(resolution, resolutionSplit, 'value');
  const xPixel = g.binary('x-pixel', 'math.multiply.scalar', { node: uvSplit.node, port: 'x' }, { node: resolutionSplit.node, port: 'x' });
  const checkerRatio = g.binary('checker-ratio', 'math.divide-ieee.scalar', xPixel, scale), checkerFract = g.unary('checker-fract', 'math.fract.scalar', checkerRatio);
  const checkerCondition = g.node('checker-condition', 'compare.greater.scalar', 'condition'); g.edge(checkerFract, checkerCondition, 'a'); g.edge(half, checkerCondition, 'b');
  const checker = g.node('checker', 'select.scalar'); g.edge(g.number('quarter', .25), checker, 'falseValue'); g.edge(g.number('three-quarter', .75), checker, 'trueValue'); g.edge(checkerCondition, checker, 'condition');
  const kernel = g.node('kernel', 'values.choice', 'value', { value: 'kernel' }), pointFive = g.number('point-five', .5), onePointFive = g.number('one-point-five', 1.5);
  const useBayer2 = g.node('use-bayer-two', 'compare.greater.scalar', 'condition'); g.edge(pointFive, useBayer2, 'a'); g.edge(kernel, useBayer2, 'b');
  const first = g.node('kernel-first', 'select.scalar'); g.edge(bayer4, first, 'falseValue'); g.edge(bayer2, first, 'trueValue'); g.edge(useBayer2, first, 'condition');
  const useChecker = g.node('use-checker', 'compare.greater.scalar', 'condition'); g.edge(kernel, useChecker, 'a'); g.edge(onePointFive, useChecker, 'b');
  threshold = g.node('threshold', 'select.scalar'); g.edge(first, threshold, 'falseValue'); g.edge(checker, threshold, 'trueValue'); g.edge(useChecker, threshold, 'condition');
  const tone = g.node('tone', 'color.luminance-rec709.rgb'); g.edge(rgb, tone, 'rgb'); const bit = g.node('bit', 'math.step.scalar'); g.edge(threshold, bit, 'edge'); g.edge(tone, bit, 'value');
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value'); const bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorB, bRgb, 'value');
  const ink = g.node('ink', 'math.mix.rgb'); g.edge(aRgb, ink, 'a'); g.edge(bRgb, ink, 'b'); g.edge(bit, ink, 't');
  const mixed = g.node('mixed-color', 'math.mix.rgb'); g.edge(rgb, mixed, 'a'); g.edge(ink, mixed, 'b'); g.edge(amount, mixed, 't');
  const combined = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combined, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combined, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
