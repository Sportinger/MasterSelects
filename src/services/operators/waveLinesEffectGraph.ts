import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };
class Builder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 10) * 300, y: Math.floor(this.nodes.length / 10) * 220 };
    return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator, 'value'); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator, 'value'); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
}

/** Granular equivalent of waveLinesFragment. Parameter schema and color normalization remain catalog-owned. */
export function createDefaultWaveLinesGraph(): EffectOperatorGraph {
  const g = new Builder();
  const frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const uvSplit = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, uvSplit, 'value');
  const ux = { node: uvSplit.node, port: 'x' }, uy = { node: uvSplit.node, port: 'y' };
  const time = g.node('time', 'image.timeline-time', 'value'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const zeroFive = g.number('point-zero-five', .05), pointTwo = g.number('point-two', .2), half = g.number('half', .5);
  const one = g.number('one', 1), three = g.number('three', 3), tau = g.number('tau', Math.PI * 2), tiny = g.number('tiny', .001), almostOne = g.number('almost-one', .999);
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almostOne);
  const clampedUv = g.node('clamped-uv', 'math.clamp.vec2', 'value'); g.edge(uv, clampedUv, 'value'); g.edge(minUv, clampedUv, 'min'); g.edge(maxUv, clampedUv, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clampedUv, sample, 'uv');
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
  const rgb = { node: split.node, port: 'rgb' }, alpha = { node: split.node, port: 'alpha' };
  const tone = g.node('tone', 'color.luminance-rec709.rgb', 'value'); g.edge(rgb, tone, 'rgb');

  const safeScale = g.node('safe-scale', 'math.max.scalar', 'value'); g.edge(scale, safeScale, 'a'); g.edge(three, safeScale, 'b');
  const frequency = g.binary('frequency', 'math.multiply.scalar', safeScale, three);
  const xPhase = g.binary('x-phase', 'math.multiply.scalar', ux, frequency), timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed);
  const timePhase = g.binary('time-phase', 'math.multiply.scalar', timeSpeed, three), phaseXt = g.binary('phase-x-time', 'math.add.scalar', xPhase, timePhase);
  const tonePhase = g.binary('tone-phase', 'math.multiply.scalar', tone, tau), phase = g.binary('phase', 'math.add.scalar', phaseXt, tonePhase);
  const wave = g.unary('wave', 'math.sin.scalar', phase), waveAmount = g.binary('wave-amount', 'math.multiply.scalar', wave, amount);
  const yPhase = g.binary('y-phase', 'math.multiply.scalar', uy, frequency), linePhaseBase = g.binary('line-phase-base', 'math.add.scalar', yPhase, waveAmount);
  const linePhase = g.unary('line-phase', 'math.fract.scalar', linePhaseBase), centeredLine = g.binary('centered-line', 'math.subtract.scalar', linePhase, half);
  const distance = g.unary('line-distance', 'math.abs.scalar', centeredLine), edge = g.node('line-edge', 'math.smoothstep.scalar', 'value');
  g.edge(zeroFive, edge, 'edge0'); g.edge(pointTwo, edge, 'edge1'); g.edge(distance, edge, 'value');
  const line = g.binary('line', 'math.subtract.scalar', one, edge);
  const colorARgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, colorARgb, 'value');
  const colorBRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorB, colorBRgb, 'value');
  const spectrum = g.node('spectrum', 'math.mix.rgb', 'value'); g.edge(colorBRgb, spectrum, 'a'); g.edge(colorARgb, spectrum, 'b'); g.edge(line, spectrum, 't');
  const mixed = g.node('mixed-color', 'math.mix.rgb', 'value'); g.edge(rgb, mixed, 'a'); g.edge(spectrum, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge(alpha, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
