import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
type Ref = { node: string; port: string };
class Builder {
  nodes: BoundOperatorNode[] = []; edges: OperatorEdge[] = []; layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref { this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) }); this.layout[id] = { x: (this.nodes.length % 9) * 340, y: Math.floor(this.nodes.length / 9) * 360 }; return { node: id, port }; }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${from.port}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref) { const out = this.node(id, operator); this.edge(value, out, 'value'); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
}
export function createDefaultToneGeometryGraph(): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv'), resolution = g.node('resolution', 'image.resolution');
  const time = g.node('time', 'image.timeline-time'), speed = g.node('speed', 'values.number', 'value', { value: 'speed' }), angle = g.node('angle', 'values.number', 'value', { value: 'angle' });
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const zero = g.number('zero', 0), one = g.number('one', 1), half = g.number('half', .5), three = g.number('three', 3);
  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed), wave = g.unary('wave', 'math.sin.scalar', timeSpeed), driftScale = g.number('drift-scale', .002), drift = g.binary('drift', 'math.multiply.scalar', wave, driftScale);
  const zeroDrift = g.node('drift-vec2', 'vector.combine.vec2'); g.edge(drift, zeroDrift, 'x'); g.edge(zero, zeroDrift, 'y'); const shifted = g.binary('shifted-uv', 'math.add.vec2', uv, zeroDrift);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), centered = g.binary('centered', 'math.subtract.vec2', shifted, half2), radians = g.unary('radians', 'convert.degrees-to-radians.scalar', angle);
  const rotated = g.node('rotated', 'coordinates.rotate.vec2'); g.edge(centered, rotated, 'value'); g.edge(radians, rotated, 'angle'); const rotatedUv = g.binary('rotated-uv', 'math.add.vec2', rotated, half2);
  const safeScale = g.binary('safe-scale', 'math.max.scalar', scale, three), scale2 = g.unary('scale-vec2', 'convert.scalar-to-vec2', safeScale);
  const cells = g.binary('cells', 'math.divide-ieee.vec2', g.binary('pixels', 'math.multiply.vec2', rotatedUv, resolution), scale2);
  const cell = g.binary('cell', 'math.subtract.vec2', g.unary('cell-fract', 'math.fract.vec2', cells), half2), splitCell = g.node('cell-split', 'vector.split.vec2'); g.edge(cell, splitCell, 'value');
  const x = { node: splitCell.node, port: 'x' }, y = { node: splitCell.node, port: 'y' }, absX = g.unary('abs-x', 'math.abs.scalar', x), absY = g.unary('abs-y', 'math.abs.scalar', y);
  const square = g.binary('square-distance', 'math.max.scalar', absX, absY), circle = g.unary('circle-distance', 'vector.length.vec2', cell);
  const triangleY = g.binary('triangle-y-scale', 'math.multiply.scalar', y, g.number('triangle-y-factor', .75));
  const triangle = g.binary('triangle-distance', 'math.max.scalar', absX, g.binary('triangle-y', 'math.subtract.scalar', triangleY, g.number('triangle-offset', .15)));
  const shape = g.node('shape', 'values.choice', 'value', { value: 'shape' }), halfChoice = g.number('shape-half', .5), oneHalf = g.number('shape-one-half', 1.5);
  const circleCondition = g.node('use-circle', 'compare.greater.scalar', 'condition'); g.edge(shape, circleCondition, 'a'); g.edge(halfChoice, circleCondition, 'b');
  const first = g.node('first-shape', 'select.scalar'); g.edge(square, first, 'falseValue'); g.edge(circle, first, 'trueValue'); g.edge(circleCondition, first, 'condition');
  const triangleCondition = g.node('use-triangle', 'compare.greater.scalar', 'condition'); g.edge(shape, triangleCondition, 'a'); g.edge(oneHalf, triangleCondition, 'b');
  const distance = g.node('distance', 'select.scalar'); g.edge(first, distance, 'falseValue'); g.edge(triangle, distance, 'trueValue'); g.edge(triangleCondition, distance, 'condition');
  const tiny = g.number('tiny', .001), almost = g.number('almost', .999), min2 = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), max2 = g.unary('max-uv', 'convert.scalar-to-vec2', almost), clamped = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(uv, clamped, 'value'); g.edge(min2, clamped, 'min'); g.edge(max2, clamped, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clamped, sample, 'uv'); const sampleSplit = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, sampleSplit, 'image');
  const rgb = { node: sampleSplit.node, port: 'rgb' }, tone = g.node('tone', 'color.luminance-rec709.rgb'); g.edge(rgb, tone, 'rgb'); const size = g.binary('size', 'math.multiply.scalar', g.binary('inverse-tone', 'math.subtract.scalar', one, tone), g.number('size-factor', .65));
  const low = g.binary('edge-low', 'math.subtract.scalar', size, g.number('edge-width', .04)), high = g.binary('edge-high', 'math.add.scalar', size, g.number('edge-width-high', .04)), edgeNode = g.node('edge', 'math.smoothstep.scalar'); g.edge(low, edgeNode, 'edge0'); g.edge(high, edgeNode, 'edge1'); g.edge(distance, edgeNode, 'value'); const mark = g.binary('mark', 'math.subtract.scalar', one, edgeNode);
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'), bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value'); g.edge(colorB, bRgb, 'value'); const ink = g.node('ink', 'math.mix.rgb'); g.edge(bRgb, ink, 'a'); g.edge(aRgb, ink, 'b'); g.edge(mark, ink, 't'); const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(rgb, mixed, 'a'); g.edge(ink, mixed, 'b'); g.edge(amount, mixed, 't'); const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sampleSplit.node, port: 'alpha' }, combine, 'alpha'); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
