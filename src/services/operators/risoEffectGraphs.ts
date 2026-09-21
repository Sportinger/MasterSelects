import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

export type EditableRisoEffectType = 'riso' | 'riso-glow';
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

/** Shared granular construction of the legacy risoColor pipeline. */
export function createDefaultRisoGraph(type: EditableRisoEffectType): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution'), resolutionSplit = g.node('resolution-split', 'vector.split.vec2', 'x'); g.edge(resolution, resolutionSplit, 'value');
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const zero = g.number('zero', 0), one = g.number('one', 1), pointThreeFive = g.number('point-three-five', .35), pointThree = g.number('point-three', .3);
  const ratio = g.binary('scale-width', 'math.divide-ieee.scalar', scale, { node: resolutionSplit.node, port: 'x' });
  const offsetX = g.binary('offset-x', 'math.multiply.scalar', ratio, pointThreeFive), offset = g.node('offset', 'vector.combine.vec2');
  g.edge(offsetX, offset, 'x'); g.edge(zero, offset, 'y');
  const minusUv = g.binary('minus-uv', 'math.subtract.vec2', uv, offset), plusUv = g.binary('plus-uv', 'math.add.vec2', uv, offset);
  const tiny = g.number('tiny', .001), almost = g.number('almost-one', .999), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almost);
  const sample = (id: string, coords: Ref) => { const clamped = g.node(`${id}-clamped`, 'math.clamp.vec2'); g.edge(coords, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
    const result = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(frame, result, 'image'); g.edge(clamped, result, 'uv'); return result; };
  const original = sample('original', uv), left = sample('left', minusUv), right = sample('right', plusUv);
  const split = (id: string, image: Ref) => { const result = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(image, result, 'image'); return result; };
  const originalSplit = split('original', original), leftSplit = split('left', left), rightSplit = split('right', right);
  const luminance = (id: string, value: Ref) => { const result = g.node(id, 'color.luminance-rec709.rgb'); g.edge({ node: value.node, port: 'rgb' }, result, 'rgb'); return result; };
  const a = g.binary('a', 'math.subtract.scalar', one, luminance('left-luma', leftSplit)), b = g.binary('b', 'math.subtract.scalar', one, luminance('right-luma', rightSplit));
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value');
  const bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorB, bRgb, 'value');
  const oneRgb = g.node('one-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(one, oneRgb, 'value');
  const aInk = g.node('a-ink', 'math.multiply.rgb-scalar'); g.edge(aRgb, aInk, 'a'); g.edge(a, aInk, 'b');
  const bInk = g.node('b-ink', 'math.multiply.rgb-scalar'); g.edge(bRgb, bInk, 'a'); g.edge(b, bInk, 'b');
  const aRemaining = g.binary('a-remaining', 'math.subtract.rgb', oneRgb, aInk), bRemaining = g.binary('b-remaining', 'math.subtract.rgb', oneRgb, bInk);
  const paperVector = g.node('paper-vector', 'vector.combine.vec3'); g.edge(g.number('paper-r', .96), paperVector, 'x'); g.edge(g.number('paper-g', .93), paperVector, 'y'); g.edge(g.number('paper-b', .85), paperVector, 'z');
  const paper = g.node('paper', 'convert.vec3-to-rgb', 'rgb'); g.edge(paperVector, paper, 'value');
  const paperA = g.binary('paper-a', 'math.multiply.rgb', paper, aRemaining), subtractive = g.binary('subtractive', 'math.multiply.rgb', paperA, bRemaining);
  let glow = zero;
  if (type === 'riso-glow') {
    const time = g.node('time', 'image.timeline-time'), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
    const two = g.number('two', 2), phase = g.binary('pulse-time', 'math.multiply.scalar', time, speed), doubled = g.binary('pulse-phase', 'math.multiply.scalar', phase, two);
    const sine = g.unary('pulse-sine', 'math.sin.scalar', doubled), pointFourFive = g.number('point-four-five', .45), pointFiveFive = g.number('point-five-five', .55);
    glow = g.binary('pulse', 'math.add.scalar', pointFiveFive, g.binary('pulse-wave', 'math.multiply.scalar', sine, pointFourFive));
  }
  const inks = g.binary('inks', 'math.add.rgb', aInk, bInk), glowInks = g.node('glow-inks', 'math.multiply.rgb-scalar'); g.edge(inks, glowInks, 'a'); g.edge(glow, glowInks, 'b');
  const glowScaled = g.node('glow-scaled', 'math.multiply.rgb-scalar'); g.edge(glowInks, glowScaled, 'a'); g.edge(pointThree, glowScaled, 'b');
  const risoColor = g.binary('riso-color', 'math.add.rgb', subtractive, glowScaled), mixed = g.node('mixed-color', 'math.mix.rgb');
  g.edge({ node: originalSplit.node, port: 'rgb' }, mixed, 'a'); g.edge(risoColor, mixed, 'b'); g.edge(amount, mixed, 't');
  const combined = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combined, 'rgb'); g.edge({ node: originalSplit.node, port: 'alpha' }, combined, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
