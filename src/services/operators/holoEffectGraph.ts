import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

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

/** Granular equivalent of holoFragment, retaining native automatic derivatives. */
export function createDefaultHoloGraph(): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const time = g.node('time', 'image.timeline-time'), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const pointZeroZeroOne = g.number('tiny', .001), pointNineNineNine = g.number('almost-one', .999);
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', pointZeroZeroOne), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', pointNineNineNine);
  const clamped = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(uv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
  const sample = g.node('sample', 'image.sample', 'image'); g.edge(frame, sample, 'image'); g.edge(clamped, sample, 'uv');
  const split = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
  const rgb = { node: split.node, port: 'rgb' }, uvSplit = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, uvSplit, 'value');
  const twelve = g.number('twelve', 12), nineteen = g.number('nineteen', 19), two = g.number('two', 2), pointThreeSeven = g.number('point-three-seven', .37);
  const xPhase = g.binary('x-phase', 'math.multiply.scalar', { node: uvSplit.node, port: 'x' }, twelve);
  const yPhase = g.binary('y-phase', 'math.multiply.scalar', { node: uvSplit.node, port: 'y' }, nineteen);
  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed), timePhase = g.binary('time-phase', 'math.multiply.scalar', timeSpeed, two);
  const xyPhase = g.binary('xy-phase', 'math.add.scalar', xPhase, yPhase), phase = g.binary('phase', 'math.add.scalar', xyPhase, timePhase);
  const innerAngle = g.binary('inner-angle', 'math.multiply.scalar', phase, pointThreeSeven), innerSine = g.unary('inner-sine', 'math.sin.scalar', innerAngle);
  const three = g.number('three', 3), modulation = g.binary('modulation', 'math.multiply.scalar', innerSine, three);
  const outerAngle = g.binary('outer-angle', 'math.add.scalar', phase, modulation), outerSine = g.unary('outer-sine', 'math.sin.scalar', outerAngle);
  const half = g.number('half', .5), halfWave = g.binary('half-wave', 'math.multiply.scalar', outerSine, half), interference = g.binary('interference', 'math.add.scalar', half, halfWave);
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value');
  const bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorB, bRgb, 'value');
  const spectrum = g.node('spectrum', 'math.mix.rgb'); g.edge(aRgb, spectrum, 'a'); g.edge(bRgb, spectrum, 'b'); g.edge(interference, spectrum, 't');
  const luma = g.node('luminance', 'color.luminance-rec709.rgb'); g.edge(rgb, luma, 'rgb');
  const derivative = g.node('luminance-derivative', 'image.derivative.auto.scalar', 'gradient'); g.edge(luma, derivative, 'value');
  const gradientLength = g.unary('gradient-length', 'vector.length.vec2', derivative), eight = g.number('eight', 8);
  const edge = g.binary('edge', 'math.multiply.scalar', gradientLength, eight), pointThree = g.number('point-three', .3);
  const spectrumGain = g.binary('spectrum-gain', 'math.add.scalar', pointThree, edge), spectrumScaled = g.node('spectrum-scaled', 'math.multiply.rgb-scalar');
  g.edge(spectrum, spectrumScaled, 'a'); g.edge(spectrumGain, spectrumScaled, 'b');
  const pointFiveFive = g.number('point-five-five', .55), colorScaled = g.node('color-scaled', 'math.multiply.rgb-scalar');
  g.edge(rgb, colorScaled, 'a'); g.edge(pointFiveFive, colorScaled, 'b');
  const hologram = g.binary('hologram', 'math.add.rgb', colorScaled, spectrumScaled), mixed = g.node('mixed-color', 'math.mix.rgb');
  g.edge(rgb, mixed, 'a'); g.edge(hologram, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
