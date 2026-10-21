import type { EffectOperatorGraph } from '../../types/operatorGraph';
import {
  GRAIN_CHANNEL_NORMALIZE, GRAIN_MIN_SIZE, GRAIN_OCTAVES_NORMALIZE, GRAIN_PATTERN_SPAN, GRAIN_PATTERN_STEP,
  GRAIN_PATTERNS_PER_SECOND, GRAIN_REFERENCE_HEIGHT, GRAIN_SHADOW_FLOOR, GRAIN_STRENGTH,
} from '../../effects/stylize/grain/grainModel';
import { BlurGraphBuilder, type GraphPort } from './blurGraphBuilder';

/**
 * Film Grain v2 (contract in `effects/stylize/grain/grainModel.ts`): smooth value noise from
 * Random (Cell) hashes on a grid of Size pixels of a 1080p frame, a new pattern per frame, film-like midtone response
 * and optional color grain. One fullscreen pass; source alpha is kept.
 */
export function createDefaultGrainGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5); g.number('four', 4);
  const amount = g.bound('amount', 'amount'), size = g.bound('size', 'size'), speed = g.bound('speed', 'speed');
  const seed = g.bound('seed', 'seed'), chroma = g.bound('chroma', 'chroma');
  g.add('zero-vec2', 'convert.scalar-to-vec2', { value: 'zero' });

  // Grain cells: Size pixels of a 1080p frame, square on any aspect.
  g.number('size-minimum', GRAIN_MIN_SIZE); g.number('reference-height', GRAIN_REFERENCE_HEIGHT);
  const sizeSafe = g.binary('size-safe', 'math.max.scalar', size, 'size-minimum');
  const pixelScale = g.binary('pixel-scale', 'math.divide-ieee.scalar', g.unary('short-side', 'vector.reduce-min.vec2', 'resolution'), 'reference-height');
  const cellPx = g.binary('cell-px', 'math.multiply.scalar', sizeSafe, pixelScale);
  const pixel = g.binary('pixel', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
  const grainUv = g.add('grain-uv', 'math.divide-ieee.vec2-scalar', { a: pixel, b: cellPx });

  // A new pattern per frame: the pattern index walks a low-discrepancy offset sequence.
  g.number('patterns-per-second', GRAIN_PATTERNS_PER_SECOND); g.number('pattern-span', GRAIN_PATTERN_SPAN);
  g.number('pattern-step-x', GRAIN_PATTERN_STEP[0]); g.number('pattern-step-y', GRAIN_PATTERN_STEP[1]);
  const rate = g.binary('pattern-rate', 'math.multiply.scalar', 'patterns-per-second', speed);
  const index = g.unary('pattern-index', 'math.floor.scalar', g.binary('pattern-rounding', 'math.add.scalar', g.binary('pattern-time', 'math.multiply.scalar', 'time', rate), 'half'));
  const wrapped = (id: string, value: GraphPort, step: string) => g.binary(id, 'math.multiply.scalar',
    g.unary(`${id}-fract`, 'math.fract.scalar', g.binary(`${id}-turns`, 'math.multiply.scalar', value, step)), 'pattern-span');
  const patternSeed = g.binary('pattern-seed', 'math.add.scalar', wrapped('pattern-offset', index, 'pattern-step-x'), wrapped('seed-offset', seed, 'pattern-step-y'));

  // Smooth value noise on whole-number cells: four Random (Cell) corners, smoothstep-blended.
  g.number('three', 3);
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => g.add(`corner-${x}${y}`, 'vector.combine.vec2', { x: x ? 'one' : 'zero', y: y ? 'one' : 'zero' }));
  const noise = (id: string, scale: string, seedShift: number): GraphPort => {
    const shift = g.binary(`${id}-shift`, 'math.add.scalar', patternSeed, g.number(`${id}-seed-shift`, seedShift));
    const position = g.binary(`${id}-position`, 'math.add.vec2', g.add(`${id}-scaled`, 'math.multiply.vec2-scalar', { a: grainUv, b: scale }),
      g.unary(`${id}-shift-vec2`, 'convert.scalar-to-vec2', shift));
    const cell = g.unary(`${id}-cell`, 'math.floor.vec2', position);
    const fraction = g.add(`${id}-fraction`, 'vector.split.vec2', { value: g.unary(`${id}-fract`, 'math.fract.vec2', position) });
    const smooth = (axis: 'x' | 'y') => g.binary(`${id}-smooth-${axis}`, 'math.multiply.scalar',
      g.binary(`${id}-square-${axis}`, 'math.multiply.scalar', [fraction, axis], [fraction, axis]),
      g.binary(`${id}-falloff-${axis}`, 'math.subtract.scalar', 'three', g.binary(`${id}-double-${axis}`, 'math.multiply.scalar', 'two', [fraction, axis])));
    const sx = smooth('x'), sy = smooth('y');
    const [h00, h10, h01, h11] = corners.map((corner, index) => g.unary(`${id}-hash-${index}`, 'noise.cell-hash.vec2', g.binary(`${id}-corner-${index}`, 'math.add.vec2', cell, corner)));
    const row0 = g.add(`${id}-row-0`, 'math.mix.scalar', { a: h00, b: h10, t: sx }), row1 = g.add(`${id}-row-1`, 'math.mix.scalar', { a: h01, b: h11, t: sx });
    const value = g.add(id, 'math.mix.scalar', { a: row0, b: row1, t: sy });
    return g.binary(`${id}-centered`, 'math.subtract.scalar', value, 'half');
  };
  // Monochrome grain: two octaves, normalized to unit standard deviation.
  const fine = g.binary('grain-fine-weighted', 'math.multiply.scalar', noise('grain-fine', 'two', 101.3), 'half');
  g.number('octaves-normalize', GRAIN_OCTAVES_NORMALIZE); g.number('channel-normalize', GRAIN_CHANNEL_NORMALIZE);
  const mono = g.binary('grain-mono', 'math.multiply.scalar', g.binary('grain-octaves', 'math.add.scalar', noise('grain-coarse', 'one', 0), fine), 'octaves-normalize');
  // Color grain: each channel mixes from the shared grain towards its own.
  const channel = (name: 'red' | 'green' | 'blue', seedShift: number) => g.add(`grain-${name}`, 'math.mix.scalar', { a: mono,
    b: g.binary(`grain-${name}-own`, 'math.multiply.scalar', noise(`grain-${name}-noise`, 'one', seedShift), 'channel-normalize'), t: chroma });
  const grainRgb = g.add('grain-rgb', 'convert.vec3-to-rgb', { value: g.add('grain-vec3', 'vector.combine.vec3',
    { x: channel('red', 37.1), y: channel('green', 71.3), z: channel('blue', 113.7) }) });

  // Film response: full grain in the midtones, GRAIN_SHADOW_FLOOR of it in black and white.
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const luma = g.add('response-luma', 'math.clamp.scalar', { value: g.add('source-luma', 'color.luminance-rec709.rgb', { rgb: [source, 'rgb'] }), min: 'zero', max: 'one' });
  const midtone = g.binary('response-midtone', 'math.multiply.scalar', g.binary('response-bell', 'math.multiply.scalar', luma,
    g.binary('response-inverse', 'math.subtract.scalar', 'one', luma)), 'four');
  const response = g.add('response', 'math.mix.scalar', { a: g.number('shadow-floor', GRAIN_SHADOW_FLOOR), b: 'one', t: midtone });
  g.number('grain-strength', GRAIN_STRENGTH);
  const strength = g.binary('strength', 'math.multiply.scalar', g.binary('strength-amount', 'math.multiply.scalar', amount, 'grain-strength'), response);
  const grained = g.binary('grained', 'math.add.rgb', [source, 'rgb'], g.add('grain-scaled', 'math.multiply.rgb-scalar', { a: [grainRgb, 'rgb'], b: strength }));
  const clamped = g.add('clamped', 'math.clamp.rgb-scalar', { value: grained, min: 'zero', max: 'one' });
  const output = g.add('combine', 'vector.combine.rgba', { rgb: clamped, alpha: [source, 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
