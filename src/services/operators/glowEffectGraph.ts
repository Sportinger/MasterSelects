import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import {
  GLOW_AMOUNT_GAIN, GLOW_CENTER_WEIGHT, GLOW_MAX_PREFILTER_TAPS_PER_SIDE, GLOW_MAX_RINGS, GLOW_MAX_SAMPLES_PER_RING,
  GLOW_MIN_PREFILTER_SIGMA_PX, GLOW_MIN_SAMPLES_PER_RING, GLOW_PIXELS_PER_RADIUS, GLOW_RING_STAGGER,
  GLOW_SOFTNESS_OFFSET, GLOW_THRESHOLD_SOFTNESS,
} from '../../effects/stylize/glow/glowSampling';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
const gridLayout = (nodes: BoundOperatorNode[]) =>
  Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }]));

/**
 * The original single-pass Glow graph (until 2026-10). It sampled the source at
 * `ring * radius * 10 / width` in both axes (stretched on non-square layers) with a
 * fixed sample count per ring. Kept only to recognize and upgrade untouched saved
 * graphs and to define the shared Bright Pass composition.
 */
export function createLegacyGlowGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), node('resolution-components', 'vector.split.vec2'),
    node('kernel-index', 'image.kernel-index'), node('index-components', 'vector.split.vec2'),
    number('one', 1), number('two', 2), number('ten', 10), number('tau', 6.283185307179586), number('half', .5), number('threshold-width', .1), number('softness-offset', .3),
    node('rings', 'values.number', { value: 'rings' }), number('rings-limit', 32), node('rings-clamped', 'math.clamp.scalar'), node('rings-count', 'math.floor.scalar'),
    node('samples', 'values.number', { value: 'samplesPerRing' }), number('samples-minimum', 4), number('samples-limit', 64), node('samples-clamped', 'math.clamp.scalar'), node('samples-count', 'math.floor.scalar'),
    node('ring', 'math.add.scalar'), node('angle-turn', 'math.multiply.scalar'), node('angle-base', 'math.divide-ieee.scalar'), node('angle-stagger', 'math.multiply.scalar'), node('angle', 'math.add.scalar'), node('direction', 'vector.unit-direction.scalar'),
    node('radius', 'values.number', { value: 'radius' }), node('ring-radius', 'math.multiply.scalar'), node('width-reciprocal', 'math.reciprocal.scalar'), node('radius-pixels', 'math.multiply.scalar'), node('radius-scale', 'math.multiply.scalar'), node('offset', 'math.multiply.vec2-scalar'), node('sample-uv', 'math.add.vec2'), node('sample', 'image.sample'),
    node('ring-progress', 'math.divide-ieee.scalar'), node('softness', 'values.number', { value: 'softness' }), node('gaussian-sigma', 'math.add.scalar'), node('ring-weight', 'math.gaussian.scalar'),
    node('threshold', 'values.number', { value: 'threshold' }), node('threshold-low', 'math.subtract.scalar'), node('threshold-high', 'math.add.scalar'), node('sample-luma', 'color.luminance-rec709.image'), node('sample-bright', 'math.smoothstep.scalar'), node('bright-sample', 'math.multiply.image-scalar'),
    node('reduce', 'image.kernel-rect-reduce'), node('reduced-rgb', 'convert.vec4-to-rgb'),
    node('center-split', 'vector.split.rgba'), node('center-luma', 'color.luminance-rec709.image'), node('center-bright', 'math.smoothstep.scalar'), node('center-lit', 'math.multiply.rgb-scalar'), node('center-double', 'math.multiply.rgb-scalar'),
    node('glow-sum', 'math.add.rgb'), node('total-weight', 'math.add.scalar'), node('glow-average', 'math.divide-ieee.rgb-scalar'),
    node('amount', 'values.number', { value: 'amount' }), node('amount-scaled-glow', 'math.multiply.rgb-scalar'), node('scaled-glow', 'math.multiply.rgb-scalar'), node('result', 'math.add.rgb'),
    number('zero', 0), node('clamped', 'math.clamp.rgb-scalar'), node('combine', 'vector.combine.rgba'), node('output', 'image.output'),
  ];
  const edges: OperatorEdge[] = [
    edge('resolution', 'value', 'resolution-components', 'value'), edge('kernel-index', 'value', 'index-components', 'value'),
    edge('rings', 'value', 'rings-clamped', 'value'), edge('one', 'value', 'rings-clamped', 'min'), edge('rings-limit', 'value', 'rings-clamped', 'max'), edge('rings-clamped', 'value', 'rings-count', 'value'),
    edge('samples', 'value', 'samples-clamped', 'value'), edge('samples-minimum', 'value', 'samples-clamped', 'min'), edge('samples-limit', 'value', 'samples-clamped', 'max'), edge('samples-clamped', 'value', 'samples-count', 'value'),
    edge('index-components', 'x', 'ring', 'a'), edge('one', 'value', 'ring', 'b'), edge('index-components', 'y', 'angle-turn', 'a'), edge('tau', 'value', 'angle-turn', 'b'), edge('angle-turn', 'value', 'angle-base', 'a'), edge('samples-count', 'value', 'angle-base', 'b'), edge('ring', 'value', 'angle-stagger', 'a'), edge('half', 'value', 'angle-stagger', 'b'), edge('angle-base', 'value', 'angle', 'a'), edge('angle-stagger', 'value', 'angle', 'b'), edge('angle', 'value', 'direction', 'angle'),
    edge('ring', 'value', 'ring-radius', 'a'), edge('radius', 'value', 'ring-radius', 'b'), edge('resolution-components', 'x', 'width-reciprocal', 'value'), edge('ring-radius', 'value', 'radius-pixels', 'a'), edge('width-reciprocal', 'value', 'radius-pixels', 'b'), edge('radius-pixels', 'value', 'radius-scale', 'a'), edge('ten', 'value', 'radius-scale', 'b'), edge('direction', 'value', 'offset', 'a'), edge('radius-scale', 'value', 'offset', 'b'), edge('uv', 'uv', 'sample-uv', 'a'), edge('offset', 'value', 'sample-uv', 'b'), edge('frame', 'image', 'sample', 'image'), edge('sample-uv', 'value', 'sample', 'uv'),
    edge('ring', 'value', 'ring-progress', 'a'), edge('rings-count', 'value', 'ring-progress', 'b'), edge('softness', 'value', 'gaussian-sigma', 'a'), edge('softness-offset', 'value', 'gaussian-sigma', 'b'), edge('ring-progress', 'value', 'ring-weight', 'value'), edge('gaussian-sigma', 'value', 'ring-weight', 'sigma'),
    edge('threshold', 'value', 'threshold-low', 'a'), edge('threshold-width', 'value', 'threshold-low', 'b'), edge('threshold', 'value', 'threshold-high', 'a'), edge('threshold-width', 'value', 'threshold-high', 'b'), edge('sample', 'image', 'sample-luma', 'image'), edge('threshold-low', 'value', 'sample-bright', 'edge0'), edge('threshold-high', 'value', 'sample-bright', 'edge1'), edge('sample-luma', 'value', 'sample-bright', 'value'), edge('sample', 'image', 'bright-sample', 'a'), edge('sample-bright', 'value', 'bright-sample', 'b'),
    edge('bright-sample', 'value', 'reduce', 'sample'), edge('ring-weight', 'value', 'reduce', 'weight'), edge('rings-count', 'value', 'reduce', 'width'), edge('samples-count', 'value', 'reduce', 'height'), edge('reduce', 'sum', 'reduced-rgb', 'value'),
    edge('frame', 'image', 'center-split', 'image'), edge('frame', 'image', 'center-luma', 'image'), edge('threshold-low', 'value', 'center-bright', 'edge0'), edge('threshold-high', 'value', 'center-bright', 'edge1'), edge('center-luma', 'value', 'center-bright', 'value'), edge('center-split', 'rgb', 'center-lit', 'a'), edge('center-bright', 'value', 'center-lit', 'b'), edge('center-lit', 'value', 'center-double', 'a'), edge('two', 'value', 'center-double', 'b'),
    edge('reduced-rgb', 'rgb', 'glow-sum', 'a'), edge('center-double', 'value', 'glow-sum', 'b'), edge('reduce', 'weightSum', 'total-weight', 'a'), edge('two', 'value', 'total-weight', 'b'), edge('glow-sum', 'value', 'glow-average', 'a'), edge('total-weight', 'value', 'glow-average', 'b'),
    edge('glow-average', 'value', 'amount-scaled-glow', 'a'), edge('amount', 'value', 'amount-scaled-glow', 'b'), edge('amount-scaled-glow', 'value', 'scaled-glow', 'a'), edge('two', 'value', 'scaled-glow', 'b'), edge('center-split', 'rgb', 'result', 'a'), edge('scaled-glow', 'value', 'result', 'b'), edge('result', 'value', 'clamped', 'value'), edge('zero', 'value', 'clamped', 'min'), edge('one', 'value', 'clamped', 'max'), edge('clamped', 'value', 'combine', 'rgb'), edge('center-split', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image'),
  ];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: gridLayout(nodes) };
}

/** Separable prefilter: `prefix` is `horizontal` or `vertical`; the tap offset runs along that axis. */
function prefilterPass(prefix: 'horizontal' | 'vertical', sampleFrom: string, cache: string) {
  const id = (name: string) => `${prefix}-${name}`;
  const nodes = [
    node(id('index'), 'image.kernel-index'), node(id('index-components'), 'vector.split.vec2'),
    node(id('tap'), 'math.multiply.scalar'), node(id('tap-centered'), 'math.subtract.scalar'), node(id('offset-px'), 'math.add.scalar'),
    node(id('offset-vec2'), 'vector.combine.vec2'), node(id('offset'), 'math.divide-ieee.vec2'), node(id('sample-uv'), 'math.add.vec2'),
    node(id('weight'), 'math.gaussian.scalar'), node(id('reduce'), 'image.kernel-rect-reduce'),
    node(id('weight-vec4'), 'convert.scalar-to-vec4'), node(id('average'), 'math.divide-ieee.vec4'), node(id('image'), 'convert.vec4-to-image'),
    node(cache, 'image.materialize'),
  ];
  const along = prefix === 'horizontal' ? 'x' : 'y', across = prefix === 'horizontal' ? 'y' : 'x';
  const edges = [
    edge(id('index'), 'value', id('index-components'), 'value'),
    // Tap i of 2T lands at 2i - 2T + 0.5 px: on a texel boundary, so bilinear filtering averages two texels.
    edge(id('index-components'), 'x', id('tap'), 'a'), edge('two', 'value', id('tap'), 'b'),
    edge(id('tap'), 'value', id('tap-centered'), 'a'), edge('prefilter-width', 'value', id('tap-centered'), 'b'),
    edge(id('tap-centered'), 'value', id('offset-px'), 'a'), edge('half', 'value', id('offset-px'), 'b'),
    edge(id('offset-px'), 'value', id('offset-vec2'), along), edge('zero', 'value', id('offset-vec2'), across),
    edge(id('offset-vec2'), 'value', id('offset'), 'a'), edge('resolution', 'value', id('offset'), 'b'),
    edge('uv', 'uv', id('sample-uv'), 'a'), edge(id('offset'), 'value', id('sample-uv'), 'b'),
    edge(id('offset-px'), 'value', id('weight'), 'value'), edge('prefilter-sigma', 'value', id('weight'), 'sigma'),
    edge(sampleFrom, prefix === 'horizontal' ? 'value' : 'image', id('reduce'), 'sample'), edge(id('weight'), 'value', id('reduce'), 'weight'),
    edge('prefilter-width', 'value', id('reduce'), 'width'), edge('one', 'value', id('reduce'), 'height'),
    edge(id('reduce'), 'weightSum', id('weight-vec4'), 'value'), edge(id('reduce'), 'sum', id('average'), 'a'), edge(id('weight-vec4'), 'value', id('average'), 'b'),
    edge(id('average'), 'value', id('image'), 'value'), edge(id('image'), 'image', cache, 'image'),
  ];
  return { nodes, edges };
}

/**
 * Glow v2: bright pass → horizontal and vertical Gaussian prefilter (two cached
 * rgba16float passes) → ring sampling of the prefiltered light with per-axis pixel
 * offsets and adaptive per-ring sample counts → premultiplied additive resolve.
 * See `glowSampling.ts` for the shared contract the WGSL reference and CPU path follow.
 */
export function createDefaultGlowGraph(): EffectOperatorGraph {
  const horizontal = prefilterPass('horizontal', 'light-sample', 'horizontal-cache');
  const vertical = prefilterPass('vertical', 'vertical-sample', 'prefiltered-cache');
  const nodes: BoundOperatorNode[] = [
    node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'),
    number('zero', 0), number('half', .5), number('one', 1), number('one-and-half', 1.5), number('two', 2),
    number('ten', GLOW_PIXELS_PER_RADIUS), number('tau', 6.283185307179586), number('threshold-width', GLOW_THRESHOLD_SOFTNESS),
    number('softness-offset', GLOW_SOFTNESS_OFFSET), number('coverage-epsilon', 1e-6),
    node('amount', 'values.number', { value: 'amount' }), node('threshold', 'values.number', { value: 'threshold' }),
    node('radius', 'values.number', { value: 'radius' }), node('softness', 'values.number', { value: 'softness' }),
    node('rings', 'values.number', { value: 'rings' }), node('samples', 'values.number', { value: 'samplesPerRing' }),
    // Counts: legacy clamp/truncation, then enough samples per ring for an arc spacing within one ring step.
    number('rings-limit', GLOW_MAX_RINGS), node('rings-clamped', 'math.clamp.scalar'), node('rings-count', 'math.floor.scalar'),
    number('samples-minimum', GLOW_MIN_SAMPLES_PER_RING), number('samples-limit', GLOW_MAX_SAMPLES_PER_RING),
    node('samples-clamped', 'math.clamp.scalar'), node('samples-count', 'math.floor.scalar'),
    node('ring-circumference', 'math.multiply.scalar'), node('ring-circumference-floor', 'math.floor.scalar'), node('samples-needed', 'math.add.scalar'),
    node('samples-adaptive', 'math.max.scalar'), node('samples-effective', 'math.min.scalar'), node('sample-share', 'math.divide-ieee.scalar'),
    // Spacing → prefilter size. A capped sample count widens the prefilter instead of leaving gaps.
    node('ring-step', 'math.multiply.scalar'), node('ring-step-magnitude', 'math.abs.scalar'), node('outer-arc-ratio', 'math.divide-ieee.scalar'),
    node('spacing-ratio', 'math.max.scalar'), node('sample-spacing', 'math.multiply.scalar'), node('prefilter-sigma-raw', 'math.multiply.scalar'),
    number('prefilter-sigma-minimum', GLOW_MIN_PREFILTER_SIGMA_PX), node('prefilter-sigma', 'math.max.scalar'),
    node('prefilter-reach', 'math.multiply.scalar'), node('prefilter-reach-floor', 'math.floor.scalar'), node('prefilter-taps-needed', 'math.add.scalar'),
    number('prefilter-taps-limit', GLOW_MAX_PREFILTER_TAPS_PER_SIDE), node('prefilter-taps', 'math.min.scalar'), node('prefilter-width', 'math.multiply.scalar'),
    // Bright pass on each horizontal tap, weighted by source coverage (straight alpha).
    node('sample', 'image.sample'), node('threshold-low', 'math.subtract.scalar'), node('threshold-high', 'math.add.scalar'),
    node('sample-luma', 'color.luminance-rec709.image'), node('sample-bright', 'math.smoothstep.scalar'), node('bright-sample', 'math.multiply.image-scalar'),
    node('sample-split', 'vector.split.rgba'), node('sample-alpha', 'convert.alpha-to-scalar'), node('light-sample', 'math.multiply.image-scalar'),
    ...horizontal.nodes, node('vertical-sample', 'image.sample'), ...vertical.nodes,
    // Rings over the prefiltered light; pixel offsets are converted per axis.
    node('kernel-index', 'image.kernel-index'), node('index-components', 'vector.split.vec2'),
    node('ring', 'math.add.scalar'), node('angle-turn', 'math.multiply.scalar'), node('angle-base', 'math.divide-ieee.scalar'),
    number('ring-stagger', GLOW_RING_STAGGER), node('angle-stagger', 'math.multiply.scalar'), node('angle', 'math.add.scalar'), node('direction', 'vector.unit-direction.scalar'),
    node('ring-radius', 'math.multiply.scalar'), node('ring-offset-px', 'math.multiply.vec2-scalar'), node('ring-offset', 'math.divide-ieee.vec2'),
    node('ring-sample-uv', 'math.add.vec2'), node('ring-sample', 'image.sample'),
    node('ring-progress', 'math.divide-ieee.scalar'), node('gaussian-sigma', 'math.add.scalar'), node('ring-weight', 'math.gaussian.scalar'), node('sample-weight', 'math.multiply.scalar'),
    node('reduce', 'image.kernel-rect-reduce'), node('reduced-rgb', 'convert.vec4-to-rgb'),
    // Resolve: premultiplied source + glow; alpha grows just enough to carry the halo.
    node('center-split', 'vector.split.rgba'), node('center-alpha', 'convert.alpha-to-scalar'), node('center-luma', 'color.luminance-rec709.image'),
    node('center-bright', 'math.smoothstep.scalar'), node('center-lit', 'math.multiply.rgb-scalar'), node('center-light', 'math.multiply.rgb-scalar'),
    number('center-weight', GLOW_CENTER_WEIGHT), node('center-double', 'math.multiply.rgb-scalar'),
    node('glow-sum', 'math.add.rgb'), node('total-weight', 'math.add.scalar'), node('glow-average', 'math.divide-ieee.rgb-scalar'),
    number('amount-gain', GLOW_AMOUNT_GAIN), node('amount-scaled-glow', 'math.multiply.rgb-scalar'), node('scaled-glow', 'math.multiply.rgb-scalar'),
    node('premultiplied', 'math.multiply.rgb-scalar'), node('result', 'math.add.rgb'), node('result-peak', 'vector.reduce-max.rgb'),
    node('coverage', 'math.max.scalar'), node('coverage-clamped', 'math.clamp.scalar'), node('safe-coverage', 'math.max.scalar'),
    node('unpremultiplied', 'math.divide-ieee.rgb-scalar'), node('clamped', 'math.clamp.rgb-scalar'), node('coverage-alpha', 'convert.scalar-to-alpha'),
    node('combine', 'vector.combine.rgba'), node('output', 'image.output'),
  ];
  const edges: OperatorEdge[] = [
    edge('rings', 'value', 'rings-clamped', 'value'), edge('one', 'value', 'rings-clamped', 'min'), edge('rings-limit', 'value', 'rings-clamped', 'max'), edge('rings-clamped', 'value', 'rings-count', 'value'),
    edge('samples', 'value', 'samples-clamped', 'value'), edge('samples-minimum', 'value', 'samples-clamped', 'min'), edge('samples-limit', 'value', 'samples-clamped', 'max'), edge('samples-clamped', 'value', 'samples-count', 'value'),
    edge('tau', 'value', 'ring-circumference', 'a'), edge('rings-count', 'value', 'ring-circumference', 'b'), edge('ring-circumference', 'value', 'ring-circumference-floor', 'value'),
    edge('ring-circumference-floor', 'value', 'samples-needed', 'a'), edge('one', 'value', 'samples-needed', 'b'),
    edge('samples-count', 'value', 'samples-adaptive', 'a'), edge('samples-needed', 'value', 'samples-adaptive', 'b'),
    edge('samples-adaptive', 'value', 'samples-effective', 'a'), edge('samples-limit', 'value', 'samples-effective', 'b'),
    edge('samples-count', 'value', 'sample-share', 'a'), edge('samples-effective', 'value', 'sample-share', 'b'),
    edge('radius', 'value', 'ring-step', 'a'), edge('ten', 'value', 'ring-step', 'b'), edge('ring-step', 'value', 'ring-step-magnitude', 'value'),
    edge('ring-circumference', 'value', 'outer-arc-ratio', 'a'), edge('samples-effective', 'value', 'outer-arc-ratio', 'b'),
    edge('one', 'value', 'spacing-ratio', 'a'), edge('outer-arc-ratio', 'value', 'spacing-ratio', 'b'),
    edge('ring-step-magnitude', 'value', 'sample-spacing', 'a'), edge('spacing-ratio', 'value', 'sample-spacing', 'b'),
    edge('sample-spacing', 'value', 'prefilter-sigma-raw', 'a'), edge('half', 'value', 'prefilter-sigma-raw', 'b'),
    edge('prefilter-sigma-raw', 'value', 'prefilter-sigma', 'a'), edge('prefilter-sigma-minimum', 'value', 'prefilter-sigma', 'b'),
    edge('prefilter-sigma', 'value', 'prefilter-reach', 'a'), edge('one-and-half', 'value', 'prefilter-reach', 'b'),
    edge('prefilter-reach', 'value', 'prefilter-reach-floor', 'value'), edge('prefilter-reach-floor', 'value', 'prefilter-taps-needed', 'a'), edge('one', 'value', 'prefilter-taps-needed', 'b'),
    edge('prefilter-taps-needed', 'value', 'prefilter-taps', 'a'), edge('prefilter-taps-limit', 'value', 'prefilter-taps', 'b'),
    edge('prefilter-taps', 'value', 'prefilter-width', 'a'), edge('two', 'value', 'prefilter-width', 'b'),
    edge('frame', 'image', 'sample', 'image'), edge('horizontal-sample-uv', 'value', 'sample', 'uv'),
    edge('threshold', 'value', 'threshold-low', 'a'), edge('threshold-width', 'value', 'threshold-low', 'b'), edge('threshold', 'value', 'threshold-high', 'a'), edge('threshold-width', 'value', 'threshold-high', 'b'),
    edge('sample', 'image', 'sample-luma', 'image'), edge('threshold-low', 'value', 'sample-bright', 'edge0'), edge('threshold-high', 'value', 'sample-bright', 'edge1'), edge('sample-luma', 'value', 'sample-bright', 'value'),
    edge('sample', 'image', 'bright-sample', 'a'), edge('sample-bright', 'value', 'bright-sample', 'b'),
    edge('sample', 'image', 'sample-split', 'image'), edge('sample-split', 'alpha', 'sample-alpha', 'alpha'),
    edge('bright-sample', 'value', 'light-sample', 'a'), edge('sample-alpha', 'value', 'light-sample', 'b'),
    ...horizontal.edges,
    edge('horizontal-cache', 'image', 'vertical-sample', 'image'), edge('vertical-sample-uv', 'value', 'vertical-sample', 'uv'),
    ...vertical.edges,
    edge('kernel-index', 'value', 'index-components', 'value'),
    edge('index-components', 'x', 'ring', 'a'), edge('one', 'value', 'ring', 'b'),
    edge('index-components', 'y', 'angle-turn', 'a'), edge('tau', 'value', 'angle-turn', 'b'), edge('angle-turn', 'value', 'angle-base', 'a'), edge('samples-effective', 'value', 'angle-base', 'b'),
    edge('ring', 'value', 'angle-stagger', 'a'), edge('ring-stagger', 'value', 'angle-stagger', 'b'), edge('angle-base', 'value', 'angle', 'a'), edge('angle-stagger', 'value', 'angle', 'b'), edge('angle', 'value', 'direction', 'angle'),
    edge('ring', 'value', 'ring-radius', 'a'), edge('ring-step', 'value', 'ring-radius', 'b'),
    edge('direction', 'value', 'ring-offset-px', 'a'), edge('ring-radius', 'value', 'ring-offset-px', 'b'),
    edge('ring-offset-px', 'value', 'ring-offset', 'a'), edge('resolution', 'value', 'ring-offset', 'b'),
    edge('uv', 'uv', 'ring-sample-uv', 'a'), edge('ring-offset', 'value', 'ring-sample-uv', 'b'),
    edge('prefiltered-cache', 'image', 'ring-sample', 'image'), edge('ring-sample-uv', 'value', 'ring-sample', 'uv'),
    edge('ring', 'value', 'ring-progress', 'a'), edge('rings-count', 'value', 'ring-progress', 'b'),
    edge('softness', 'value', 'gaussian-sigma', 'a'), edge('softness-offset', 'value', 'gaussian-sigma', 'b'),
    edge('ring-progress', 'value', 'ring-weight', 'value'), edge('gaussian-sigma', 'value', 'ring-weight', 'sigma'),
    edge('ring-weight', 'value', 'sample-weight', 'a'), edge('sample-share', 'value', 'sample-weight', 'b'),
    edge('ring-sample', 'image', 'reduce', 'sample'), edge('sample-weight', 'value', 'reduce', 'weight'),
    edge('rings-count', 'value', 'reduce', 'width'), edge('samples-effective', 'value', 'reduce', 'height'), edge('reduce', 'sum', 'reduced-rgb', 'value'),
    edge('frame', 'image', 'center-split', 'image'), edge('center-split', 'alpha', 'center-alpha', 'alpha'), edge('frame', 'image', 'center-luma', 'image'),
    edge('threshold-low', 'value', 'center-bright', 'edge0'), edge('threshold-high', 'value', 'center-bright', 'edge1'), edge('center-luma', 'value', 'center-bright', 'value'),
    edge('center-split', 'rgb', 'center-lit', 'a'), edge('center-bright', 'value', 'center-lit', 'b'),
    edge('center-lit', 'value', 'center-light', 'a'), edge('center-alpha', 'value', 'center-light', 'b'),
    edge('center-light', 'value', 'center-double', 'a'), edge('center-weight', 'value', 'center-double', 'b'),
    edge('reduced-rgb', 'rgb', 'glow-sum', 'a'), edge('center-double', 'value', 'glow-sum', 'b'),
    edge('reduce', 'weightSum', 'total-weight', 'a'), edge('center-weight', 'value', 'total-weight', 'b'),
    edge('glow-sum', 'value', 'glow-average', 'a'), edge('total-weight', 'value', 'glow-average', 'b'),
    edge('glow-average', 'value', 'amount-scaled-glow', 'a'), edge('amount', 'value', 'amount-scaled-glow', 'b'),
    edge('amount-scaled-glow', 'value', 'scaled-glow', 'a'), edge('amount-gain', 'value', 'scaled-glow', 'b'),
    edge('center-split', 'rgb', 'premultiplied', 'a'), edge('center-alpha', 'value', 'premultiplied', 'b'),
    edge('premultiplied', 'value', 'result', 'a'), edge('scaled-glow', 'value', 'result', 'b'), edge('result', 'value', 'result-peak', 'rgb'),
    edge('center-alpha', 'value', 'coverage', 'a'), edge('result-peak', 'value', 'coverage', 'b'),
    edge('coverage', 'value', 'coverage-clamped', 'value'), edge('zero', 'value', 'coverage-clamped', 'min'), edge('one', 'value', 'coverage-clamped', 'max'),
    edge('coverage-clamped', 'value', 'safe-coverage', 'a'), edge('coverage-epsilon', 'value', 'safe-coverage', 'b'),
    edge('result', 'value', 'unpremultiplied', 'a'), edge('safe-coverage', 'value', 'unpremultiplied', 'b'),
    edge('unpremultiplied', 'value', 'clamped', 'value'), edge('zero', 'value', 'clamped', 'min'), edge('one', 'value', 'clamped', 'max'),
    edge('coverage-clamped', 'value', 'coverage-alpha', 'value'),
    edge('clamped', 'value', 'combine', 'rgb'), edge('coverage-alpha', 'alpha', 'combine', 'alpha'), edge('combine', 'image', 'output', 'image'),
  ];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: gridLayout(nodes) };
}
