import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { BlurGraphBuilder, premultipliedSourceCache, unpremultiplyNodes, type GraphPort } from './blurGraphBuilder';

/**
 * Wave, Twirl and Bulge & Pinch recipes (see docs/Features/effects/wave.md, twirl.md and bulge.md).
 *
 * - Frame space: Shape "circle" measures offsets from the centre in units of the shorter
 *   frame side, so circles stay round on any aspect ratio and Radius means the same part
 *   of the picture at every resolution. Shape "frame" measures each axis in its own UV
 *   unit (an ellipse that fills the frame; the original behaviour).
 * - Bulge & Pinch: the offset p becomes p * exp(-beta * (1 - r^2)^2) with r = |p| / radius.
 *   The weight is smooth at the rim (no visible ring) and finite at the centre (no smear).
 *   Amount keeps its meaning: 1 leaves the picture alone, above 1 bulges, below 1 pinches.
 *   beta = ln(max(amount, 1)) - PINCH_BETA_LIMIT * clamp(1 - amount, 0, 1): above 1 the centre is
 *   magnified exactly Amount times (2 = twice as large), pinching stays above beta = -1, which
 *   keeps the mapping monotonic, so a pinch never folds the picture back on itself.
 * - Twirl: rotation of amount * (1 - r)^2 radians about the centre (unchanged curve).
 * - Wave: y += sin(tau * frequencyX * x + phase) * amplitudeX, then
 *   x += sin(tau * frequencyY * y' + phase) * amplitudeY, phase = phase degrees + tau * speed * time.
 * - Frame edges: Mirror reflects samples that leave the frame, Clamp repeats the border
 *   pixel (the original behaviour), Transparent leaves them empty with a one-pixel soft edge
 *   that lowers alpha only.
 * - Alpha: the single bilinear sample reads the frame premultiplied (an rgba16float cache) and
 *   the result is unpremultiplied, so cut-outs and transparent edges keep their colour.
 */
export const PINCH_BETA_LIMIT = 0.95;
export const RADIUS_EPSILON = 1e-4;
export type DistortEdgeMode = 'mirror' | 'clamp' | 'transparent';
export const DISTORT_EDGE_OPTIONS: { value: DistortEdgeMode; label: string }[] = [
  { value: 'mirror', label: 'Mirror' }, { value: 'clamp', label: 'Clamp' }, { value: 'transparent', label: 'Transparent' },
];
export const DISTORT_SHAPE_OPTIONS = [{ value: 'circle', label: 'Circle' }, { value: 'frame', label: 'Stretch to Frame' }];

function sources(g: BlurGraphBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5);
}

/** Centre, shape scale and the centred offset `space-p` in shape units; returns the normalized radius node. */
function frameSpace(g: BlurGraphBuilder): string {
  const centerX = g.bound('space-center-x', 'centerX'), centerY = g.bound('space-center-y', 'centerY');
  g.add('space-center', 'vector.combine.vec2', { x: centerX, y: centerY });
  g.add('space-resolution-split', 'vector.split.vec2', { value: ['resolution', 'value'] });
  g.binary('space-short-side', 'math.min.scalar', ['space-resolution-split', 'x'], ['space-resolution-split', 'y']);
  g.add('space-circle-scale', 'math.divide-ieee.vec2-scalar', { a: ['resolution', 'value'], b: 'space-short-side' });
  g.unary('one-vec2', 'convert.scalar-to-vec2', 'one');
  g.bound('space-shape', 'shape', 'values.choice');
  g.add('space-stretched', 'compare.greater.scalar', { a: 'space-shape', b: 'half' });
  g.add('space-scale', 'select.vec2', { condition: ['space-stretched', 'condition'], falseValue: 'space-circle-scale', trueValue: 'one-vec2' });
  g.add('space-delta', 'math.subtract.vec2', { a: ['uv', 'uv'], b: 'space-center' });
  g.binary('space-p', 'math.multiply.vec2', 'space-delta', 'space-scale');
  g.bound('space-radius', 'radius'); g.number('space-epsilon', RADIUS_EPSILON);
  g.binary('space-safe-radius', 'math.max.scalar', 'space-radius', 'space-epsilon');
  g.unary('space-distance', 'vector.length.vec2', 'space-p');
  return g.binary('space-r', 'math.divide-ieee.scalar', 'space-distance', 'space-safe-radius');
}

/** Moved offset (shape units) back to a source UV. */
function frameSpaceToUv(g: BlurGraphBuilder, moved: GraphPort): string {
  g.binary('space-moved-delta', 'math.divide-ieee.vec2', moved, 'space-scale');
  return g.binary('space-sample-uv', 'math.add.vec2', 'space-center', 'space-moved-delta');
}

/**
 * Frame-edge handling and the single image sample; wires `output`. The sample reads a
 * premultiplied copy of the frame (`source-cache`), so the bilinear filter never mixes the colour
 * of a transparent texel into a visible one: magnified or squeezed cut-outs keep clean edges.
 */
function edgeSampling(g: BlurGraphBuilder, sampleUv: GraphPort): void {
  const source = premultipliedSourceCache(g);
  g.bound('edge-mode', 'edges', 'values.choice');
  g.number('edge-clamp-threshold', .5); g.number('edge-transparent-threshold', 1.5);
  g.add('edge-not-mirror', 'compare.greater.scalar', { a: 'edge-mode', b: 'edge-clamp-threshold' });
  g.add('edge-transparent', 'compare.greater.scalar', { a: 'edge-mode', b: 'edge-transparent-threshold' });
  g.unary('edge-zero-vec2', 'convert.scalar-to-vec2', 'zero');
  g.add('edge-mirrored-uv', 'coordinates.mirror-repeat.vec2', { value: sampleUv });
  g.add('edge-clamped-uv', 'math.clamp.vec2', { value: sampleUv, min: 'edge-zero-vec2', max: 'one-vec2' });
  g.add('edge-uv', 'select.vec2', { condition: ['edge-not-mirror', 'condition'], falseValue: 'edge-mirrored-uv', trueValue: 'edge-clamped-uv' });
  g.add('sample', 'image.sample', { image: [source, 'image'], uv: 'edge-uv' });
  // Transparent: distance inside the frame in source pixels, a one-pixel soft edge. Scaling the
  // premultiplied sample lowers coverage only; the colour is restored by the unpremultiply below.
  g.binary('edge-low-px', 'math.multiply.vec2', sampleUv, ['resolution', 'value']);
  g.binary('edge-high-uv', 'math.subtract.vec2', 'one-vec2', sampleUv);
  g.binary('edge-high-px', 'math.multiply.vec2', 'edge-high-uv', ['resolution', 'value']);
  g.add('edge-low-min', 'vector.reduce-min.vec2', { value: 'edge-low-px' });
  g.add('edge-high-min', 'vector.reduce-min.vec2', { value: 'edge-high-px' });
  g.binary('edge-inside-px', 'math.min.scalar', 'edge-low-min', 'edge-high-min');
  g.binary('edge-inside-centered', 'math.add.scalar', 'edge-inside-px', 'half');
  g.add('edge-coverage', 'math.clamp.scalar', { value: 'edge-inside-centered', min: 'zero', max: 'one' });
  g.add('edge-weight', 'select.scalar', { condition: ['edge-transparent', 'condition'], falseValue: 'one', trueValue: 'edge-coverage' });
  g.add('edge-result', 'math.multiply.image-scalar', { a: ['sample', 'image'], b: 'edge-weight' });
  unpremultiplyNodes(g, ['edge-result', 'value']);
}

export function createDefaultBulgeGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  const r = frameSpace(g);
  g.binary('bulge-r2', 'math.multiply.scalar', r, r);
  g.binary('bulge-inside', 'math.subtract.scalar', 'one', 'bulge-r2');
  g.binary('bulge-inside-clamped', 'math.max.scalar', 'bulge-inside', 'zero');
  g.binary('bulge-weight', 'math.multiply.scalar', 'bulge-inside-clamped', 'bulge-inside-clamped');
  g.bound('bulge-amount', 'amount');
  g.number('pinch-beta-limit', -PINCH_BETA_LIMIT);
  // Branch-free on purpose: animating Amount across 1 only refills a uniform, it never swaps the shader.
  // ln(max(Amount, 1)): the centre magnification equals Amount, and never a log of 0 or less.
  g.binary('bulge-magnification', 'math.max.scalar', 'bulge-amount', 'one');
  g.unary('bulge-beta', 'math.log.scalar', 'bulge-magnification');
  g.binary('pinch-depth-raw', 'math.subtract.scalar', 'one', 'bulge-amount');
  g.add('pinch-depth', 'math.clamp.scalar', { value: 'pinch-depth-raw', min: 'zero', max: 'one' });
  g.binary('pinch-beta', 'math.multiply.scalar', 'pinch-depth', 'pinch-beta-limit');
  g.binary('bulge-strength', 'math.add.scalar', 'bulge-beta', 'pinch-beta');
  g.binary('bulge-weighted', 'math.multiply.scalar', 'bulge-strength', 'bulge-weight');
  g.binary('bulge-exponent', 'math.subtract.scalar', 'zero', 'bulge-weighted');
  g.unary('bulge-scale', 'math.exp.scalar', 'bulge-exponent');
  g.binary('bulge-moved', 'math.multiply.vec2-scalar', 'space-p', 'bulge-scale');
  edgeSampling(g, frameSpaceToUv(g, 'bulge-moved'));
  return g.graph();
}

export function createDefaultTwirlGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  const r = frameSpace(g);
  g.binary('twirl-limited-r', 'math.min.scalar', r, 'one');
  g.binary('twirl-falloff', 'math.subtract.scalar', 'one', 'twirl-limited-r');
  g.binary('twirl-falloff-squared', 'math.multiply.scalar', 'twirl-falloff', 'twirl-falloff');
  g.bound('twirl-amount', 'amount');
  g.binary('twirl-angle', 'math.multiply.scalar', 'twirl-amount', 'twirl-falloff-squared');
  g.add('twirl-moved', 'coordinates.rotate.vec2', { value: 'space-p', angle: 'twirl-angle' });
  edgeSampling(g, frameSpaceToUv(g, 'twirl-moved'));
  return g.graph();
}

export function createDefaultWaveGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  g.unary('one-vec2', 'convert.scalar-to-vec2', 'one');
  g.add('wave-uv-split', 'vector.split.vec2', { value: ['uv', 'uv'] });
  g.number('tau', Math.PI * 2);
  g.add('time', 'image.timeline-time');
  g.bound('phase-degrees', 'phase'); g.bound('phase-speed', 'speed');
  g.unary('phase-offset', 'convert.degrees-to-radians.scalar', 'phase-degrees');
  g.binary('phase-cycles', 'math.multiply.scalar', 'phase-speed', ['time', 'value']);
  g.binary('phase-travel', 'math.multiply.scalar', 'phase-cycles', 'tau');
  g.binary('phase', 'math.add.scalar', 'phase-offset', 'phase-travel');
  g.bound('wave-amplitude-x', 'amplitudeX'); g.bound('wave-amplitude-y', 'amplitudeY');
  g.bound('wave-frequency-x', 'frequencyX'); g.bound('wave-frequency-y', 'frequencyY');
  g.binary('wave-x-cycles', 'math.multiply.scalar', ['wave-uv-split', 'x'], 'wave-frequency-x');
  g.binary('wave-x-angle', 'math.multiply.scalar', 'wave-x-cycles', 'tau');
  g.binary('wave-x-phase', 'math.add.scalar', 'wave-x-angle', 'phase');
  g.unary('wave-y-sine', 'math.sin.scalar', 'wave-x-phase');
  g.binary('wave-y-offset', 'math.multiply.scalar', 'wave-y-sine', 'wave-amplitude-x');
  g.binary('wave-y', 'math.add.scalar', ['wave-uv-split', 'y'], 'wave-y-offset');
  g.binary('wave-y-cycles', 'math.multiply.scalar', 'wave-y', 'wave-frequency-y');
  g.binary('wave-y-angle', 'math.multiply.scalar', 'wave-y-cycles', 'tau');
  g.binary('wave-y-phase', 'math.add.scalar', 'wave-y-angle', 'phase');
  g.unary('wave-x-sine', 'math.sin.scalar', 'wave-y-phase');
  g.binary('wave-x-offset', 'math.multiply.scalar', 'wave-x-sine', 'wave-amplitude-y');
  g.binary('wave-x', 'math.add.scalar', ['wave-uv-split', 'x'], 'wave-x-offset');
  g.add('wave-sample-uv', 'vector.combine.vec2', { x: 'wave-x', y: 'wave-y' });
  edgeSampling(g, 'wave-sample-uv');
  return g.graph();
}
