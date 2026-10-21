import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { VIGNETTE_DITHER, VIGNETTE_MIN_FEATHER_PX } from '../../effects/stylize/vignette/vignetteModel';
import { BlurGraphBuilder } from './blurGraphBuilder';

/**
 * Vignette v2 (contract in `effects/stylize/vignette/vignetteModel.ts`): a pixel-based distance
 * with corners at 1 on any aspect, a Roundness blend from frame shape to circle, an anti-aliased
 * smoothstep falloff and a sub-step dither against banding. One fullscreen pass; alpha is kept.
 */
export function createDefaultVignetteGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('sqrt-two', Math.SQRT2);
  const amount = g.bound('amount', 'amount'), size = g.bound('size', 'size');
  const softness = g.bound('softness', 'softness'), roundness = g.bound('roundness', 'roundness');

  // Distance: per-axis scale blends the frame-shaped ellipse (sqrt 2) and the circle (side / half diagonal).
  const round = g.add('round', 'math.clamp.scalar', { value: roundness, min: 'zero', max: 'one' });
  const halfDiagonal = g.binary('half-diagonal', 'math.multiply.scalar', g.unary('diagonal', 'vector.length.vec2', 'resolution'), 'half');
  const circleScale = g.add('circle-scale', 'math.divide-ieee.vec2-scalar', { a: 'resolution', b: halfDiagonal });
  const frameScale = g.unary('frame-scale', 'convert.scalar-to-vec2', 'sqrt-two');
  const scale = g.binary('axis-scale', 'math.add.vec2', frameScale,
    g.add('axis-blend', 'math.multiply.vec2-scalar', { a: g.binary('axis-span', 'math.subtract.vec2', circleScale, frameScale), b: round }));
  const centered = g.binary('centered', 'math.subtract.vec2', ['uv', 'uv'], g.unary('center', 'convert.scalar-to-vec2', 'half'));
  const scaled = g.binary('scaled', 'math.multiply.vec2', centered, scale);
  const corner = g.binary('corner-distance', 'math.multiply.scalar', g.unary('scale-length', 'vector.length.vec2', scale), 'half');
  const distance = g.binary('distance', 'math.divide-ieee.scalar', g.unary('scaled-length', 'vector.length.vec2', scaled), corner);

  // Falloff from Size to Size + Softness, never narrower than a pixel and a half.
  g.number('minimum-feather-px', VIGNETTE_MIN_FEATHER_PX);
  const minimumFeather = g.binary('minimum-feather', 'math.divide-ieee.scalar', 'minimum-feather-px', halfDiagonal);
  const feather = g.binary('feather', 'math.max.scalar', softness, minimumFeather);
  const falloff = g.add('falloff', 'math.smoothstep.scalar', { edge0: size, edge1: g.binary('outer-edge', 'math.add.scalar', size, feather), value: distance });
  const gain = g.binary('gain', 'math.max.scalar', g.binary('gain-raw', 'math.subtract.scalar', 'one', g.binary('darkening', 'math.multiply.scalar', amount, falloff)), 'zero');

  // Triangular dither of at most half an 8-bit step, only where the gain changes the picture.
  const pixel = g.binary('pixel', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
  const ditherA = g.unary('dither-a', 'noise.cell-hash.vec2', pixel);
  const ditherB = g.unary('dither-b', 'noise.cell-hash.vec2', g.binary('dither-b-pixel', 'math.add.vec2', pixel, g.unary('dither-shift', 'convert.scalar-to-vec2', g.number('dither-offset', 4099))));
  const triangular = g.binary('dither-centered', 'math.subtract.scalar', g.binary('dither-sum', 'math.add.scalar', ditherA, ditherB), 'one');
  const active = g.add('dither-active', 'math.clamp.scalar', { value: g.binary('dither-reach', 'math.multiply.scalar',
    g.unary('gain-change', 'math.abs.scalar', g.binary('gain-offset', 'math.subtract.scalar', 'one', gain)), g.number('dither-ramp', 16)), min: 'zero', max: 'one' });
  const dither = g.binary('dither', 'math.multiply.scalar', g.binary('dither-scaled', 'math.multiply.scalar', triangular, g.number('dither-step', VIGNETTE_DITHER * 0.5)), active);

  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const shaded = g.add('shaded', 'math.multiply.rgb-scalar', { a: [source, 'rgb'], b: gain });
  const dithered = g.binary('dithered', 'math.add.rgb', shaded, [g.add('dither-rgb', 'convert.scalar-to-rgb', { value: dither }), 'rgb']);
  const clamped = g.add('clamped', 'math.clamp.rgb-scalar', { value: dithered, min: 'zero', max: 'one' });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: clamped, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
