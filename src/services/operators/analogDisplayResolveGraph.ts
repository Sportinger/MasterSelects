import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorGroup, OperatorValue } from '../../types/operatorGraph';

export const ANALOG_DISPLAY_PARAMETER_IDS = ['amount', 'crtAmount', 'curvature', 'bloom', 'scanlines', 'maskStrength', 'flicker'] as const;
export type AnalogDisplayParameterId = typeof ANALOG_DISPLAY_PARAMETER_IDS[number];

export interface AnalogDisplayResolveRef { node: string; port: string }
export interface AnalogDisplayResolveIsland {
  nodes: BoundOperatorNode[]; edges: OperatorEdge[]; layout: EffectOperatorGraph['layout']; groups: OperatorGroup[];
  output: AnalogDisplayResolveRef;
}
export interface AnalogDisplayResolveIslandOptions {
  prefix: string; source: AnalogDisplayResolveRef; decoded: AnalogDisplayResolveRef; signalAmount: AnalogDisplayResolveRef;
  anchor?: { x: number; y: number };
  parameterValues?: Partial<Record<AnalogDisplayParameterId, { binding?: BoundOperatorNode['bindings'][string]; constant?: OperatorValue }>>;
}

class Builder {
  readonly nodes: BoundOperatorNode[] = [];
  readonly edges: OperatorEdge[] = [];
  readonly layout: EffectOperatorGraph['layout'] = {};
  private readonly members: string[] = [];
  private readonly rows = new Map<number, number>();
  private readonly prefix: string;
  private readonly anchor: { x: number; y: number };
  constructor(prefix: string, anchor: { x: number; y: number }) {
    this.prefix = prefix; this.anchor = anchor;
  }
  node(name: string, operator: string, column: number, constants?: Record<string, OperatorValue>, bindings: BoundOperatorNode['bindings'] = {}): AnalogDisplayResolveRef {
    const id = `${this.prefix}-${name}`;
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    const row = this.rows.get(column) ?? 0; this.rows.set(column, row + 1);
    this.layout[id] = { x: this.anchor.x + column * 300, y: this.anchor.y + row * 180 }; this.members.push(id);
    const port = operator === 'image.sample' || operator === 'convert.vec4-to-image' || operator === 'vector.combine.rgba' || operator === 'control.select.image'
      ? 'image' : operator === 'vector.combine.vec2' || operator === 'vector.combine.vec3' || operator === 'vector.combine.vec4' ? 'value'
        : operator === 'image.normalized-uv' ? 'uv'
          : operator === 'convert.scalar-to-rgb' || operator === 'convert.vec3-to-rgb' ? 'rgb' : operator.startsWith('compare.') ? 'condition' : 'value';
    return { node: id, port };
  }
  connect(from: AnalogDisplayResolveRef, to: AnalogDisplayResolveRef, input: string) {
    this.edges.push({ id: `${from.node}-${to.node}-${input}-${this.edges.length}`, from: from.node, output: from.port, to: to.node, input });
  }
  unary(name: string, operator: string, value: AnalogDisplayResolveRef, column: number, input = 'value') {
    const result = this.node(name, operator, column); this.connect(value, result, input); return result;
  }
  binary(name: string, operator: string, a: AnalogDisplayResolveRef, b: AnalogDisplayResolveRef, column: number) {
    const result = this.node(name, operator, column); this.connect(a, result, 'a'); this.connect(b, result, 'b'); return result;
  }
  scalar(name: string, value: number, column = 0) { return this.node(name, 'values.number', column, { value }); }
  bound(name: AnalogDisplayParameterId, source?: { binding?: BoundOperatorNode['bindings'][string]; constant?: OperatorValue }) {
    return this.node(name, 'values.number', 0, source && 'constant' in source ? { value: source.constant! } : undefined,
      source ? (source.binding === undefined ? {} : { value: source.binding }) : { value: name });
  }
  vec2(name: string, x: AnalogDisplayResolveRef, y: AnalogDisplayResolveRef, column: number) {
    const result = this.node(name, 'vector.combine.vec2', column); this.connect(x, result, 'x'); this.connect(y, result, 'y'); return result;
  }
  select(name: string, condition: AnalogDisplayResolveRef, falseValue: AnalogDisplayResolveRef, trueValue: AnalogDisplayResolveRef, column: number) {
    const result = this.node(name, 'select.scalar', column); this.connect(falseValue, result, 'falseValue');
    this.connect(trueValue, result, 'trueValue'); this.connect(condition, result, 'condition'); return result;
  }
  sample(name: string, image: AnalogDisplayResolveRef, uv: AnalogDisplayResolveRef, column: number) {
    const result = this.node(name, 'image.sample', column); this.connect(image, result, 'image'); this.connect(uv, result, 'uv'); return result;
  }
  group(): OperatorGroup { return { id: `${this.prefix}-group`, label: 'Analog Display Resolve', color: '#10b981', nodeIds: this.members }; }
}

/** Flat, reusable image island matching analogResolveCompute without persisting resource handles. */
export function createAnalogDisplayResolveIsland(options: AnalogDisplayResolveIslandOptions): AnalogDisplayResolveIsland {
  const g = new Builder(options.prefix, options.anchor ?? { x: 0, y: 0 });
  const zero = g.scalar('zero', 0), one = g.scalar('one', 1), half = g.scalar('half', .5), two = g.scalar('two', 2);
  const tiny = g.scalar('tiny', .0001), pointTwelve = g.scalar('point-twelve', .12), bloomScale = g.scalar('bloom-scale', .2);
  const uv = g.node('uv', 'image.normalized-uv', 0), resolution = g.node('resolution', 'image.resolution', 0), time = g.node('time', 'image.timeline-time', 0);
  const parameter = (id: AnalogDisplayParameterId) => g.bound(id, options.parameterValues?.[id]);
  const amountRaw = parameter('amount'), crtAmountRaw = parameter('crtAmount'), curvature = parameter('curvature'), bloom = parameter('bloom');
  const scanlines = parameter('scanlines'), maskStrength = parameter('maskStrength'), flicker = parameter('flicker');
  const crtAmount = g.node('crt-clamp', 'math.clamp.scalar', 1); g.connect(crtAmountRaw, crtAmount, 'value'); g.connect(zero, crtAmount, 'min'); g.connect(one, crtAmount, 'max');
  const amount = g.node('amount-clamp', 'math.clamp.scalar', 1); g.connect(amountRaw, amount, 'value'); g.connect(zero, amount, 'min'); g.connect(one, amount, 'max');
  const signalAmount = g.node('signal-clamp', 'math.clamp.scalar', 1); g.connect(options.signalAmount, signalAmount, 'value'); g.connect(zero, signalAmount, 'min'); g.connect(one, signalAmount, 'max');
  const activeAmount = g.binary('active-amount', 'math.max.scalar', signalAmount, crtAmount, 2);
  const active = g.binary('active', 'compare.greater.scalar', activeAmount, tiny, 3);
  const original = g.sample('original', options.source, uv, 1);

  const uv2 = g.binary('uv-two', 'math.multiply.vec2-scalar', uv, two, 2), one2 = g.unary('one-vec2', 'convert.scalar-to-vec2', one, 1);
  const centered = g.binary('centered', 'math.subtract.vec2', uv2, one2, 3);
  const radius2 = g.node('center-dot', 'vector.dot.vec2', 4); g.connect(centered, radius2, 'a'); g.connect(centered, radius2, 'b');
  let warp = g.binary('warp-curvature', 'math.multiply.scalar', radius2, curvature, 5);
  warp = g.binary('warp-crt', 'math.multiply.scalar', warp, crtAmount, 6);
  warp = g.binary('warp-scale', 'math.multiply.scalar', warp, pointTwelve, 7);
  const warpFactor = g.binary('warp-factor', 'math.add.scalar', one, warp, 8);
  const curved = g.binary('curved', 'math.multiply.vec2-scalar', centered, warpFactor, 9);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half, 2);
  const curvedHalf = g.binary('curved-half', 'math.multiply.vec2', curved, half2, 10), displayUv = g.binary('display-uv', 'math.add.vec2', curvedHalf, half2, 11);
  const displaySplit = g.unary('display-split', 'vector.split.vec2', displayUv, 12), dx = { node: displaySplit.node, port: 'x' }, dy = { node: displaySplit.node, port: 'y' };
  const sx0 = g.node('inside-x-min', 'math.step.scalar', 13); g.connect(zero, sx0, 'edge'); g.connect(dx, sx0, 'value');
  const sx1 = g.node('inside-x-max', 'math.step.scalar', 13); g.connect(dx, sx1, 'edge'); g.connect(one, sx1, 'value');
  const sy0 = g.node('inside-y-min', 'math.step.scalar', 13); g.connect(zero, sy0, 'edge'); g.connect(dy, sy0, 'value');
  const sy1 = g.node('inside-y-max', 'math.step.scalar', 13); g.connect(dy, sy1, 'edge'); g.connect(one, sy1, 'value');
  const insideX = g.binary('inside-x', 'math.multiply.scalar', sx0, sx1, 14), insideY = g.binary('inside-y', 'math.multiply.scalar', sy0, sy1, 14);
  const inside = g.binary('inside', 'math.multiply.scalar', insideX, insideY, 15);

  const sourceDisplay = g.sample('source-display', options.source, displayUv, 13), decodedDisplay = g.sample('decoded-display', options.decoded, displayUv, 13);
  const sourceSplit = g.unary('source-display-split', 'vector.split.rgba', sourceDisplay, 14, 'image');
  const decodedSplit = g.unary('decoded-display-split', 'vector.split.rgba', decodedDisplay, 14, 'image');
  const decodedRgb = g.node('decoded-rgb', 'math.mix.rgb', 15); g.connect({ node: sourceSplit.node, port: 'rgb' }, decodedRgb, 'a');
  g.connect({ node: decodedSplit.node, port: 'rgb' }, decodedRgb, 'b'); g.connect(signalAmount, decodedRgb, 't');

  const width360 = g.scalar('decoded-width', 360), offsetPixels = g.scalar('bloom-offset-pixels', 1.75);
  const offsetX = g.binary('bloom-offset-x', 'math.divide-ieee.scalar', offsetPixels, width360, 3), offset = g.vec2('bloom-offset', offsetX, zero, 4);
  const uvMinus = g.binary('display-minus', 'math.subtract.vec2', displayUv, offset, 12), uvPlus = g.binary('display-plus', 'math.add.vec2', displayUv, offset, 12);
  const sourceMinus = g.sample('source-minus', options.source, uvMinus, 13), sourcePlus = g.sample('source-plus', options.source, uvPlus, 13);
  const decodedMinus = g.sample('decoded-minus', options.decoded, uvMinus, 13), decodedPlus = g.sample('decoded-plus', options.decoded, uvPlus, 13);
  const rgb = (name: string, value: AnalogDisplayResolveRef) => {
    const split = g.unary(name, 'vector.split.rgba', value, 14, 'image'); return { node: split.node, port: 'rgb' };
  };
  const average = (name: string, a: AnalogDisplayResolveRef, b: AnalogDisplayResolveRef) => {
    const sum = g.binary(`${name}-sum`, 'math.add.rgb', a, b, 15); return g.binary(name, 'math.multiply.rgb-scalar', sum, half, 16);
  };
  const bloomDecoded = average('bloom-decoded', rgb('decoded-minus-split', decodedMinus), rgb('decoded-plus-split', decodedPlus));
  const bloomOriginal = average('bloom-original', rgb('source-minus-split', sourceMinus), rgb('source-plus-split', sourcePlus));
  const bloomColor = g.node('bloom-color', 'math.mix.rgb', 17); g.connect(bloomOriginal, bloomColor, 'a'); g.connect(bloomDecoded, bloomColor, 'b'); g.connect(signalAmount, bloomColor, 't');
  const brightness = g.unary('brightness', 'color.luminance-rec601.rgb', decodedRgb, 16, 'rgb');
  const bloomGate = g.node('bloom-gate', 'math.smoothstep.scalar', 17); g.connect(g.scalar('bloom-low', .55), bloomGate, 'edge0'); g.connect(one, bloomGate, 'edge1'); g.connect(brightness, bloomGate, 'value');
  let bloomRgb = g.binary('bloom-amount', 'math.multiply.rgb-scalar', bloomColor, bloom, 18);
  bloomRgb = g.binary('bloom-crt', 'math.multiply.rgb-scalar', bloomRgb, crtAmount, 19);
  bloomRgb = g.binary('bloom-gated', 'math.multiply.rgb-scalar', bloomRgb, bloomGate, 20);
  bloomRgb = g.binary('bloom-rgb', 'math.multiply.rgb-scalar', bloomRgb, bloomScale, 21);
  let crt = g.binary('crt-bloom', 'math.add.rgb', decodedRgb, bloomRgb, 22);

  const scanScale = g.scalar('scan-scale', 576), pi = g.scalar('pi', Math.PI), scanBase = g.scalar('scan-base', .58), scanRange = g.scalar('scan-range', .42);
  const scanPosition = g.binary('scan-position', 'math.multiply.scalar', dy, scanScale, 16), scanPhase = g.unary('scan-phase', 'math.fract.scalar', scanPosition, 17);
  const scanAngle = g.binary('scan-angle', 'math.multiply.scalar', scanPhase, pi, 18), scanSine = g.unary('scan-sine', 'math.sin.scalar', scanAngle, 19);
  const scanWave = g.binary('scan-wave', 'math.multiply.scalar', scanRange, scanSine, 20), scanProfile = g.binary('scan-profile', 'math.add.scalar', scanBase, scanWave, 21);
  const scanAmount = g.binary('scan-amount', 'math.multiply.scalar', scanlines, crtAmount, 20);
  const scanFactor = g.node('scan-factor', 'math.mix.scalar', 22); g.connect(one, scanFactor, 'a'); g.connect(scanProfile, scanFactor, 'b'); g.connect(scanAmount, scanFactor, 't');
  crt = g.binary('crt-scan', 'math.multiply.rgb-scalar', crt, scanFactor, 23);

  const uvPixels = g.binary('pixel-position', 'math.multiply.vec2', uv, resolution, 3), pixelFloor = g.unary('pixel-floor', 'math.floor.vec2', uvPixels, 4);
  const pixelSplit = g.unary('pixel-split', 'vector.split.vec2', pixelFloor, 5), pixelX = { node: pixelSplit.node, port: 'x' };
  const three = g.scalar('three', 3), xThird = g.binary('pixel-third', 'math.divide-ieee.scalar', pixelX, three, 6), thirdFloor = g.unary('pixel-third-floor', 'math.floor.scalar', xThird, 7);
  const triple = g.binary('pixel-third-triple', 'math.multiply.scalar', three, thirdFloor, 8), maskIndex = g.binary('mask-index', 'math.subtract.scalar', pixelX, triple, 9);
  const pointFive = half, onePointFive = g.scalar('one-point-five', 1.5), isRed = g.binary('mask-red', 'compare.greater.scalar', pointFive, maskIndex, 10);
  const aboveHalf = g.binary('mask-above-half', 'compare.greater.scalar', maskIndex, pointFive, 10), belowOneHalf = g.binary('mask-below-one-half', 'compare.greater.scalar', onePointFive, maskIndex, 10);
  const isGreen = g.binary('mask-green', 'logic.and.boolean', aboveHalf, belowOneHalf, 11), dim = g.scalar('mask-dim', .78);
  const red = g.select('mask-r', isRed, dim, one, 12), green = g.select('mask-g', isGreen, dim, one, 12);
  const isBlue = g.binary('mask-blue', 'compare.greater.scalar', maskIndex, onePointFive, 11), blue = g.select('mask-b', isBlue, dim, one, 12);
  const maskVec = g.node('mask-vec3', 'vector.combine.vec3', 13); g.connect(red, maskVec, 'x'); g.connect(green, maskVec, 'y'); g.connect(blue, maskVec, 'z');
  const maskRgb = g.unary('mask-rgb', 'convert.vec3-to-rgb', maskVec, 14), oneRgb = g.unary('one-rgb', 'convert.scalar-to-rgb', one, 13);
  const maskAmount = g.binary('mask-amount', 'math.multiply.scalar', maskStrength, crtAmount, 14);
  const maskFactor = g.node('mask-factor', 'math.mix.rgb', 15); g.connect(oneRgb, maskFactor, 'a'); g.connect(maskRgb, maskFactor, 'b'); g.connect(maskAmount, maskFactor, 't');
  crt = g.binary('crt-mask', 'math.multiply.rgb', crt, maskFactor, 24);

  const tau = g.scalar('tau', Math.PI * 2), fieldRate = g.scalar('field-rate', 49.73), flickerScale = g.scalar('flicker-scale', .055);
  let fieldAngle = g.binary('field-time-tau', 'math.multiply.scalar', time, tau, 5); fieldAngle = g.binary('field-angle', 'math.multiply.scalar', fieldAngle, fieldRate, 6);
  const fieldSine = g.unary('field-sine', 'math.sin.scalar', fieldAngle, 7), fieldHalfSine = g.binary('field-half-sine', 'math.multiply.scalar', half, fieldSine, 8);
  const fieldWave = g.binary('field-wave', 'math.add.scalar', half, fieldHalfSine, 9);
  let flickerAmount = g.binary('flicker-crt', 'math.multiply.scalar', flicker, crtAmount, 10); flickerAmount = g.binary('flicker-scale-product', 'math.multiply.scalar', flickerAmount, flickerScale, 11);
  flickerAmount = g.binary('flicker-wave-product', 'math.multiply.scalar', flickerAmount, fieldWave, 12);
  const fieldFlicker = g.binary('field-flicker', 'math.subtract.scalar', one, flickerAmount, 13), fieldInside = g.binary('field-inside', 'math.multiply.scalar', fieldFlicker, inside, 16);
  crt = g.binary('crt-field', 'math.multiply.rgb-scalar', crt, fieldInside, 25);
  const analog = g.node('analog-rgb', 'math.mix.rgb', 26); g.connect(decodedRgb, analog, 'a'); g.connect(crt, analog, 'b'); g.connect(crtAmount, analog, 't');
  const zeroRgb = g.unary('zero-rgb', 'convert.scalar-to-rgb', zero, 25), clamped = g.node('analog-clamp', 'math.clamp.rgb', 27);
  g.connect(analog, clamped, 'value'); g.connect(zeroRgb, clamped, 'min'); g.connect(oneRgb, clamped, 'max');
  const originalSplit = g.unary('original-split', 'vector.split.rgba', original, 26, 'image');
  const mixed = g.node('mixed-rgb', 'math.mix.rgb', 28); g.connect({ node: originalSplit.node, port: 'rgb' }, mixed, 'a'); g.connect(clamped, mixed, 'b'); g.connect(amount, mixed, 't');
  const processed = g.node('processed', 'vector.combine.rgba', 29); g.connect(mixed, processed, 'rgb'); g.connect({ node: originalSplit.node, port: 'alpha' }, processed, 'alpha');
  const output = g.node('active-select', 'control.select.image', 30); g.connect(original, output, 'falseValue'); g.connect(processed, output, 'trueValue'); g.connect(active, output, 'condition');
  return { nodes: g.nodes, edges: g.edges, layout: g.layout, groups: [g.group()], output };
}
