import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { BlurGraphBuilder, premultipliedSourceCache, unpremultiplyNodes, type GraphPort } from './blurGraphBuilder';

/**
 * Kaleidoscope, Mirror and RGB Split recipes (see docs/Features/effects/kaleidoscope.md, mirror.md and rgb-split.md).
 *
 * - Frame space: offsets from the centre are measured in units of the shorter frame side, so
 *   kaleidoscope wedges stay round and angles are on-screen angles on any aspect ratio.
 *   Kaleidoscope's Shape "frame" measures each axis in its own UV unit instead (the original,
 *   stretched look).
 * - Kaleidoscope: angle a = atan2(p) + Rotation, folded into one mirrored wedge of 360°/n
 *   (a Mirror Repeat node), turned by Source Angle and read at radius |p| / Zoom. A fractional
 *   segment count crossfades the patterns of the two neighbouring whole counts, so animated
 *   counts change smoothly and no wedge is ever cut open (no seam).
 * - Mirror: the offset is turned by -Angle, each enabled axis keeps one side (|x| with the
 *   kept side's sign) and the result is turned back, so the mirror line runs through Centre at
 *   Angle. The reflection is continuous at the line: no gap and no doubled row.
 * - RGB Split: red reads at +offset, green at the pixel, blue at -offset. Offset mode: the
 *   on-screen Angle with the original length, Amount × |(cos·W, sin·H)| pixels (a share of the
 *   width when horizontal, of the height when vertical). Lens mode: red is magnified and blue
 *   shrunk about the frame centre by 2·Amount, so the split is 0 in the centre and Amount × W
 *   at the left and right edges.
 * - Every read takes the premultiplied rgba16float copy of the frame (`source-cache`) and the
 *   result is unpremultiplied, so filtered reads never mix the colour of a transparent texel
 *   into a visible one. RGB Split's alpha is the largest of its three reads, so a split logo on
 *   transparency shows its coloured fringes.
 * - Frame edges: Mirror reflects reads that leave the frame, Clamp repeats the border pixel
 *   (the original behaviour), Transparent leaves them empty with a one-pixel soft edge.
 */
export const KALEIDOSCOPE_MIN_SEGMENTS = 2;
export const KALEIDOSCOPE_MAX_SEGMENTS = 64;
export const KALEIDOSCOPE_MIN_ZOOM = 0.01;
/** Lens mode: red/blue scale per unit of Amount (2: the split at the left and right edges equals Amount × width). */
export const RGB_SPLIT_LENS_SCALE = 2;
export const RGB_SPLIT_MODE_OPTIONS = [{ value: 'offset', label: 'Offset' }, { value: 'lens', label: 'Lens' }];
export const MIRROR_KEEP_OPTIONS = [{ value: 'start', label: 'Left / Top' }, { value: 'end', label: 'Right / Bottom' }];

function sources(g: BlurGraphBuilder): void {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5);
  g.unary('one-vec2', 'convert.scalar-to-vec2', 'one');
}

/** Centre (bound) and the offset `space-p` from it in units of the shorter frame side (or per axis with Shape "frame"). */
function frameSpace(g: BlurGraphBuilder, stretchable: boolean): string {
  const centerX = g.bound('space-center-x', 'centerX'), centerY = g.bound('space-center-y', 'centerY');
  g.add('space-center', 'vector.combine.vec2', { x: centerX, y: centerY });
  g.add('space-resolution-split', 'vector.split.vec2', { value: ['resolution', 'value'] });
  g.binary('space-short-side', 'math.min.scalar', ['space-resolution-split', 'x'], ['space-resolution-split', 'y']);
  const circle = g.add(stretchable ? 'space-circle-scale' : 'space-scale', 'math.divide-ieee.vec2-scalar', { a: ['resolution', 'value'], b: 'space-short-side' });
  if (stretchable) {
    g.bound('space-shape', 'shape', 'values.choice');
    g.add('space-stretched', 'compare.greater.scalar', { a: 'space-shape', b: 'half' });
    g.add('space-scale', 'select.vec2', { condition: ['space-stretched', 'condition'], falseValue: circle, trueValue: 'one-vec2' });
  }
  g.add('space-delta', 'math.subtract.vec2', { a: ['uv', 'uv'], b: 'space-center' });
  return g.binary('space-p', 'math.multiply.vec2', 'space-delta', 'space-scale');
}

/** An offset in frame-space units back to a read position (UV). */
function toUv(g: BlurGraphBuilder, prefix: string, moved: GraphPort): string {
  g.binary(`${prefix}-delta`, 'math.divide-ieee.vec2', moved, 'space-scale');
  return g.binary(`${prefix}-uv`, 'math.add.vec2', 'space-center', `${prefix}-delta`);
}

/** Shared frame-edge controls and the premultiplied source every read uses. */
function edgeSetup(g: BlurGraphBuilder): void {
  premultipliedSourceCache(g);
  g.bound('edge-mode', 'edges', 'values.choice');
  g.number('edge-clamp-threshold', .5); g.number('edge-transparent-threshold', 1.5);
  g.add('edge-not-mirror', 'compare.greater.scalar', { a: 'edge-mode', b: 'edge-clamp-threshold' });
  g.add('edge-transparent', 'compare.greater.scalar', { a: 'edge-mode', b: 'edge-transparent-threshold' });
  g.unary('edge-zero-vec2', 'convert.scalar-to-vec2', 'zero');
}

/**
 * One premultiplied read at `uv` with the frame-edge mode applied. Transparent scales the read by
 * its coverage inside the frame (one source pixel soft), which lowers alpha only once the result
 * is unpremultiplied.
 */
function edgeRead(g: BlurGraphBuilder, prefix: string, uv: GraphPort): GraphPort {
  g.add(`${prefix}-mirrored-uv`, 'coordinates.mirror-repeat.vec2', { value: uv });
  g.add(`${prefix}-clamped-uv`, 'math.clamp.vec2', { value: uv, min: 'edge-zero-vec2', max: 'one-vec2' });
  g.add(`${prefix}-edge-uv`, 'select.vec2', { condition: ['edge-not-mirror', 'condition'], falseValue: `${prefix}-mirrored-uv`, trueValue: `${prefix}-clamped-uv` });
  g.add(`${prefix}-sample`, 'image.sample', { image: ['source-cache', 'image'], uv: `${prefix}-edge-uv` });
  g.binary(`${prefix}-low-px`, 'math.multiply.vec2', uv, ['resolution', 'value']);
  g.binary(`${prefix}-high-uv`, 'math.subtract.vec2', 'one-vec2', uv);
  g.binary(`${prefix}-high-px`, 'math.multiply.vec2', `${prefix}-high-uv`, ['resolution', 'value']);
  g.add(`${prefix}-low-min`, 'vector.reduce-min.vec2', { value: `${prefix}-low-px` });
  g.add(`${prefix}-high-min`, 'vector.reduce-min.vec2', { value: `${prefix}-high-px` });
  g.binary(`${prefix}-inside-px`, 'math.min.scalar', `${prefix}-low-min`, `${prefix}-high-min`);
  g.binary(`${prefix}-inside-centered`, 'math.add.scalar', `${prefix}-inside-px`, 'half');
  g.add(`${prefix}-coverage`, 'math.clamp.scalar', { value: `${prefix}-inside-centered`, min: 'zero', max: 'one' });
  g.add(`${prefix}-weight`, 'select.scalar', { condition: ['edge-transparent', 'condition'], falseValue: 'one', trueValue: `${prefix}-coverage` });
  return [g.add(`${prefix}-read`, 'math.multiply.image-scalar', { a: [`${prefix}-sample`, 'image'], b: `${prefix}-weight` }), 'value'];
}

/** One fold for a whole segment count: angle → its mirrored wedge (a Mirror Repeat), turned by Source Angle and read. */
function kaleidoscopeFold(g: BlurGraphBuilder, prefix: string, count: GraphPort): GraphPort {
  const wedge = g.binary(`${prefix}-wedge`, 'math.divide-ieee.scalar', 'tau', count);
  // The Mirror Repeat pattern (recognized as one reusable node): 0 … wedge/2 and back.
  const progress = g.binary(`${prefix}-progress`, 'math.divide-ieee.scalar', 'angle', wedge);
  const fraction = g.unary(`${prefix}-fraction`, 'math.fract.scalar', progress);
  const wrapped = g.binary(`${prefix}-wrapped`, 'math.multiply.scalar', fraction, wedge);
  const midpoint = g.binary(`${prefix}-midpoint`, 'math.multiply.scalar', wedge, 'half');
  g.add(`${prefix}-past`, 'compare.greater.scalar', { a: wrapped, b: midpoint });
  const reflected = g.binary(`${prefix}-reflected`, 'math.subtract.scalar', wedge, wrapped);
  const folded = g.add(`${prefix}-folded`, 'select.scalar', { condition: [`${prefix}-past`, 'condition'], falseValue: wrapped, trueValue: reflected });
  const turned = g.binary(`${prefix}-turned`, 'math.add.scalar', folded, 'source-angle');
  const direction = g.add(`${prefix}-direction`, 'vector.unit-direction.scalar', { angle: turned });
  const moved = g.binary(`${prefix}-moved`, 'math.multiply.vec2-scalar', direction, 'read-radius');
  return edgeRead(g, prefix, toUv(g, `${prefix}-position`, moved));
}

export function createDefaultKaleidoscopeGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  const p = frameSpace(g, true);
  edgeSetup(g);
  g.add('space-p-split', 'vector.split.vec2', { value: p });
  g.add('base-angle', 'math.atan2.scalar', { y: ['space-p-split', 'y'], x: ['space-p-split', 'x'] });
  g.bound('rotation', 'rotation');
  g.binary('angle', 'math.add.scalar', 'base-angle', 'rotation');
  g.bound('source-angle', 'sourceAngle');
  g.unary('radius', 'vector.length.vec2', p);
  g.bound('zoom', 'zoom'); g.number('zoom-minimum', KALEIDOSCOPE_MIN_ZOOM);
  g.binary('safe-zoom', 'math.max.scalar', 'zoom', 'zoom-minimum');
  g.binary('read-radius', 'math.divide-ieee.scalar', 'radius', 'safe-zoom');
  g.number('tau', Math.PI * 2);
  g.bound('segments', 'segments');
  g.number('segments-minimum', KALEIDOSCOPE_MIN_SEGMENTS); g.number('segments-maximum', KALEIDOSCOPE_MAX_SEGMENTS);
  g.add('segment-count', 'math.clamp.scalar', { value: 'segments', min: 'segments-minimum', max: 'segments-maximum' });
  g.unary('segments-low', 'math.floor.scalar', 'segment-count');
  g.binary('segments-high', 'math.add.scalar', 'segments-low', 'one');
  g.binary('segments-blend', 'math.subtract.scalar', 'segment-count', 'segments-low');
  const low = kaleidoscopeFold(g, 'fold-low', 'segments-low');
  const high = kaleidoscopeFold(g, 'fold-high', 'segments-high');
  g.add('fold-low-vec4', 'convert.image-to-vec4', { image: low });
  g.add('fold-high-vec4', 'convert.image-to-vec4', { image: high });
  g.add('fold-mix', 'math.mix.vec4', { a: 'fold-low-vec4', b: 'fold-high-vec4', t: 'segments-blend' });
  g.add('fold-image', 'convert.vec4-to-image', { value: 'fold-mix' });
  unpremultiplyNodes(g, ['fold-image', 'image']);
  return g.graph();
}

export function createDefaultMirrorGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  const p = frameSpace(g, false);
  edgeSetup(g);
  g.bound('angle', 'angle');
  g.binary('negative-angle', 'math.subtract.scalar', 'zero', 'angle');
  g.add('local', 'coordinates.rotate.vec2', { value: p, angle: 'negative-angle' });
  g.add('local-split', 'vector.split.vec2', { value: 'local' });
  // Keep: the start side (left / top) reads -|offset|, the end side +|offset|.
  g.bound('keep', 'keep', 'values.choice');
  g.add('keep-end', 'compare.greater.scalar', { a: 'keep', b: 'half' });
  g.number('minus-one', -1);
  g.add('keep-sign', 'select.scalar', { condition: ['keep-end', 'condition'], falseValue: 'minus-one', trueValue: 'one' });
  for (const [axis, parameter] of [['x', 'horizontal'], ['y', 'vertical']] as const) {
    g.unary(`${axis}-magnitude`, 'math.abs.scalar', ['local-split', axis]);
    g.binary(`${axis}-kept`, 'math.multiply.scalar', `${axis}-magnitude`, 'keep-sign');
    g.bound(parameter, parameter, 'values.boolean');
    g.add(`${axis}-mirrored`, 'select.scalar', { condition: parameter, falseValue: ['local-split', axis], trueValue: `${axis}-kept` });
  }
  g.add('reflected', 'vector.combine.vec2', { x: 'x-mirrored', y: 'y-mirrored' });
  g.add('moved', 'coordinates.rotate.vec2', { value: 'reflected', angle: 'angle' });
  const read = edgeRead(g, 'mirror', toUv(g, 'mirror-position', 'moved'));
  unpremultiplyNodes(g, read);
  return g.graph();
}

export function createDefaultRgbSplitGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  sources(g);
  edgeSetup(g);
  g.bound('amount', 'amount'); g.bound('angle', 'angle');
  g.unary('cos', 'math.cos.scalar', 'angle'); g.unary('sin', 'math.sin.scalar', 'angle');
  g.add('direction', 'vector.combine.vec2', { x: 'cos', y: 'sin' });
  // Offset: on-screen direction, the original length Amount × |(cos·W, sin·H)| pixels.
  g.binary('direction-px', 'math.multiply.vec2', 'direction', ['resolution', 'value']);
  g.unary('reach-px', 'vector.length.vec2', 'direction-px');
  g.binary('length-px', 'math.multiply.scalar', 'reach-px', 'amount');
  g.add('offset-px', 'math.multiply.vec2-scalar', { a: 'direction', b: 'length-px' });
  g.binary('linear-offset', 'math.divide-ieee.vec2', 'offset-px', ['resolution', 'value']);
  // Lens: red reads towards the centre (magnified), blue away from it (shrunk).
  g.unary('half-vec2', 'convert.scalar-to-vec2', 'half');
  g.binary('lens-p', 'math.subtract.vec2', ['uv', 'uv'], 'half-vec2');
  g.number('lens-scale-per-amount', -RGB_SPLIT_LENS_SCALE);
  g.binary('lens-scale', 'math.multiply.scalar', 'amount', 'lens-scale-per-amount');
  g.add('lens-offset', 'math.multiply.vec2-scalar', { a: 'lens-p', b: 'lens-scale' });
  g.bound('mode', 'mode', 'values.choice');
  g.add('is-lens', 'compare.greater.scalar', { a: 'mode', b: 'half' });
  g.add('offset', 'select.vec2', { condition: ['is-lens', 'condition'], falseValue: 'linear-offset', trueValue: 'lens-offset' });
  g.binary('red-uv', 'math.add.vec2', ['uv', 'uv'], 'offset');
  g.binary('blue-uv', 'math.subtract.vec2', ['uv', 'uv'], 'offset');
  const red = edgeRead(g, 'red', 'red-uv');
  g.add('green-read', 'image.sample', { image: ['source-cache', 'image'], uv: ['uv', 'uv'] });
  const blue = edgeRead(g, 'blue', 'blue-uv');
  const channels: [string, GraphPort][] = [['red', red], ['green', ['green-read', 'image']], ['blue', blue]];
  for (const [name, read] of channels) {
    g.add(`${name}-vec4`, 'convert.image-to-vec4', { image: read });
    g.add(`${name}-split`, 'vector.split.vec4', { value: `${name}-vec4` });
  }
  // Each plate keeps its own coverage: the union (largest alpha) shows every fringe.
  g.binary('alpha-red-green', 'math.max.scalar', ['red-split', 'w'], ['green-split', 'w']);
  g.binary('alpha', 'math.max.scalar', 'alpha-red-green', ['blue-split', 'w']);
  g.add('combined', 'vector.combine.vec4', { x: ['red-split', 'x'], y: ['green-split', 'y'], z: ['blue-split', 'z'], w: 'alpha' });
  g.add('combined-image', 'convert.vec4-to-image', { value: 'combined' });
  unpremultiplyNodes(g, ['combined-image', 'image']);
  return g.graph();
}
