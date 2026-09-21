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

/** Granular equivalent of glitchFragment using the same shared hash2d WGSL source. */
export function createDefaultGlitchGraph(): EffectOperatorGraph {
  const g = new Builder();
  const frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const uvSplit = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, uvSplit, 'value');
  const uy = { node: uvSplit.node, port: 'y' };
  const time = g.node('time', 'image.timeline-time', 'value'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
  const zero = g.number('zero', 0), four = g.number('four', 4), twelve = g.number('twelve', 12), three = g.number('three', 3);
  const threshold = g.number('threshold', .76), half = g.number('half', .5), shiftScale = g.number('shift-scale', .16);
  const channelScale = g.number('channel-scale', .004), tiny = g.number('tiny', .001), almostOne = g.number('almost-one', .999);

  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed), tickBase = g.binary('tick-base', 'math.multiply.scalar', timeSpeed, twelve);
  const tick = g.unary('tick', 'math.floor.scalar', tickBase), safeScale = g.node('safe-scale', 'math.max.scalar', 'value');
  g.edge(scale, safeScale, 'a'); g.edge(four, safeScale, 'b');
  const bandBase = g.binary('band-base', 'math.multiply.scalar', uy, safeScale), band = g.unary('band', 'math.floor.scalar', bandBase);
  const bandTick = g.vec2('band-tick', band, tick), bandHash = g.unary('band-hash', 'noise.hash2d.vec2', bandTick);
  const enabled = g.node('enabled-band', 'math.step.scalar', 'value'); g.edge(threshold, enabled, 'edge'); g.edge(bandHash, enabled, 'value');
  const bandPlusThree = g.binary('band-plus-three', 'math.add.scalar', band, three), tickBand = g.vec2('tick-band', tick, bandPlusThree);
  const shiftHash = g.unary('shift-hash', 'noise.hash2d.vec2', tickBand), centeredHash = g.binary('centered-hash', 'math.subtract.scalar', shiftHash, half);
  const shiftAmount = g.binary('shift-amount', 'math.multiply.scalar', centeredHash, amount), enabledShift = g.binary('enabled-shift', 'math.multiply.scalar', shiftAmount, enabled);
  const shift = g.binary('shift', 'math.multiply.scalar', enabledShift, shiftScale), channelOffset = g.binary('channel-offset', 'math.multiply.scalar', channelScale, amount);
  const redShift = g.binary('red-shift', 'math.add.scalar', shift, channelOffset), blueShift = g.binary('blue-shift', 'math.subtract.scalar', shift, channelOffset);
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', tiny), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', almostOne);
  const sample = (id: string, xOffset: Ref) => {
    const offset = g.vec2(`${id}-offset`, xOffset, zero), shiftedUv = g.binary(`${id}-uv`, 'math.add.vec2', uv, offset);
    const clamped = g.node(`${id}-clamped-uv`, 'math.clamp.vec2', 'value'); g.edge(shiftedUv, clamped, 'value'); g.edge(minUv, clamped, 'min'); g.edge(maxUv, clamped, 'max');
    const image = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(frame, image, 'image'); g.edge(clamped, image, 'uv'); return image;
  };
  const redSample = sample('red', redShift), greenSample = sample('green', shift), blueSample = sample('blue', blueShift), alphaSample = sample('alpha', zero);
  const redSplit = g.node('red-split', 'vector.split.rgba', 'rgb'); g.edge(redSample, redSplit, 'image');
  const greenSplit = g.node('green-split', 'vector.split.rgba', 'rgb'); g.edge(greenSample, greenSplit, 'image');
  const blueSplit = g.node('blue-split', 'vector.split.rgba', 'rgb'); g.edge(blueSample, blueSplit, 'image');
  const alphaSplit = g.node('alpha-split', 'vector.split.rgba', 'rgb'); g.edge(alphaSample, alphaSplit, 'image');
  const components = (id: string, split: Ref) => {
    const vector = g.node(`${id}-vector`, 'convert.rgb-to-vec3', 'value'); g.edge({ node: split.node, port: 'rgb' }, vector, 'rgb');
    const out = g.node(`${id}-components`, 'vector.split.vec3', 'x'); g.edge(vector, out, 'value'); return out;
  };
  const redRgb = components('red', redSplit), greenRgb = components('green', greenSplit), blueRgb = components('blue', blueSplit);
  const channels = g.node('channels', 'vector.combine.vec3', 'value'); g.edge({ node: redRgb.node, port: 'x' }, channels, 'x');
  g.edge({ node: greenRgb.node, port: 'y' }, channels, 'y'); g.edge({ node: blueRgb.node, port: 'z' }, channels, 'z');
  const color = g.node('color', 'convert.vec3-to-rgb', 'rgb'); g.edge(channels, color, 'value');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(color, combine, 'rgb'); g.edge({ node: alphaSplit.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
