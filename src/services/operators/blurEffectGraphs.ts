import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { BLUR_REFERENCE_HEIGHT, GAUSSIAN_REACH_SIGMAS, GAUSSIAN_SIGMA_MIN_PX, GAUSSIAN_SIGMA_PER_RADIUS, SEPARABLE_MAX_PAIRS_PER_SIDE } from '../../effects/blur/blurSampling';
import { BlurGraphBuilder, normalizeNodes, premultiplyNodes, unpremultiplyNodes, type GraphPort } from './blurGraphBuilder';

export type EditableBlurEffectType = 'box-blur' | 'gaussian-blur' | 'sharpen';
const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const graph = (nodes: BoundOperatorNode[], edges: OperatorEdge[]): EffectOperatorGraph => ({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
  layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 7) * 280, y: Math.floor(index / 7) * 360 }])) });

/**
 * One separable pass. Sequence entry k is pair j = k - pairs: the centre texel (j = 0) or
 * texels 2|j|-1 and 2|j| (times the stride) merged into one linear-filtered tap at their
 * weighted centre. `weightAt` builds the kernel weight of a texel offset node.
 */
function separablePass(g: BlurGraphBuilder, axis: 'horizontal' | 'vertical', source: GraphPort,
  weightAt: (id: string, offset: string) => string) {
  const id = (name: string) => `${axis}-${name}`;
  const sequence = g.add(id('sequence'), 'image.sequence-index');
  const signed = g.binary(id('signed'), 'math.subtract.scalar', [sequence, 'index'], 'pairs');
  const magnitude = g.unary(id('magnitude'), 'math.abs.scalar', signed);
  const farTexel = g.binary(id('far-texel'), 'math.multiply.scalar', magnitude, 'two');
  const far = g.binary(id('far'), 'math.multiply.scalar', farTexel, 'stride');
  const nearTexelRaw = g.binary(id('near-texel-raw'), 'math.subtract.scalar', farTexel, 'one');
  const nearTexel = g.binary(id('near-texel'), 'math.max.scalar', nearTexelRaw, 'zero');
  const near = g.binary(id('near'), 'math.multiply.scalar', nearTexel, 'stride');
  const farWeight = weightAt(id('far-weight'), far);
  const nearWeightRaw = weightAt(id('near-weight-raw'), near);
  // The centre entry has no near partner: min(|j|, 1) removes it.
  const pairGate = g.binary(id('pair-gate'), 'math.min.scalar', magnitude, 'one');
  const nearWeight = g.binary(id('near-weight'), 'math.multiply.scalar', nearWeightRaw, pairGate);
  const weight = g.binary(id('weight'), 'math.add.scalar', nearWeight, farWeight);
  const nearMoment = g.binary(id('near-moment'), 'math.multiply.scalar', near, nearWeight);
  const farMoment = g.binary(id('far-moment'), 'math.multiply.scalar', far, farWeight);
  const moment = g.binary(id('moment'), 'math.add.scalar', nearMoment, farMoment);
  const safeWeight = g.binary(id('safe-weight'), 'math.max.scalar', weight, 'weight-floor');
  const centre = g.binary(id('centre'), 'math.divide-ieee.scalar', moment, safeWeight);
  const magnitudeFloor = g.binary(id('magnitude-floor'), 'math.max.scalar', magnitude, 'one');
  const side = g.binary(id('side'), 'math.divide-ieee.scalar', signed, magnitudeFloor);
  const offsetPx = g.binary(id('offset-px'), 'math.multiply.scalar', centre, side);
  const offsetTexels = g.add(id('offset-texels'), 'vector.combine.vec2', axis === 'horizontal' ? { x: offsetPx, y: 'zero' } : { x: 'zero', y: offsetPx });
  const offset = g.binary(id('offset'), 'math.divide-ieee.vec2', offsetTexels, 'resolution');
  const sampleUv = g.binary(id('sample-uv'), 'math.add.vec2', ['uv', 'uv'], offset);
  const sample = g.add(id('sample'), 'image.sample', { image: source, uv: sampleUv });
  const term: GraphPort = axis === 'horizontal' ? premultiplyNodes(g, id('premultiplied'), [sample, 'image']) : [sample, 'image'];
  const reduce = g.add(id('reduce'), 'image.sequence-reduce', { sample: term, weight, count: 'tap-count' });
  return normalizeNodes(g, axis, reduce);
}

/**
 * Separable Box/Gaussian Blur (see `effects/blur/blurSampling.ts`): radius in pixels of a
 * 1080p frame (shorter side), a premultiplied horizontal pass cached as rgba16float, a vertical
 * pass, then straight alpha again. Two GPU passes of about radius / 2 (Box) or
 * 0.75 * radius (Gaussian) taps each at 1080p.
 */
function createSeparableBlurGraph(kind: 'gaussian' | 'box'): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5);
  g.number('weight-floor', 1e-20);
  const radius = g.bound('radius', 'radius');
  // Radius unit: pixels on a 1080p frame (shorter side), so previews and exports match.
  g.number('reference-height', BLUR_REFERENCE_HEIGHT);
  const shortSide = g.unary('short-side', 'vector.reduce-min.vec2', 'resolution');
  const pixelScale = g.binary('pixel-scale', 'math.divide-ieee.scalar', shortSide, 'reference-height');
  const radiusPx = g.binary('radius-px', 'math.multiply.scalar', radius, pixelScale);
  let reach: string;
  let weightAt: (id: string, offset: string) => string;
  if (kind === 'gaussian') {
    g.number('sigma-per-radius', GAUSSIAN_SIGMA_PER_RADIUS); g.number('reach-sigmas', GAUSSIAN_REACH_SIGMAS);
    g.number('sigma-minimum', GAUSSIAN_SIGMA_MIN_PX);
    const sigmaRaw = g.binary('sigma-raw', 'math.multiply.scalar', radiusPx, 'sigma-per-radius');
    const sigma = g.binary('sigma', 'math.max.scalar', sigmaRaw, 'sigma-minimum');
    reach = g.binary('reach', 'math.multiply.scalar', sigma, 'reach-sigmas');
    weightAt = (id, offset) => g.add(id, 'math.gaussian.scalar', { value: offset, sigma });
  } else {
    // Full weight inside the radius, a fractional tap at its edge: clamp(radius + 1 - |x|, 0, 1).
    reach = g.binary('reach', 'math.add.scalar', radiusPx, 'one');
    weightAt = (id, offset) => g.add(id, 'math.clamp.scalar',
      { value: g.binary(`${id}-coverage`, 'math.subtract.scalar', reach, offset), min: 'zero', max: 'one' });
  }
  const reachHalf = g.binary('reach-half', 'math.multiply.scalar', reach, 'half');
  const pairsNeeded = g.unary('pairs-needed', 'math.ceil.scalar', reachHalf);
  g.number('pairs-limit', SEPARABLE_MAX_PAIRS_PER_SIDE);
  g.binary('pairs', 'math.min.scalar', pairsNeeded, 'pairs-limit');
  // Past the tap budget the pairs spread out (stride > 1) instead of cutting the kernel short.
  g.number('pair-span-limit', 2 * SEPARABLE_MAX_PAIRS_PER_SIDE);
  const strideRaw = g.binary('stride-raw', 'math.divide-ieee.scalar', reach, 'pair-span-limit');
  g.binary('stride', 'math.max.scalar', strideRaw, 'one');
  const pairsDouble = g.binary('pairs-double', 'math.multiply.scalar', 'pairs', 'two');
  g.binary('tap-count', 'math.add.scalar', pairsDouble, 'one');
  const horizontal = separablePass(g, 'horizontal', ['frame', 'image'], weightAt);
  const cache = g.add('horizontal-cache', 'image.materialize', { image: horizontal });
  const vertical = separablePass(g, 'vertical', [cache, 'image'], weightAt);
  unpremultiplyNodes(g, vertical);
  return g.graph();
}

export function createDefaultBoxBlurGraph(): EffectOperatorGraph { return createSeparableBlurGraph('box'); }
export function createDefaultGaussianBlurGraph(): EffectOperatorGraph { return createSeparableBlurGraph('gaussian'); }

export function createDefaultSharpenGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('index', 'image.kernel-index'),
    number('one', 1), node('one-vec2', 'convert.scalar-to-vec2'), node('texel-size', 'math.divide-ieee.vec2'), node('offset', 'math.multiply.vec2'),
    node('radius', 'values.number', { value: 'radius' }), node('radius-vec2', 'convert.scalar-to-vec2'), node('scaled-offset', 'math.multiply.vec2'),
    node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'), number('extent', 3),
    number('half', .5), node('radius-half', 'math.multiply.scalar'), node('sigma', 'math.add.scalar'), number('two', 2), node('two-sigma', 'math.multiply.scalar'),
    node('two-sigma-squared', 'math.multiply.scalar'), node('distance-squared', 'vector.dot.vec2'), number('zero', 0), node('negative-distance', 'math.subtract.scalar'),
    node('exponent', 'math.divide-ieee.scalar'), node('weight', 'math.exp.scalar'), node('reduce', 'image.kernel-grid-reduce'),
    node('weight-vec4', 'convert.scalar-to-vec4'), node('average', 'math.divide-ieee.vec4'), node('blurred', 'convert.vec4-to-image'),
    node('center-split', 'vector.split.rgba'), node('blurred-split', 'vector.split.rgba'), node('difference', 'math.subtract.rgb'),
    node('amount', 'values.number', { value: 'amount' }), node('amount-rgb', 'convert.scalar-to-rgb'), node('scaled-difference', 'math.multiply.rgb'), node('sharpened', 'math.add.rgb'),
    number('clamp-min', 0), node('clamp-min-rgb', 'convert.scalar-to-rgb'), number('clamp-max', 1), node('clamp-max-rgb', 'convert.scalar-to-rgb'), node('clamped', 'math.clamp.rgb'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output')];
  const edges = [edge('one', 'value', 'one-vec2', 'value'), edge('one-vec2', 'value', 'texel-size', 'a'), edge('resolution', 'value', 'texel-size', 'b'),
    edge('index', 'value', 'offset', 'a'), edge('texel-size', 'value', 'offset', 'b'), edge('radius', 'value', 'radius-vec2', 'value'),
    edge('offset', 'value', 'scaled-offset', 'a'), edge('radius-vec2', 'value', 'scaled-offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge('scaled-offset', 'value', 'sample-uv', 'b'),
    edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'), edge('radius', 'value', 'radius-half', 'a'), edge('half', 'value', 'radius-half', 'b'),
    edge('radius-half', 'value', 'sigma', 'a'), edge('half', 'value', 'sigma', 'b'), edge('two', 'value', 'two-sigma', 'a'), edge('sigma', 'value', 'two-sigma', 'b'),
    edge('two-sigma', 'value', 'two-sigma-squared', 'a'), edge('sigma', 'value', 'two-sigma-squared', 'b'), edge('index', 'value', 'distance-squared', 'a'),
    edge('index', 'value', 'distance-squared', 'b'), edge('zero', 'value', 'negative-distance', 'a'), edge('distance-squared', 'value', 'negative-distance', 'b'),
    edge('negative-distance', 'value', 'exponent', 'a'), edge('two-sigma-squared', 'value', 'exponent', 'b'), edge('exponent', 'value', 'weight', 'value'),
    edge('sample', 'image', 'reduce', 'sample'), edge('weight', 'value', 'reduce', 'weight'), edge('extent', 'value', 'reduce', 'extent'),
    edge('reduce', 'weightSum', 'weight-vec4', 'value'), edge('reduce', 'sum', 'average', 'a'), edge('weight-vec4', 'value', 'average', 'b'), edge('average', 'value', 'blurred', 'value'),
    edge('frame', 'image', 'center-split', 'image'), edge('blurred', 'image', 'blurred-split', 'image'), edge('center-split', 'rgb', 'difference', 'a'), edge('blurred-split', 'rgb', 'difference', 'b'),
    edge('amount', 'value', 'amount-rgb', 'value'), edge('difference', 'value', 'scaled-difference', 'a'), edge('amount-rgb', 'rgb', 'scaled-difference', 'b'),
    edge('center-split', 'rgb', 'sharpened', 'a'), edge('scaled-difference', 'value', 'sharpened', 'b'), edge('clamp-min', 'value', 'clamp-min-rgb', 'value'),
    edge('clamp-max', 'value', 'clamp-max-rgb', 'value'), edge('sharpened', 'value', 'clamped', 'value'), edge('clamp-min-rgb', 'rgb', 'clamped', 'min'),
    edge('clamp-max-rgb', 'rgb', 'clamped', 'max'), edge('clamped', 'value', 'combine', 'rgb'), edge('center-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image')];
  return graph(nodes, edges);
}

export function createDefaultBlurEffectGraph(type: EditableBlurEffectType): EffectOperatorGraph {
  return type === 'box-blur' ? createDefaultBoxBlurGraph() : type === 'gaussian-blur' ? createDefaultGaussianBlurGraph() : createDefaultSharpenGraph();
}
