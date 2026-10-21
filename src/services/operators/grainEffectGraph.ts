import type { EffectOperatorGraph } from '../../types/operatorGraph';
import {
  GRAIN_CHANNEL_NORMALIZE, GRAIN_CHANNEL_TURNS, GRAIN_LAYER_TURNS, GRAIN_LAYERS_NORMALIZE, GRAIN_MIN_SIZE, GRAIN_PATTERN_SPAN,
  GRAIN_PATTERNS_PER_SECOND, GRAIN_REFERENCE_HEIGHT, GRAIN_SEED_ROW, GRAIN_SHADOW_FLOOR, GRAIN_STRENGTH,
} from '../../effects/stylize/grain/grainModel';
import { BlurGraphBuilder, type GraphPort } from './blurGraphBuilder';

/**
 * Film Grain v2 (contract in `effects/stylize/grain/grainModel.ts`): smooth value noise from
 * Random (Cell) hashes on a grid of Size pixels of a 1080p frame, three layers turned against
 * each other so no grid direction shows, a new pattern per frame, film-like midtone response
 * and optional color grain. One fullscreen pass; source alpha is kept.
 */
export function createDefaultGrainGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5); g.number('four', 4);
  const amount = g.bound('amount', 'amount'), size = g.bound('size', 'size'), speed = g.bound('speed', 'speed');
  const seed = g.bound('seed', 'seed'), chroma = g.bound('chroma', 'chroma');

  // Grain cells: Size pixels of a 1080p frame, square on any aspect.
  g.number('size-minimum', GRAIN_MIN_SIZE); g.number('reference-height', GRAIN_REFERENCE_HEIGHT);
  const sizeSafe = g.binary('size-safe', 'math.max.scalar', size, 'size-minimum');
  const pixelScale = g.binary('pixel-scale', 'math.divide-ieee.scalar', g.unary('short-side', 'vector.reduce-min.vec2', 'resolution'), 'reference-height');
  const cellPx = g.binary('cell-px', 'math.multiply.scalar', sizeSafe, pixelScale);
  const pixel = g.binary('pixel', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
  const grainUv = g.add('grain-uv', 'math.divide-ieee.vec2-scalar', { a: pixel, b: cellPx });

  // A new pattern per frame: the whole-number pattern index (and Seed) pick a random offset with
  // Random (Cell), exact for any index below 2^24, so long timelines never repeat a few patterns.
  g.number('patterns-per-second', GRAIN_PATTERNS_PER_SECOND); g.number('pattern-span', GRAIN_PATTERN_SPAN); g.number('seed-row', GRAIN_SEED_ROW);
  const rate = g.binary('pattern-rate', 'math.multiply.scalar', 'patterns-per-second', speed);
  const index = g.unary('pattern-index', 'math.floor.scalar', g.binary('pattern-rounding', 'math.add.scalar', g.binary('pattern-time', 'math.multiply.scalar', 'time', rate), 'half'));
  const offsetAxis = (axis: 'x' | 'y', row: GraphPort) => g.binary(`pattern-offset-${axis}`, 'math.multiply.scalar',
    g.unary(`pattern-hash-${axis}`, 'noise.cell-hash.vec2', g.add(`pattern-cell-${axis}`, 'vector.combine.vec2', { x: index, y: row })), 'pattern-span');
  const patternOffset = g.add('pattern-offset', 'vector.combine.vec2', { x: offsetAxis('x', seed), y: offsetAxis('y', g.binary('seed-second-row', 'math.add.scalar', seed, 'seed-row')) });

  // Smooth value noise on whole-number cells: four Random (Cell) corners, smoothstep-blended.
  // Each layer turns the grain grid by its own angle and shifts it, so the layers are unrelated.
  g.number('three', 3);
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => g.add(`corner-${x}${y}`, 'vector.combine.vec2', { x: x ? 'one' : 'zero', y: y ? 'one' : 'zero' }));
  const noise = (id: string, turn: number, shift: number): GraphPort => {
    const turned = g.add(`${id}-turned`, 'coordinates.rotate.vec2', { value: grainUv, angle: g.number(`${id}-angle`, turn * 2 * Math.PI) });
    const layerShift = g.unary(`${id}-shift`, 'convert.scalar-to-vec2', g.number(`${id}-shift-cells`, shift));
    const position = g.binary(`${id}-position`, 'math.add.vec2', g.binary(`${id}-offset`, 'math.add.vec2', turned, patternOffset), layerShift);
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
  // Monochrome grain: three layers at 0°, 30° and 60°, normalized to unit standard deviation.
  g.number('layers-normalize', GRAIN_LAYERS_NORMALIZE); g.number('channel-normalize', GRAIN_CHANNEL_NORMALIZE);
  const [first, second, third] = GRAIN_LAYER_TURNS.map((turn, layer) => noise(`grain-layer-${layer + 1}`, turn, 101.3 * layer));
  const mono = g.binary('grain-mono', 'math.multiply.scalar', g.binary('grain-layers', 'math.add.scalar', g.binary('grain-layers-12', 'math.add.scalar', first, second), third), 'layers-normalize');
  // Color grain: each channel mixes from the shared grain towards its own.
  const channel = (name: 'red' | 'green' | 'blue', turn: number, shift: number) => g.add(`grain-${name}`, 'math.mix.scalar', { a: mono,
    b: g.binary(`grain-${name}-own`, 'math.multiply.scalar', noise(`grain-${name}-noise`, turn, shift), 'channel-normalize'), t: chroma });
  const grainRgb = g.add('grain-rgb', 'convert.vec3-to-rgb', { value: g.add('grain-vec3', 'vector.combine.vec3',
    { x: channel('red', GRAIN_CHANNEL_TURNS[0], 37.1), y: channel('green', GRAIN_CHANNEL_TURNS[1], 71.3), z: channel('blue', GRAIN_CHANNEL_TURNS[2], 113.7) }) });

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
