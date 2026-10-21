import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { EDGE_GAIN, EDGE_MAX_REACH_PX, EDGE_MIN_SIGMA_PX, EDGE_MIN_WIDTH, EDGE_REFERENCE_HEIGHT, EDGE_VIVID_FLOOR } from '../../effects/stylize/edge-detect/edgeDetectModel';
import { BlurGraphBuilder } from './blurGraphBuilder';

const node = (id: string, operator: string, bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): BoundOperatorNode =>
  ({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
const number = (id: string, value: number) => node(id, 'values.number', {}, { value });
const edge = (from: string, output: string, to: string, input: string): OperatorEdge =>
  ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

/**
 * The earlier Edge Detect (before 2026-10-21): eight-tap Sobel of straight brightness at the
 * render resolution, preserving the legacy scalar expression order. Saved projects keep it.
 */
export function createEarlierEdgeDetectGraph(): EffectOperatorGraph {
  const taps = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br'] as const;
  const nodes: BoundOperatorNode[] = [
    node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'), number('zero', 0), number('one', 1),
    node('one-vec2', 'convert.scalar-to-vec2'), node('texel', 'math.divide-ieee.vec2'), node('texel-split', 'vector.split.vec2'),
    node('horizontal', 'vector.combine.vec2'), node('vertical', 'vector.combine.vec2'),
    node('l-uv', 'math.subtract.vec2'), node('r-uv', 'math.add.vec2'), node('t-uv', 'math.subtract.vec2'), node('b-uv', 'math.add.vec2'),
    node('tl-uv', 'math.subtract.vec2'), node('bl-uv', 'math.add.vec2'), node('tr-uv', 'math.subtract.vec2'), node('br-uv', 'math.add.vec2'),
    ...taps.flatMap(id => [node(`${id}-sample`, 'image.sample'), node(id, 'color.luminance-rec709.image')]),
    number('two', 2), node('negative-tl', 'math.subtract.scalar'), node('two-l', 'math.multiply.scalar'), node('gx-left-mid', 'math.subtract.scalar'),
    node('gx-left', 'math.subtract.scalar'), node('gx-tr', 'math.add.scalar'), node('two-r', 'math.multiply.scalar'), node('gx-right-mid', 'math.add.scalar'),
    node('gx', 'math.add.scalar'), node('two-t', 'math.multiply.scalar'), node('gy-top-mid', 'math.subtract.scalar'), node('gy-top', 'math.subtract.scalar'),
    node('gy-bl', 'math.add.scalar'), node('two-b', 'math.multiply.scalar'), node('gy-bottom-mid', 'math.add.scalar'), node('gy', 'math.add.scalar'),
    node('gradient', 'vector.combine.vec2'), node('gradient-dot', 'vector.dot.vec2'), node('magnitude', 'math.sqrt.scalar'),
    node('strength', 'values.number', { value: 'strength' }), node('scaled', 'math.multiply.scalar'), node('clamped', 'math.clamp.scalar'),
    node('inverse', 'math.subtract.scalar'), node('invert', 'values.boolean', { value: 'invert' }), node('selected', 'select.scalar'),
    node('rgba', 'vector.combine.vec4'), node('image', 'convert.vec4-to-image'), node('output', 'image.output'),
  ];
  const edges: OperatorEdge[] = [
    edge('one', 'value', 'one-vec2', 'value'), edge('one-vec2', 'value', 'texel', 'a'), edge('resolution', 'value', 'texel', 'b'),
    edge('texel', 'value', 'texel-split', 'value'), edge('texel-split', 'x', 'horizontal', 'x'), edge('zero', 'value', 'horizontal', 'y'),
    edge('zero', 'value', 'vertical', 'x'), edge('texel-split', 'y', 'vertical', 'y'),
    edge('uv', 'uv', 'l-uv', 'a'), edge('horizontal', 'value', 'l-uv', 'b'), edge('uv', 'uv', 'r-uv', 'a'), edge('horizontal', 'value', 'r-uv', 'b'),
    edge('uv', 'uv', 't-uv', 'a'), edge('vertical', 'value', 't-uv', 'b'), edge('uv', 'uv', 'b-uv', 'a'), edge('vertical', 'value', 'b-uv', 'b'),
    edge('l-uv', 'value', 'tl-uv', 'a'), edge('vertical', 'value', 'tl-uv', 'b'), edge('l-uv', 'value', 'bl-uv', 'a'), edge('vertical', 'value', 'bl-uv', 'b'),
    edge('r-uv', 'value', 'tr-uv', 'a'), edge('vertical', 'value', 'tr-uv', 'b'), edge('r-uv', 'value', 'br-uv', 'a'), edge('vertical', 'value', 'br-uv', 'b'),
    ...taps.flatMap(id => [edge('frame', 'image', `${id}-sample`, 'image'), edge(`${id}-uv`, 'value', `${id}-sample`, 'uv'), edge(`${id}-sample`, 'image', id, 'image')]),
    edge('zero', 'value', 'negative-tl', 'a'), edge('tl', 'value', 'negative-tl', 'b'), edge('two', 'value', 'two-l', 'a'), edge('l', 'value', 'two-l', 'b'),
    edge('negative-tl', 'value', 'gx-left-mid', 'a'), edge('two-l', 'value', 'gx-left-mid', 'b'), edge('gx-left-mid', 'value', 'gx-left', 'a'), edge('bl', 'value', 'gx-left', 'b'),
    edge('gx-left', 'value', 'gx-tr', 'a'), edge('tr', 'value', 'gx-tr', 'b'), edge('two', 'value', 'two-r', 'a'), edge('r', 'value', 'two-r', 'b'),
    edge('gx-tr', 'value', 'gx-right-mid', 'a'), edge('two-r', 'value', 'gx-right-mid', 'b'), edge('gx-right-mid', 'value', 'gx', 'a'), edge('br', 'value', 'gx', 'b'),
    edge('two', 'value', 'two-t', 'a'), edge('t', 'value', 'two-t', 'b'), edge('negative-tl', 'value', 'gy-top-mid', 'a'), edge('two-t', 'value', 'gy-top-mid', 'b'),
    edge('gy-top-mid', 'value', 'gy-top', 'a'), edge('tr', 'value', 'gy-top', 'b'), edge('gy-top', 'value', 'gy-bl', 'a'), edge('bl', 'value', 'gy-bl', 'b'),
    edge('two', 'value', 'two-b', 'a'), edge('b', 'value', 'two-b', 'b'), edge('gy-bl', 'value', 'gy-bottom-mid', 'a'), edge('two-b', 'value', 'gy-bottom-mid', 'b'),
    edge('gy-bottom-mid', 'value', 'gy', 'a'), edge('br', 'value', 'gy', 'b'), edge('gx', 'value', 'gradient', 'x'), edge('gy', 'value', 'gradient', 'y'),
    edge('gradient', 'value', 'gradient-dot', 'a'), edge('gradient', 'value', 'gradient-dot', 'b'), edge('gradient-dot', 'value', 'magnitude', 'value'),
    edge('magnitude', 'value', 'scaled', 'a'), edge('strength', 'value', 'scaled', 'b'), edge('scaled', 'value', 'clamped', 'value'),
    edge('zero', 'value', 'clamped', 'min'), edge('one', 'value', 'clamped', 'max'), edge('one', 'value', 'inverse', 'a'), edge('clamped', 'value', 'inverse', 'b'),
    edge('clamped', 'value', 'selected', 'falseValue'), edge('inverse', 'value', 'selected', 'trueValue'), edge('invert', 'value', 'selected', 'condition'),
    edge('selected', 'value', 'rgba', 'x'), edge('selected', 'value', 'rgba', 'y'), edge('selected', 'value', 'rgba', 'z'), edge('one', 'value', 'rgba', 'w'),
    edge('rgba', 'value', 'image', 'value'), edge('image', 'image', 'output', 'image'),
  ];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges,
    layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: (index % 8) * 280, y: Math.floor(index / 8) * 360 }])) };
}

/**
 * Edge Detect v2 (contract in `effects/stylize/edge-detect/edgeDetectModel.ts`): a
 * derivative-of-Gaussian gradient of premultiplied brightness from one window reduction,
 * normalized by the window's own second moment (exact for ramps at every Width and resolution),
 * and line/background colours. One fullscreen pass.
 */
export function createDefaultEdgeDetectGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2);
  const strength = g.bound('strength', 'strength'), width = g.bound('width', 'width');
  const invert = g.bound('invert', 'invert', 'values.boolean'), colorize = g.bound('colorize', 'colorize');

  // Scale: sigma = Width pixels of a 1080p frame (at least EDGE_MIN_SIGMA_PX); the window reaches two sigma (capped).
  g.number('reference-height', EDGE_REFERENCE_HEIGHT); g.number('width-minimum', EDGE_MIN_WIDTH);
  g.number('sigma-minimum', EDGE_MIN_SIGMA_PX); g.number('reach-limit', EDGE_MAX_REACH_PX);
  const pixelScale = g.binary('pixel-scale', 'math.divide-ieee.scalar', g.unary('short-side', 'vector.reduce-min.vec2', 'resolution'), 'reference-height');
  const sigmaRaw = g.binary('sigma-raw', 'math.multiply.scalar', g.binary('width-safe', 'math.max.scalar', width, 'width-minimum'), pixelScale);
  const sigma = g.binary('sigma', 'math.max.scalar', sigmaRaw, 'sigma-minimum');
  const reach = g.binary('reach', 'math.min.scalar', g.unary('reach-needed', 'math.ceil.scalar', g.binary('two-sigma', 'math.multiply.scalar', sigma, 'two')), 'reach-limit');
  const span = g.binary('window-size', 'math.add.scalar', g.binary('reach-double', 'math.multiply.scalar', reach, 'two'), 'one');

  // Window taps at whole-pixel offsets (texel centres, so premultiplying each tap is exact), Gaussian weights.
  const index = g.add('window-index', 'vector.split.vec2', { value: g.add('window-kernel', 'image.kernel-index') });
  const dx = g.binary('tap-x', 'math.subtract.scalar', [index, 'x'], reach), dy = g.binary('tap-y', 'math.subtract.scalar', [index, 'y'], reach);
  const offset = g.add('tap-offset', 'vector.combine.vec2', { x: dx, y: dy });
  const sampleUv = g.binary('tap-uv', 'math.add.vec2', ['uv', 'uv'], g.binary('tap-offset-uv', 'math.divide-ieee.vec2', offset, 'resolution'));
  const weight = g.add('tap-weight', 'math.gaussian.scalar', { value: g.unary('tap-distance', 'vector.length.vec2', offset), sigma });
  const tap = g.add('tap-split', 'vector.split.rgba', { image: [g.add('tap-sample', 'image.sample', { image: ['frame', 'image'], uv: sampleUv }), 'image'] });
  const tapLuma = g.binary('tap-luma', 'math.multiply.scalar', g.add('tap-luma-straight', 'color.luminance-rec709.rgb', { rgb: [tap, 'rgb'] }),
    g.add('tap-alpha', 'convert.alpha-to-scalar', { alpha: [tap, 'alpha'] }));
  // Moments: brightness times offset (x, y), the offset's square (z) and one (w).
  const moment = g.add('tap-moment', 'convert.vec4-to-image', { value: g.add('tap-moment-vec4', 'vector.combine.vec4', {
    x: g.binary('tap-moment-x', 'math.multiply.scalar', tapLuma, dx), y: g.binary('tap-moment-y', 'math.multiply.scalar', tapLuma, dy),
    z: g.binary('tap-x-squared', 'math.multiply.scalar', dx, dx), w: 'one' }) });
  const reduce = g.add('window-reduce', 'image.kernel-rect-reduce', { sample: [moment, 'image'], weight, width: span, height: span });

  // Edge contrast: |sum w L d| / sqrt(sum w dx^2 * sum w) * sqrt(2 pi): a step of contrast c reads about c.
  const sums = g.add('window-sums', 'vector.split.vec4', { value: [reduce, 'sum'] });
  const gradient = g.unary('gradient-length', 'vector.length.vec2', g.add('gradient-sums', 'vector.combine.vec2', { x: [sums, 'x'], y: [sums, 'y'] }));
  const spread = g.unary('window-spread', 'math.sqrt.scalar', g.binary('window-moments', 'math.max.scalar',
    g.binary('window-moment-product', 'math.multiply.scalar', [sums, 'z'], [sums, 'w']), g.number('moment-floor', 1e-12)));
  g.number('step-scale', Math.sqrt(2 * Math.PI) * EDGE_GAIN);
  const contrast = g.binary('edge-contrast', 'math.multiply.scalar', g.binary('gradient-normalized', 'math.divide-ieee.scalar', gradient, spread), 'step-scale');
  const edge = g.add('edge', 'math.clamp.scalar', { value: g.binary('edge-raw', 'math.multiply.scalar', contrast,
    g.binary('strength-safe', 'math.max.scalar', strength, 'zero')), min: 'zero', max: 'one' });

  // Colours: lines white (Invert: black) or the picture's own colour at full brightness; background the opposite.
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const vivid = g.add('vivid', 'math.divide-ieee.rgb-scalar', { a: [source, 'rgb'], b: g.binary('vivid-peak', 'math.max.scalar',
    g.add('source-peak', 'vector.reduce-max.rgb', { rgb: [source, 'rgb'] }), g.number('vivid-floor', EDGE_VIVID_FLOOR)) });
  const plainLine = g.add('plain-line', 'select.scalar', { falseValue: 'one', trueValue: 'zero', condition: invert });
  const background = g.add('background', 'select.scalar', { falseValue: 'zero', trueValue: 'one', condition: invert });
  const lineColor = g.add('line-color', 'math.mix.rgb', { a: [g.add('plain-line-rgb', 'convert.scalar-to-rgb', { value: plainLine }), 'rgb'], b: vivid,
    t: g.add('colorize-limited', 'math.clamp.scalar', { value: colorize, min: 'zero', max: 'one' }) });
  const rgb = g.add('edge-rgb', 'math.mix.rgb', { a: [g.add('background-rgb', 'convert.scalar-to-rgb', { value: background }), 'rgb'], b: lineColor, t: edge });
  // Outlines also show outside a layer: alpha is the larger of the source alpha and the edge.
  const alpha = g.binary('edge-alpha', 'math.max.scalar', g.add('source-alpha', 'convert.alpha-to-scalar', { alpha: [source, 'alpha'] }), edge);
  const output = g.add('combine', 'vector.combine.rgba', { rgb, alpha: [g.add('edge-alpha-port', 'convert.scalar-to-alpha', { value: alpha }), 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
