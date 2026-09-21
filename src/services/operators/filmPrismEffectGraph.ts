import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };
class Builder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 12) * 300, y: Math.floor(this.nodes.length / 12) * 220 };
    return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator, 'value'); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator, 'value'); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  vec2(id: string, x: Ref, y: Ref) { const out = this.node(id, 'vector.combine.vec2', 'value'); this.edge(x, out, 'x'); this.edge(y, out, 'y'); return out; }
}

/** Exact generic expansion of the shared common.wgsl noise2d helper. */
function noise2d(g: Builder, p: Ref, zero: Ref, one: Ref, two: Ref, three: Ref): Ref {
  const i = g.unary('noise-cell', 'math.floor.vec2', p), f = g.unary('noise-fract', 'math.fract.vec2', p);
  const f2 = g.binary('noise-fract-squared', 'math.multiply.vec2', f, f), two2 = g.unary('noise-two-vec2', 'convert.scalar-to-vec2', two);
  const three2 = g.unary('noise-three-vec2', 'convert.scalar-to-vec2', three), twiceF = g.binary('noise-twice-fract', 'math.multiply.vec2', two2, f);
  const fadeBase = g.binary('noise-fade-base', 'math.subtract.vec2', three2, twiceF), fade = g.binary('noise-fade', 'math.multiply.vec2', f2, fadeBase);
  const fadeSplit = g.node('noise-fade-split', 'vector.split.vec2', 'x'); g.edge(fade, fadeSplit, 'value');
  const ux = { node: fadeSplit.node, port: 'x' }, uy = { node: fadeSplit.node, port: 'y' };
  const offset = (id: string, x: Ref, y: Ref) => g.binary(id, 'math.add.vec2', i, g.vec2(`${id}-offset`, x, y));
  const hash = (id: string, value: Ref) => g.unary(id, 'noise.hash2d.vec2', value);
  const h00 = hash('noise-h00', offset('noise-p00', zero, zero)), h10 = hash('noise-h10', offset('noise-p10', one, zero));
  const h01 = hash('noise-h01', offset('noise-p01', zero, one)), h11 = hash('noise-h11', offset('noise-p11', one, one));
  const mix = (id: string, a: Ref, b: Ref, t: Ref) => { const out = g.node(id, 'math.mix.scalar', 'value'); g.edge(a, out, 'a'); g.edge(b, out, 'b'); g.edge(t, out, 't'); return out; };
  return mix('noise-result', mix('noise-row-zero', h00, h10, ux), mix('noise-row-one', h01, h11, ux), uy);
}

/** Granular equivalent of filmPrismFragment; parameter schema stays catalog-owned. */
export function createDefaultFilmPrismGraph(): EffectOperatorGraph {
  const g = new Builder();
  const frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution', 'value'), time = g.node('time', 'image.timeline-time', 'value');
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), three = g.number('three', 3), half = g.number('half', .5);
  const radialBase = g.number('radial-base', .012), radialWaveScale = g.number('radial-wave-scale', .005), grainScale = g.number('grain-scale', .035);
  const tiny = g.number('tiny', .001), almostOne = g.number('almost-one', .999);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), center = g.binary('center', 'math.subtract.vec2', uv, half2);
  const centerAmount = g.binary('center-amount', 'math.multiply.vec2-scalar', center, amount), timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed);
  const radialSine = g.unary('radial-sine', 'math.sin.scalar', timeSpeed), radialWave = g.binary('radial-wave', 'math.multiply.scalar', radialWaveScale, radialSine);
  const radialFactor = g.binary('radial-factor', 'math.add.scalar', radialBase, radialWave), radial = g.binary('radial', 'math.multiply.vec2-scalar', centerAmount, radialFactor);

  const pixelUv = g.binary('pixel-uv', 'math.multiply.vec2', uv, resolution), time2 = g.unary('time-vec2', 'convert.scalar-to-vec2', time);
  const noiseUv = g.binary('noise-uv', 'math.add.vec2', pixelUv, time2), noise = noise2d(g, noiseUv, zero, one, two, three);
  const centeredNoise = g.binary('centered-noise', 'math.subtract.scalar', noise, half), grain = g.binary('grain', 'math.multiply.scalar', centeredNoise, grainScale);
  const plusUv = g.binary('plus-uv', 'math.add.vec2', uv, radial), minusUv = g.binary('minus-uv', 'math.subtract.vec2', uv, radial);
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almostOne);
  const sample = (id: string, coords: Ref) => {
    const clamped = g.node(`${id}-clamped-uv`, 'math.clamp.vec2', 'value'); g.edge(coords, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
    const out = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(frame, out, 'image'); g.edge(clamped, out, 'uv'); return out;
  };
  const redSample = sample('red', plusUv), greenSample = sample('green', uv), blueSample = sample('blue', minusUv), alphaSample = sample('alpha', uv);
  const components = (id: string, image: Ref) => {
    const split = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(image, split, 'image');
    const vector = g.node(`${id}-vector`, 'convert.rgb-to-vec3', 'value'); g.edge({ node: split.node, port: 'rgb' }, vector, 'rgb');
    const channels = g.node(`${id}-components`, 'vector.split.vec3', 'x'); g.edge(vector, channels, 'value'); return { split, channels };
  };
  const red = components('red', redSample), green = components('green', greenSample), blue = components('blue', blueSample);
  const alpha = g.node('alpha-split', 'vector.split.rgba', 'rgb'); g.edge(alphaSample, alpha, 'image');
  const redGrain = g.binary('red-grain', 'math.add.scalar', { node: red.channels.node, port: 'x' }, grain);
  const greenGrain = g.binary('green-grain', 'math.add.scalar', { node: green.channels.node, port: 'y' }, grain);
  const blueGrain = g.binary('blue-grain', 'math.add.scalar', { node: blue.channels.node, port: 'z' }, grain);
  const channels = g.node('channels', 'vector.combine.vec3', 'value'); g.edge(redGrain, channels, 'x'); g.edge(greenGrain, channels, 'y'); g.edge(blueGrain, channels, 'z');
  const color = g.node('color', 'convert.vec3-to-rgb', 'rgb'); g.edge(channels, color, 'value');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(color, combine, 'rgb'); g.edge({ node: alpha.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
