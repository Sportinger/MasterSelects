import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { GLOW_KNEE_FLOOR, GLOW_LEVEL_REACH, GLOW_LEVELS, GLOW_PEAK_FLOOR, GLOW_REFERENCE_HEIGHT } from '../../effects/stylize/glow/glowBloom';
import { BlurGraphBuilder, normalizeNodes, type GraphPort } from './blurGraphBuilder';

/** Light carried by a pyramid level: rgb is the light, alpha the summed weights of the levels in it. */
function splitRgb(g: BlurGraphBuilder, id: string, image: GraphPort): GraphPort {
  return [g.add(id, 'vector.split.rgba', { image }), 'rgb'];
}

/** One 3x3 reduction of `source` at the shared tap positions `uv`, normalized by its weight sum. */
function filterTaps(g: BlurGraphBuilder, prefix: string, source: GraphPort, uv: string): GraphPort {
  const sample = g.add(`${prefix}-sample`, 'image.sample', { image: source, uv });
  const reduce = g.add(`${prefix}-reduce`, 'image.kernel-rect-reduce', { sample: [sample, 'image'], weight: 'tap-weight', width: 'three', height: 'three' });
  return normalizeNodes(g, prefix, reduce);
}

/**
 * Glow v3, a lens bloom (contract in `effects/stylize/glow/glowBloom.ts`): a full-size bright
 * pass, a pyramid of GLOW_LEVELS half-size Cache Images ([1 3 3 1] downsample), and the way back
 * up with a 3x3 tent that adds every level by its Radius weight. One shared tap kernel serves
 * every pass; each pass reads it in its own resolution. About 2.7 full-frame passes of work and
 * about 1.7 frames of rgba16float cache memory (bright pass plus two pyramids), at any Radius.
 */
export function createDefaultGlowGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('three', 3); g.number('four', 4); g.number('half', .5);
  g.number('knee-floor', GLOW_KNEE_FLOOR); g.number('peak-floor', GLOW_PEAK_FLOOR); g.number('coverage-floor', 1e-6);
  const amount = g.bound('amount', 'amount'), threshold = g.bound('threshold', 'threshold');
  const softness = g.bound('softness', 'softness'), radius = g.bound('radius', 'radius');
  const color = g.bound('color', 'color', 'values.color');

  // Bright pass: the share of each pixel's light above the soft-knee threshold, premultiplied.
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const alpha = g.add('source-alpha', 'convert.alpha-to-scalar', { alpha: [source, 'alpha'] });
  const peak = g.add('bright-peak', 'vector.reduce-max.rgb', { rgb: [source, 'rgb'] });
  const t = g.binary('bright-threshold', 'math.max.scalar', threshold, 'zero');
  const softnessSafe = g.binary('bright-softness', 'math.max.scalar', softness, 'zero');
  const kneeRaw = g.binary('bright-knee-raw', 'math.multiply.scalar', t, softnessSafe);
  const knee = g.binary('bright-knee', 'math.max.scalar', kneeRaw, 'knee-floor');
  const over = g.binary('bright-over', 'math.subtract.scalar', peak, t);
  const kneeSpan = g.binary('bright-knee-span', 'math.multiply.scalar', knee, 'two');
  const softRaw = g.binary('bright-soft-raw', 'math.add.scalar', over, knee);
  const soft = g.add('bright-soft', 'math.clamp.scalar', { value: softRaw, min: 'zero', max: kneeSpan });
  const softSquared = g.binary('bright-soft-squared', 'math.multiply.scalar', soft, soft);
  const kneeQuad = g.binary('bright-knee-quad', 'math.multiply.scalar', knee, 'four');
  const curve = g.binary('bright-curve', 'math.divide-ieee.scalar', softSquared, kneeQuad);
  const glowing = g.binary('bright-glowing', 'math.max.scalar', curve, over);
  const peakSafe = g.binary('bright-peak-safe', 'math.max.scalar', peak, 'peak-floor');
  const contribution = g.binary('bright-contribution', 'math.divide-ieee.scalar', glowing, peakSafe);
  const energy = g.binary('bright-energy', 'math.multiply.scalar', contribution, alpha);
  const light = g.add('bright-light', 'math.multiply.rgb-scalar', { a: [source, 'rgb'], b: energy });
  const lightImage = g.add('bright-image', 'vector.combine.rgba', { rgb: light, alpha: [source, 'alpha'] });
  g.add('bright-cache', 'image.materialize', { image: [lightImage, 'image'] });

  // Shared 3x3 tap kernel: weights [1 2 1] x [1 2 1]; offsets in output texels.
  const index = g.add('tap-index', 'image.kernel-index');
  const indexSplit = g.add('tap-index-split', 'vector.split.vec2', { value: index });
  const dx = g.binary('tap-x', 'math.subtract.scalar', [indexSplit, 'x'], 'one');
  const dy = g.binary('tap-y', 'math.subtract.scalar', [indexSplit, 'y'], 'one');
  const wx = g.binary('tap-weight-x', 'math.subtract.scalar', 'two', g.unary('tap-x-abs', 'math.abs.scalar', dx));
  const wy = g.binary('tap-weight-y', 'math.subtract.scalar', 'two', g.unary('tap-y-abs', 'math.abs.scalar', dy));
  g.binary('tap-weight', 'math.multiply.scalar', wx, wy);
  const tap = g.add('tap-offset', 'vector.combine.vec2', { x: dx, y: dy });
  const texel = g.binary('texel', 'math.divide-ieee.vec2', g.unary('one-vec2', 'convert.scalar-to-vec2', 'one'), 'resolution');
  const upOffset = g.binary('up-offset', 'math.multiply.vec2', tap, texel);
  g.binary('up-uv', 'math.add.vec2', ['uv', 'uv'], upOffset);
  // Downsampling: taps one input texel (half an output texel) apart on the input's texel corners → [1 3 3 1].
  const downOffset = g.binary('down-offset', 'math.multiply.vec2-scalar', upOffset, 'half');
  g.binary('down-uv', 'math.add.vec2', ['uv', 'uv'], downOffset);

  // Level weight, evaluated in each pass at that pass's own size (see glowLevelWeight).
  g.number('reference-height', GLOW_REFERENCE_HEIGHT * GLOW_LEVEL_REACH); g.number('radius-floor', 1e-3); g.number('ln2', Math.LN2);
  const radiusSafe = g.binary('level-radius', 'math.max.scalar', radius, 'radius-floor');
  const levelShort = g.unary('level-short-side', 'vector.reduce-min.vec2', 'resolution');
  const reachRatio = g.binary('level-reach-ratio', 'math.divide-ieee.scalar', g.binary('level-reach-px', 'math.multiply.scalar', radiusSafe, levelShort), 'reference-height');
  const position = g.binary('level-position', 'math.divide-ieee.scalar', g.unary('level-log', 'math.log.scalar', reachRatio), 'ln2');
  g.add('level-weight', 'math.smoothstep.scalar', { edge0: 'zero', edge1: 'one', value: g.binary('level-position-shifted', 'math.add.scalar', position, 'one') });
  // The smallest level is summed into the next-larger pass, one level up in size.
  g.add('top-level-weight', 'math.smoothstep.scalar', { edge0: 'zero', edge1: 'one', value: position });

  let previous: GraphPort = ['bright-cache', 'image'];
  for (let level = 1; level <= GLOW_LEVELS; level++) {
    const image = filterTaps(g, `down-${level}`, previous, 'down-uv');
    g.add(`down-${level}-cache`, 'image.materialize', { image }, { bindings: {}, constants: { scale: String(1 / 2 ** level) } });
    previous = [`down-${level}-cache`, 'image'];
  }
  for (let level = GLOW_LEVELS - 1; level >= 1; level--) {
    const upper: GraphPort = level === GLOW_LEVELS - 1 ? [`down-${GLOW_LEVELS}-cache`, 'image'] : [`up-${level + 1}-cache`, 'image'];
    const tent = filterTaps(g, `up-${level}`, upper, 'up-uv');
    const tentSplit = g.add(`up-${level}-split`, 'vector.split.rgba', { image: tent });
    let tentRgb: GraphPort = [tentSplit, 'rgb'];
    let tentWeight: GraphPort = g.add(`up-${level}-weight-sum`, 'convert.alpha-to-scalar', { alpha: [tentSplit, 'alpha'] });
    if (level === GLOW_LEVELS - 1) {
      tentRgb = g.add(`up-${level}-top-light`, 'math.multiply.rgb-scalar', { a: tentRgb, b: 'top-level-weight' });
      tentWeight = 'top-level-weight';
    }
    const own = g.add(`up-${level}-level`, 'image.sample', { image: [`down-${level}-cache`, 'image'], uv: ['uv', 'uv'] });
    const weight = level === 1 ? 'one' : 'level-weight';
    const ownLight = g.add(`up-${level}-level-light`, 'math.multiply.rgb-scalar', { a: splitRgb(g, `up-${level}-level-split`, [own, 'image']), b: weight });
    const sum = g.binary(`up-${level}-light`, 'math.add.rgb', tentRgb, ownLight);
    const weightSum = g.binary(`up-${level}-weights`, 'math.add.scalar', tentWeight, weight);
    const packed = g.add(`up-${level}-packed`, 'vector.combine.rgba', { rgb: sum, alpha: [g.add(`up-${level}-alpha`, 'convert.scalar-to-alpha', { value: weightSum }), 'alpha'] });
    g.add(`up-${level}-cache`, 'image.materialize', { image: [packed, 'image'] }, { bindings: {}, constants: { scale: String(1 / 2 ** level) } });
  }

  // Resolve at full size: tent-upsampled glow * Amount * Color, added to the premultiplied source.
  const glowSplit = g.add('glow-split', 'vector.split.rgba', { image: filterTaps(g, 'glow', ['up-1-cache', 'image'], 'up-uv') });
  // Wider glows add levels; dividing by the square root of their weight sum lets them grow without flooding the frame.
  const weightSum = g.add('glow-weight-sum', 'convert.alpha-to-scalar', { alpha: [glowSplit, 'alpha'] });
  const spread = g.unary('glow-spread', 'math.sqrt.scalar', g.binary('glow-weight-safe', 'math.max.scalar', weightSum, 'one'));
  const glowLight = g.add('glow-light', 'math.divide-ieee.rgb-scalar', { a: [glowSplit, 'rgb'], b: spread });
  const intensity = g.binary('glow-amount', 'math.max.scalar', amount, 'zero');
  const tinted = g.binary('glow-tinted', 'math.multiply.rgb', glowLight, [g.add('color-rgb', 'convert.vec4-to-rgb', { value: color }), 'rgb']);
  const glow = g.add('glow-scaled', 'math.multiply.rgb-scalar', { a: tinted, b: intensity });
  const premultiplied = g.add('resolve-premultiplied', 'math.multiply.rgb-scalar', { a: [source, 'rgb'], b: alpha });
  const result = g.binary('resolve-result', 'math.add.rgb', premultiplied, glow);
  const resultPeak = g.add('resolve-peak', 'vector.reduce-max.rgb', { rgb: result });
  const coverage = g.add('resolve-coverage', 'math.clamp.scalar', { value: g.binary('resolve-coverage-raw', 'math.max.scalar', alpha, resultPeak), min: 'zero', max: 'one' });
  const safeCoverage = g.binary('resolve-coverage-safe', 'math.max.scalar', coverage, 'coverage-floor');
  const straight = g.add('resolve-straight', 'math.divide-ieee.rgb-scalar', { a: result, b: safeCoverage });
  const clamped = g.add('resolve-clamped', 'math.clamp.rgb-scalar', { value: straight, min: 'zero', max: 'one' });
  const output = g.add('resolve-output', 'vector.combine.rgba', { rgb: clamped, alpha: [g.add('resolve-alpha', 'convert.scalar-to-alpha', { value: coverage }), 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
