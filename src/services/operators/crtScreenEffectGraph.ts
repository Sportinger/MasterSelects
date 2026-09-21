import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };
const outputPort = (operator: string) => operator === 'image.frame' ? 'image' : operator === 'image.normalized-uv' ? 'uv'
  : operator === 'image.resolution' || operator === 'image.timeline-time' ? 'value'
    : operator === 'image.sample' || operator === 'vector.combine.rgba' ? 'image'
      : operator === 'convert.vec3-to-rgb' ? 'rgb' : operator.startsWith('compare.') ? 'condition' : 'value';

class GraphBuilder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};
  private row = 0;
  node(id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 12) * 300, y: Math.floor(this.nodes.length / 12) * 220 + this.row };
    return { node: id, port: outputPort(operator) };
  }
  literal(id: string, value: number) { return this.node(id, 'values.number', {}, { value }); }
  connect(from: Ref, to: Ref, input: string) {
    this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input });
  }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator); this.connect(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.connect(a, out, 'a'); this.connect(b, out, 'b'); return out; }
  scalarSelect(id: string, condition: Ref, falseValue: Ref, trueValue: Ref) {
    const out = this.node(id, 'select.scalar'); this.connect(falseValue, out, 'falseValue'); this.connect(trueValue, out, 'trueValue'); this.connect(condition, out, 'condition'); return out;
  }
}

/** Granular graph matching the legacy crtScreenFragment operation order. Owner schema remains catalog-owned. */
export function createDefaultCrtScreenGraph(): EffectOperatorGraph {
  const g = new GraphBuilder();
  const frame = g.node('frame', 'image.frame'), uv = g.node('uv', 'image.normalized-uv'), resolution = g.node('resolution', 'image.resolution');
  const uvSplit = g.unary('uv-split', 'vector.split.vec2', uv), resolutionSplit = g.unary('resolution-split', 'vector.split.vec2', resolution);
  const ux = { node: uvSplit.node, port: 'x' }, uy = { node: uvSplit.node, port: 'y' }, width = { node: resolutionSplit.node, port: 'x' }, height = { node: resolutionSplit.node, port: 'y' };
  const one = g.literal('one', 1), two = g.literal('two', 2), three = g.literal('three', 3);
  const half = g.literal('half', .5), tiny = g.literal('tiny', .001), almostOne = g.literal('almost-one', .999), curve = g.literal('curve', .08);
  const low = g.literal('mask-low', .75), high = g.literal('mask-high', .92), scanBase = g.literal('scan-base', .78), scanRange = g.literal('scan-range', .22);
  const flickerBase = g.literal('flicker-base', .98), flickerRange = g.literal('flicker-range', .02), fifty = g.literal('fifty', 50), pi = g.literal('pi', Math.PI);
  const amount = g.node('amount', 'values.number', { value: 'amount' }), scale = g.node('scale', 'values.number', { value: 'scale' });
  const speed = g.node('speed', 'values.number', { value: 'speed' }), time = g.node('time', 'image.timeline-time');

  const two2 = g.unary('two-vec2', 'convert.scalar-to-vec2', two), one2 = g.unary('one-vec2', 'convert.scalar-to-vec2', one);
  const uv2 = g.binary('uv-two', 'math.multiply.vec2', uv, two2), p = g.binary('centered', 'math.subtract.vec2', uv2, one2);
  const radius2 = g.node('radius-squared', 'vector.dot.vec2'); g.connect(p, radius2, 'a'); g.connect(p, radius2, 'b');
  const radiusCurve = g.binary('radius-curve', 'math.multiply.scalar', radius2, curve);
  const distortion = g.binary('distortion', 'math.multiply.scalar', radiusCurve, amount);
  const warp = g.binary('warp', 'math.add.scalar', one, distortion), warped = g.binary('warped', 'math.multiply.vec2-scalar', p, warp);
  const curvedHalf = g.binary('curved-half', 'math.multiply.vec2-scalar', warped, half), half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half);
  const curved = g.binary('curved', 'math.add.vec2', curvedHalf, half2), min2 = g.unary('min-vec2', 'convert.scalar-to-vec2', tiny);
  const max2 = g.unary('max-vec2', 'convert.scalar-to-vec2', almostOne), clamped = g.node('clamped-uv', 'math.clamp.vec2');
  g.connect(curved, clamped, 'value'); g.connect(min2, clamped, 'min'); g.connect(max2, clamped, 'max');
  const sampled = g.node('curved-sample', 'image.sample'); g.connect(frame, sampled, 'image'); g.connect(clamped, sampled, 'uv');
  const color = g.unary('color', 'vector.split.rgba', sampled, 'image'), colorRgb = { node: color.node, port: 'rgb' }, alpha = { node: color.node, port: 'alpha' };

  const scanY = g.binary('scan-y', 'math.multiply.scalar', uy, height), scanAngle = g.binary('scan-angle', 'math.multiply.scalar', scanY, pi);
  const scanSine = g.unary('scan-sine', 'math.sin.scalar', scanAngle), scanWave = g.binary('scan-wave', 'math.multiply.scalar', scanRange, scanSine);
  const scan = g.binary('scan', 'math.add.scalar', scanBase, scanWave);

  const safeScale = g.node('safe-scale', 'math.max.scalar'); g.connect(scale, safeScale, 'a'); g.connect(one, safeScale, 'b');
  const pixelX = g.binary('pixel-x', 'math.multiply.scalar', ux, width), maskCell = g.binary('mask-cell', 'math.divide-ieee.scalar', pixelX, safeScale);
  const maskFloor = g.unary('mask-floor', 'math.floor.scalar', maskCell), thirds = g.binary('mask-thirds', 'math.divide-ieee.scalar', maskFloor, three);
  const thirdFloor = g.unary('mask-third-floor', 'math.floor.scalar', thirds), triple = g.binary('mask-third-triple', 'math.multiply.scalar', thirdFloor, three);
  const phase = g.binary('mask-phase', 'math.subtract.scalar', maskFloor, triple), pointFive = g.literal('point-five', .5), onePointFive = g.literal('one-point-five', 1.5);
  const redCondition = g.node('is-red', 'compare.greater.scalar'); g.connect(pointFive, redCondition, 'a'); g.connect(phase, redCondition, 'b');
  const blueCondition = g.node('is-blue', 'compare.greater.scalar'); g.connect(phase, blueCondition, 'a'); g.connect(onePointFive, blueCondition, 'b');
  const aboveHalf = g.node('above-half', 'compare.greater.scalar'); g.connect(phase, aboveHalf, 'a'); g.connect(pointFive, aboveHalf, 'b');
  const belowOneHalf = g.node('below-one-half', 'compare.greater.scalar'); g.connect(onePointFive, belowOneHalf, 'a'); g.connect(phase, belowOneHalf, 'b');
  const greenCondition = g.node('is-green', 'logic.and.boolean'); g.connect(aboveHalf, greenCondition, 'a'); g.connect(belowOneHalf, greenCondition, 'b');
  const red = g.scalarSelect('mask-r', redCondition, low, high), green = g.scalarSelect('mask-g', greenCondition, low, high), blue = g.scalarSelect('mask-b', blueCondition, low, high);
  const maskVector = g.node('mask-vector', 'vector.combine.vec3'); g.connect(red, maskVector, 'x'); g.connect(green, maskVector, 'y'); g.connect(blue, maskVector, 'z');
  const mask = g.unary('mask', 'convert.vec3-to-rgb', maskVector);

  const timeSpeed = g.binary('time-speed', 'math.multiply.scalar', time, speed), flickerAngle = g.binary('flicker-angle', 'math.multiply.scalar', timeSpeed, fifty);
  const flickerSine = g.unary('flicker-sine', 'math.sin.scalar', flickerAngle), flickerWave = g.binary('flicker-wave', 'math.multiply.scalar', flickerRange, flickerSine);
  const flicker = g.binary('flicker', 'math.add.scalar', flickerBase, flickerWave);
  const masked = g.binary('masked-color', 'math.multiply.rgb', colorRgb, mask), scanned = g.binary('scanned-color', 'math.multiply.rgb-scalar', masked, scan);
  const flickered = g.binary('flickered-color', 'math.multiply.rgb-scalar', scanned, flicker), mixed = g.node('mixed-color', 'math.mix.rgb');
  g.connect(colorRgb, mixed, 'a'); g.connect(flickered, mixed, 'b'); g.connect(amount, mixed, 't');
  const combined = g.node('combine', 'vector.combine.rgba'); g.connect(mixed, combined, 'rgb'); g.connect(alpha, combined, 'alpha');
  const output = g.node('output', 'image.output'); g.connect(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
