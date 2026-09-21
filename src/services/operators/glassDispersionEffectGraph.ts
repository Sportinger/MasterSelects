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

/** Granular equivalent of glassDispersionFragment. Requires generic vector.normalize.vec2 lowering. */
export function createDefaultGlassDispersionGraph(): EffectOperatorGraph {
  const g = new Builder();
  const frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution', 'value'), time = g.node('time', 'image.timeline-time', 'value');
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const speed = g.node('speed', 'values.number', 'value', { value: 'speed' }), four = g.number('four', 4);
  const half = g.number('half', .5), thirtyOne = g.number('thirty-one', 31), tiny = g.number('tiny', .001), tau = g.number('tau', Math.PI * 2);
  const pulseBase = g.number('pulse-base', .6), pulseRange = g.number('pulse-range', .4), offsetScale = g.number('offset-scale', .025);
  const clampMin = g.number('clamp-min', .001), clampMax = g.number('clamp-max', .999);
  const grid = g.node('grid', 'math.max.scalar', 'value'); g.edge(scale, grid, 'a'); g.edge(four, grid, 'b');
  const pixelUv = g.binary('pixel-uv', 'math.multiply.vec2', uv, resolution), grid2 = g.unary('grid-vec2', 'convert.scalar-to-vec2', grid);
  const gridUv = g.binary('grid-uv', 'math.divide-ieee.vec2', pixelUv, grid2), cell = g.unary('cell', 'math.floor.vec2', gridUv);
  const hashX = g.unary('direction-hash-x', 'noise.hash2d.vec2', cell), thirtyOne2 = g.unary('thirty-one-vec2', 'convert.scalar-to-vec2', thirtyOne);
  const shiftedCell = g.binary('shifted-cell', 'math.add.vec2', cell, thirtyOne2), hashY = g.unary('direction-hash-y', 'noise.hash2d.vec2', shiftedCell);
  const directionX = g.binary('direction-x', 'math.subtract.scalar', hashX, half), directionY = g.binary('direction-y', 'math.subtract.scalar', hashY, half);
  const directionRaw = g.vec2('direction-raw', directionX, directionY), tiny2 = g.unary('tiny-vec2', 'convert.scalar-to-vec2', tiny);
  const directionBiased = g.binary('direction-biased', 'math.add.vec2', directionRaw, tiny2), direction = g.unary('direction', 'vector.normalize.vec2', directionBiased);
  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed), hashAngle = g.binary('hash-angle', 'math.multiply.scalar', hashX, tau);
  const pulsePhase = g.binary('pulse-phase', 'math.add.scalar', timeSpeed, hashAngle), pulseSine = g.unary('pulse-sine', 'math.sin.scalar', pulsePhase);
  const pulseWave = g.binary('pulse-wave', 'math.multiply.scalar', pulseRange, pulseSine), pulse = g.binary('pulse', 'math.add.scalar', pulseBase, pulseWave);
  const amountDirection = g.binary('amount-direction', 'math.multiply.vec2-scalar', direction, amount);
  const pulsedOffset = g.binary('pulsed-offset', 'math.multiply.vec2-scalar', amountDirection, pulse), offset = g.binary('offset', 'math.multiply.vec2-scalar', pulsedOffset, offsetScale);
  const plusUv = g.binary('plus-uv', 'math.add.vec2', uv, offset), minusUv = g.binary('minus-uv', 'math.subtract.vec2', uv, offset);
  const min2 = g.unary('clamp-min-vec2', 'convert.scalar-to-vec2', clampMin), max2 = g.unary('clamp-max-vec2', 'convert.scalar-to-vec2', clampMax);
  const sample = (id: string, coords: Ref) => {
    const clamped = g.node(`${id}-clamped-uv`, 'math.clamp.vec2', 'value'); g.edge(coords, clamped, 'value'); g.edge(min2, clamped, 'min'); g.edge(max2, clamped, 'max');
    const image = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(frame, image, 'image'); g.edge(clamped, image, 'uv'); return image;
  };
  const redSample = sample('red', plusUv), greenSample = sample('green', uv), blueSample = sample('blue', minusUv), alphaSample = sample('alpha', uv);
  const components = (id: string, image: Ref) => {
    const split = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(image, split, 'image');
    const vector = g.node(`${id}-vector`, 'convert.rgb-to-vec3', 'value'); g.edge({ node: split.node, port: 'rgb' }, vector, 'rgb');
    const channels = g.node(`${id}-components`, 'vector.split.vec3', 'x'); g.edge(vector, channels, 'value'); return channels;
  };
  const red = components('red', redSample), green = components('green', greenSample), blue = components('blue', blueSample);
  const alpha = g.node('alpha-split', 'vector.split.rgba', 'rgb'); g.edge(alphaSample, alpha, 'image');
  const channels = g.node('channels', 'vector.combine.vec3', 'value'); g.edge({ node: red.node, port: 'x' }, channels, 'x');
  g.edge({ node: green.node, port: 'y' }, channels, 'y'); g.edge({ node: blue.node, port: 'z' }, channels, 'z');
  const color = g.node('color', 'convert.vec3-to-rgb', 'rgb'); g.edge(channels, color, 'value');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(color, combine, 'rgb'); g.edge({ node: alpha.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
