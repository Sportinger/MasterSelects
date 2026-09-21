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
  literal(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator, 'value'); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator, 'value'); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
}

/** Granular equivalent of the catalog ribbonScanFragment; schema remains effect-owned. */
export function createDefaultRibbonScanGraph(): EffectOperatorGraph {
  const g = new Builder();
  const frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const splitUv = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, splitUv, 'value');
  const y = { node: splitUv.node, port: 'y' }, time = g.node('time', 'image.timeline-time', 'value');
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
  const zero = g.literal('zero', 0), one = g.literal('one', 1), three = g.literal('three', 3), pointEighteen = g.literal('point-eighteen', .18);
  const pointSixtyTwo = g.literal('point-sixty-two', .62), pointZeroEight = g.literal('point-zero-eight', .08), tau = g.literal('tau', Math.PI * 2);
  const tiny = g.literal('tiny', .001), almostOne = g.literal('almost-one', .999);
  const safeScale = g.node('safe-scale', 'math.max.scalar', 'value'); g.edge(scale, safeScale, 'a'); g.edge(three, safeScale, 'b');
  const yScale = g.binary('y-scale', 'math.multiply.scalar', y, safeScale), timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed);
  const phaseBase = g.binary('phase-base', 'math.subtract.scalar', yScale, timeSpeed), phase = g.unary('phase', 'math.fract.scalar', phaseBase);
  const rise = g.node('ribbon-rise', 'math.smoothstep.scalar', 'value'); g.edge(zero, rise, 'edge0'); g.edge(pointEighteen, rise, 'edge1'); g.edge(phase, rise, 'value');
  const fallStep = g.node('ribbon-fall-step', 'math.smoothstep.scalar', 'value'); g.edge(pointSixtyTwo, fallStep, 'edge0'); g.edge(one, fallStep, 'edge1'); g.edge(phase, fallStep, 'value');
  const fall = g.binary('ribbon-fall', 'math.subtract.scalar', one, fallStep), ribbon = g.binary('ribbon', 'math.multiply.scalar', rise, fall);
  const angle = g.binary('shift-angle', 'math.multiply.scalar', phase, tau), wave = g.unary('shift-wave', 'math.sin.scalar', angle);
  const waveAmount = g.binary('shift-amount', 'math.multiply.scalar', wave, amount), shiftScale = g.binary('shift-scale', 'math.multiply.scalar', waveAmount, pointZeroEight);
  const shift = g.binary('shift', 'math.multiply.scalar', shiftScale, ribbon), offset = g.node('offset', 'vector.combine.vec2', 'value');
  g.edge(shift, offset, 'x'); g.edge(zero, offset, 'y');
  const shiftedUv = g.binary('shifted-uv', 'math.add.vec2', uv, offset), minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny);
  const maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almostOne);
  const clamp = (id: string, value: Ref) => { const out = g.node(id, 'math.clamp.vec2', 'value'); g.edge(value, out, 'value'); g.edge(minUv, out, 'min'); g.edge(maxUv, out, 'max'); return out; };
  const originalSample = g.node('original-sample', 'image.sample', 'image'); g.edge(frame, originalSample, 'image'); g.edge(clamp('original-uv', uv), originalSample, 'uv');
  const shiftedSample = g.node('shifted-sample', 'image.sample', 'image'); g.edge(frame, shiftedSample, 'image'); g.edge(clamp('clamped-shifted-uv', shiftedUv), shiftedSample, 'uv');
  const original = g.node('original-split', 'vector.split.rgba', 'rgb'); g.edge(originalSample, original, 'image');
  const shifted = g.node('shifted-split', 'vector.split.rgba', 'rgb'); g.edge(shiftedSample, shifted, 'image');
  const mixed = g.node('mixed-color', 'math.mix.rgb', 'value'); g.edge({ node: original.node, port: 'rgb' }, mixed, 'a');
  g.edge({ node: shifted.node, port: 'rgb' }, mixed, 'b'); g.edge(ribbon, mixed, 't');
  const combined = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combined, 'rgb'); g.edge({ node: shifted.node, port: 'alpha' }, combined, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
