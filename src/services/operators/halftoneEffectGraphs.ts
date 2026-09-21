import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableHalftoneEffectType = 'halftone' | 'pattern-halftone';
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

/** Shared granular construction for the two catalog halftone shaders. */
export function createDefaultHalftoneGraph(type: EditableHalftoneEffectType): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), angle = g.node('angle', 'values.number', 'value', { value: 'angle' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), half = g.number('half', .5);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), centered = g.binary('centered-uv', 'math.subtract.vec2', uv, half2);
  const radians = g.unary('angle-radians', 'convert.degrees-to-radians.scalar', angle), rotated = g.node('rotated-center', 'coordinates.rotate.vec2');
  g.edge(centered, rotated, 'value'); g.edge(radians, rotated, 'angle');
  const rotatedUv = g.binary('rotated-uv', 'math.add.vec2', rotated, half2), scaledUv = g.binary('scaled-uv', 'math.multiply.vec2', rotatedUv, resolution);
  const safeScale = g.node('safe-scale', 'math.max.scalar'); g.edge(scale, safeScale, 'a'); g.edge(two, safeScale, 'b');
  const safeScale2 = g.unary('safe-scale-vec2', 'convert.scalar-to-vec2', safeScale), divided = g.binary('cell-divided', 'math.divide-ieee.vec2', scaledUv, safeScale2);
  const fract = g.unary('cell-fract', 'math.fract.vec2', divided), cell = g.binary('cell', 'math.subtract.vec2', fract, half2);
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny);
  const maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almost), clamped = g.node('clamped-uv', 'math.clamp.vec2');
  g.edge(uv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clamped, sample, 'uv');
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
  const rgb = { node: split.node, port: 'rgb' }, tone = g.node('tone', 'color.luminance-rec709.rgb'); g.edge(rgb, tone, 'rgb');
  const inverseTone = g.binary('inverse-tone', 'math.subtract.scalar', one, tone);
  let mark: Ref;
  if (type === 'halftone') {
    const nonnegative = g.node('nonnegative-tone', 'math.max.scalar'); g.edge(zero, nonnegative, 'a'); g.edge(inverseTone, nonnegative, 'b');
    const radiusRoot = g.unary('radius-root', 'math.sqrt.scalar', nonnegative), radiusScale = g.number('radius-scale', .68);
    const radius = g.binary('radius', 'math.multiply.scalar', radiusRoot, radiusScale), width = g.number('edge-width', .06);
    const low = g.binary('edge-low', 'math.subtract.scalar', radius, width), high = g.binary('edge-high', 'math.add.scalar', radius, width);
    const distance = g.unary('distance', 'vector.length.vec2', cell), edge = g.node('edge', 'math.smoothstep.scalar');
    g.edge(low, edge, 'edge0'); g.edge(high, edge, 'edge1'); g.edge(distance, edge, 'value'); mark = g.binary('mark', 'math.subtract.scalar', one, edge);
  } else {
    const radiusScale = g.number('radius-scale', .72), radius = g.binary('radius', 'math.multiply.scalar', inverseTone, radiusScale);
    const cellSplit = g.node('cell-split', 'vector.split.vec2', 'x'); g.edge(cell, cellSplit, 'value');
    const absX = g.unary('abs-x', 'math.abs.scalar', { node: cellSplit.node, port: 'x' }), absY = g.unary('abs-y', 'math.abs.scalar', { node: cellSplit.node, port: 'y' });
    const circle = g.unary('circle-distance', 'vector.length.vec2', cell), diamond = g.binary('diamond-distance', 'math.add.scalar', absX, absY);
    const shape = g.node('shape', 'values.choice', 'value', { value: 'shape' }), pointFive = g.number('point-five', .5), onePointFive = g.number('one-point-five', 1.5);
    const aboveHalf = g.node('shape-above-half', 'compare.greater.scalar', 'condition'); g.edge(shape, aboveHalf, 'a'); g.edge(pointFive, aboveHalf, 'b');
    const belowOneHalf = g.node('shape-below-one-half', 'compare.greater.scalar', 'condition'); g.edge(onePointFive, belowOneHalf, 'a'); g.edge(shape, belowOneHalf, 'b');
    const diamondCondition = g.node('shape-diamond', 'logic.and.boolean', 'value'); g.edge(aboveHalf, diamondCondition, 'a'); g.edge(belowOneHalf, diamondCondition, 'b');
    const diamondSelect = g.node('diamond-select', 'select.scalar'); g.edge(circle, diamondSelect, 'falseValue'); g.edge(diamond, diamondSelect, 'trueValue'); g.edge(diamondCondition, diamondSelect, 'condition');
    const lineCondition = g.node('shape-line', 'compare.greater.scalar', 'condition'); g.edge(shape, lineCondition, 'a'); g.edge(onePointFive, lineCondition, 'b');
    const distance = g.node('distance', 'select.scalar'); g.edge(diamondSelect, distance, 'falseValue'); g.edge(absY, distance, 'trueValue'); g.edge(lineCondition, distance, 'condition');
    const width = g.number('edge-width', .04), low = g.binary('edge-low', 'math.subtract.scalar', radius, width), high = g.binary('edge-high', 'math.add.scalar', radius, width);
    const edge = g.node('edge', 'math.smoothstep.scalar'); g.edge(low, edge, 'edge0'); g.edge(high, edge, 'edge1'); g.edge(distance, edge, 'value');
    mark = g.binary('mark', 'math.subtract.scalar', one, edge);
  }
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value');
  const bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorB, bRgb, 'value');
  const ink = g.node('ink-color', 'math.mix.rgb'); g.edge(bRgb, ink, 'a'); g.edge(aRgb, ink, 'b'); g.edge(mark, ink, 't');
  const mixed = g.node('mixed-color', 'math.mix.rgb'); g.edge(rgb, mixed, 'a'); g.edge(ink, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
