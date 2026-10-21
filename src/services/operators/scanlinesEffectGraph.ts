import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { SCANLINES_FADE_END_PX, SCANLINES_FADE_START_PX, SCANLINES_PHASE_SCALE, SCANLINES_SCROLL_SCALE } from '../../effects/stylize/scanlines/scanlinesModel';
import { BlurGraphBuilder } from './blurGraphBuilder';

/**
 * Scanlines v2 (contract in `effects/stylize/scanlines/scanlinesModel.ts`): the same line phase
 * and scrolling as before, faded into an even darkening where the lines get too dense to show
 * without moiré, and Opacity limited to 0–1. One fullscreen pass; alpha is kept.
 */
export function createDefaultScanlinesGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('half', .5); g.number('tau', Math.PI * 2);
  const density = g.bound('density', 'density'), opacity = g.bound('opacity', 'opacity'), speed = g.bound('speed', 'speed');

  // Phase: (v + time * Speed * 0.1) * Density * 100.
  g.number('scroll-scale', SCANLINES_SCROLL_SCALE); g.number('phase-scale', SCANLINES_PHASE_SCALE);
  const v = [g.add('uv-split', 'vector.split.vec2', { value: ['uv', 'uv'] }), 'y'] as const;
  const scroll = g.binary('scroll', 'math.multiply.scalar', g.binary('time-speed', 'math.multiply.scalar', 'time', speed), 'scroll-scale');
  const frequency = g.binary('frequency', 'math.multiply.scalar', density, 'phase-scale');
  const wave = g.unary('wave', 'math.sin.scalar', g.binary('angle', 'math.multiply.scalar', g.binary('phase-y', 'math.add.scalar', v, scroll), frequency));

  // Lines closer than a few pixels fade to their average instead of aliasing.
  const height = [g.add('resolution-split', 'vector.split.vec2', { value: 'resolution' }), 'y'] as const;
  const period = g.binary('line-period-px', 'math.divide-ieee.scalar', g.binary('frame-turns', 'math.multiply.scalar', height, 'tau'),
    g.binary('frequency-safe', 'math.max.scalar', g.unary('frequency-magnitude', 'math.abs.scalar', frequency), g.number('frequency-floor', 1e-6)));
  const visibility = g.add('line-visibility', 'math.smoothstep.scalar', { edge0: g.number('fade-start-px', SCANLINES_FADE_START_PX),
    edge1: g.number('fade-end-px', SCANLINES_FADE_END_PX), value: period });
  const pattern = g.binary('pattern', 'math.add.scalar', 'half', g.binary('pattern-swing', 'math.multiply.scalar',
    g.binary('half-wave', 'math.multiply.scalar', wave, 'half'), visibility));

  const strength = g.add('opacity-limited', 'math.clamp.scalar', { value: opacity, min: 'zero', max: 'one' });
  const gain = g.binary('gain', 'math.subtract.scalar', 'one', g.binary('darkening', 'math.multiply.scalar', strength,
    g.binary('gap', 'math.subtract.scalar', 'one', pattern)));
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const shaded = g.add('shaded', 'math.multiply.rgb-scalar', { a: [source, 'rgb'], b: gain });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: shaded, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
