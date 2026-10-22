import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { GLOW_FINEST_REACH, GLOW_LEVEL_REACH, GLOW_LEVELS, GLOW_RAMP_FLOOR, GLOW_REFERENCE_HEIGHT } from '../../effects/stylize/glow/glowBloom';
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
 * pass (a ramp from just below Threshold to white), a pyramid of GLOW_LEVELS half-size Cache Images ([1 3 3 1] downsample), and the way back
 * up with a 3x3 tent that adds every level by its Radius weight; the bright pass itself is level
 * 0. The glow is screened onto the picture (1 - (1 - picture) * exp(-glow)), so it never clips hard.
 * One shared tap kernel serves every pass; each pass reads it in its own resolution. About 2.7
 * full-frame passes of work and about 1.7 frames of rgba16float cache memory, at any Radius.
 */
export function createDefaultGlowGraph(): EffectOperatorGraph {
  return createGlowGraph(false);
}

/**
 * The bloom recipe released with 3.2.7 (until 2026-10-22): the same pixels, plus a weight-sum card
 * on the top Pyramid Up level that nothing read. Kept only so upgradeGlowGraph can recognize an
 * untouched saved copy and replace it with createDefaultGlowGraph (same look, folders and notes).
 */
export function createGlowGraphBefore20261022(): EffectOperatorGraph {
  return createGlowGraph(true);
}

function createGlowGraph(unusedTopWeight: boolean): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('three', 3); g.number('half', .5);
  g.number('ramp-floor', GLOW_RAMP_FLOOR); g.number('coverage-floor', 1e-6);
  const amount = g.bound('amount', 'amount'), threshold = g.bound('threshold', 'threshold');
  const softness = g.bound('softness', 'softness'), radius = g.bound('radius', 'radius');
  const color = g.bound('color', 'color', 'values.color');

  // Bright pass: a smooth ramp on each pixel's brightest channel, from Softness × headroom below
  // Threshold up to white, where all of its light glows (glowShare); premultiplied.
  const source = g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const alpha = g.add('source-alpha', 'convert.alpha-to-scalar', { alpha: [source, 'alpha'] });
  const peak = g.add('bright-peak', 'vector.reduce-max.rgb', { rgb: [source, 'rgb'] });
  const t = g.binary('bright-threshold', 'math.max.scalar', threshold, 'zero');
  const softnessSafe = g.binary('bright-softness', 'math.max.scalar', softness, 'zero');
  const headroom = g.binary('bright-headroom', 'math.max.scalar', g.binary('bright-headroom-raw', 'math.min.scalar', t,
    g.binary('bright-gap', 'math.subtract.scalar', 'one', t)), 'zero');
  const rampStart = g.binary('bright-ramp-start', 'math.subtract.scalar', t, g.binary('bright-knee', 'math.multiply.scalar', softnessSafe, headroom));
  const rampEnd = g.binary('bright-ramp-end', 'math.max.scalar', 'one', g.binary('bright-ramp-end-min', 'math.add.scalar', rampStart, 'ramp-floor'));
  const contribution = g.add('bright-contribution', 'math.smoothstep.scalar', { edge0: rampStart, edge1: rampEnd, value: peak });
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
  const radiusWeight = g.add('level-radius-weight', 'math.smoothstep.scalar', { edge0: 'zero', edge1: 'one', value: g.binary('level-position-shifted', 'math.add.scalar', position, 'one') });
  // Levels finer than the finest 1080p level fade out, so 4K renders the same levels as 1080p.
  // fineness = log2(level reach / (GLOW_FINEST_REACH / 2)): 0 at half the finest reach, 1 at it.
  g.number('finest-reach', 2 * GLOW_LEVEL_REACH * GLOW_REFERENCE_HEIGHT / GLOW_FINEST_REACH);
  const fineness = g.binary('level-fineness', 'math.divide-ieee.scalar', g.unary('level-fineness-log', 'math.log.scalar',
    g.binary('level-fineness-ratio', 'math.divide-ieee.scalar', 'finest-reach', g.binary('level-short-safe', 'math.max.scalar', levelShort, 'one'))), 'ln2');
  const fineFade = g.add('level-fine-fade', 'math.smoothstep.scalar', { edge0: 'zero', edge1: 'one', value: fineness });
  g.binary('level-weight', 'math.multiply.scalar', radiusWeight, fineFade);
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
    // The smallest level carries no weight sum yet: it joins by the top level weight instead.
    const top = level === GLOW_LEVELS - 1;
    if (top && unusedTopWeight) g.add(`up-${level}-weight-sum`, 'convert.alpha-to-scalar', { alpha: [tentSplit, 'alpha'] });
    const tentRgb: GraphPort = top ? g.add(`up-${level}-top-light`, 'math.multiply.rgb-scalar', { a: [tentSplit, 'rgb'], b: 'top-level-weight' }) : [tentSplit, 'rgb'];
    const tentWeight: GraphPort = top ? 'top-level-weight' : g.add(`up-${level}-weight-sum`, 'convert.alpha-to-scalar', { alpha: [tentSplit, 'alpha'] });
    const own = g.add(`up-${level}-level`, 'image.sample', { image: [`down-${level}-cache`, 'image'], uv: ['uv', 'uv'] });
    const weight = 'level-weight';
    const ownLight = g.add(`up-${level}-level-light`, 'math.multiply.rgb-scalar', { a: splitRgb(g, `up-${level}-level-split`, [own, 'image']), b: weight });
    const sum = g.binary(`up-${level}-light`, 'math.add.rgb', tentRgb, ownLight);
    const weightSum = g.binary(`up-${level}-weights`, 'math.add.scalar', tentWeight, weight);
    const packed = g.add(`up-${level}-packed`, 'vector.combine.rgba', { rgb: sum, alpha: [g.add(`up-${level}-alpha`, 'convert.scalar-to-alpha', { value: weightSum }), 'alpha'] });
    g.add(`up-${level}-cache`, 'image.materialize', { image: [packed, 'image'] }, { bindings: {}, constants: { scale: String(1 / 2 ** level) } });
  }

  // Resolve at full size. Level 0 is the bright pass itself. It stands for every 1080p level whose
  // reach this render size cannot resolve, log2(min(Radius, its reach) / finest reach) + 1 of them,
  // and fills up to a total weight of 1 when the Radius is finer than the pyramid: a reduced
  // preview keeps the 1080p glow, and a tiny Radius stays tight.
  const glowSplit = g.add('glow-split', 'vector.split.rgba', { image: filterTaps(g, 'glow', ['up-1-cache', 'image'], 'up-uv') });
  const pyramidWeight = g.add('glow-pyramid-weight', 'convert.alpha-to-scalar', { alpha: [glowSplit, 'alpha'] });
  g.number('finest-level-reach', GLOW_FINEST_REACH);
  const coreReach = g.binary('glow-core-reach', 'math.min.scalar', radiusSafe, g.binary('glow-core-level-reach', 'math.divide-ieee.scalar', 'reference-height', levelShort));
  const folded = g.binary('glow-core-folded', 'math.add.scalar', g.binary('glow-core-octaves', 'math.divide-ieee.scalar',
    g.unary('glow-core-log', 'math.log.scalar', g.binary('glow-core-ratio', 'math.divide-ieee.scalar', coreReach, 'finest-level-reach')), 'ln2'), 'one');
  const coreWeight = g.binary('glow-core-weight', 'math.max.scalar', g.binary('glow-core-needed', 'math.max.scalar', folded,
    g.binary('glow-core-missing', 'math.subtract.scalar', 'one', pyramidWeight)), 'zero');
  const core = g.add('glow-core', 'image.sample', { image: ['bright-cache', 'image'], uv: ['uv', 'uv'] });
  const coreLight = g.add('glow-core-light', 'math.multiply.rgb-scalar', { a: splitRgb(g, 'glow-core-split', [core, 'image']), b: coreWeight });
  const lightSum = g.binary('glow-light-sum', 'math.add.rgb', [glowSplit, 'rgb'], coreLight);
  // Wider glows add levels; dividing by the square root of their weight sum lets them grow without flooding the frame.
  const weightSum = g.binary('glow-weight-sum', 'math.add.scalar', pyramidWeight, coreWeight);
  const spread = g.unary('glow-spread', 'math.sqrt.scalar', g.binary('glow-weight-safe', 'math.max.scalar', weightSum, 'one'));
  const glowLight = g.add('glow-light', 'math.divide-ieee.rgb-scalar', { a: lightSum, b: spread });
  const intensity = g.binary('glow-amount', 'math.max.scalar', amount, 'zero');
  const tinted = g.binary('glow-tinted', 'math.multiply.rgb', glowLight, [g.add('color-rgb', 'convert.vec4-to-rgb', { value: color }), 'rgb']);
  const glow = g.add('glow-scaled', 'math.multiply.rgb-scalar', { a: tinted, b: intensity });
  // Screen with a soft roll-off: 1 - (1 - picture) * exp(-glow). Small glows add light like Add,
  // bright areas have less room left and nothing passes white (no hard clipping; very strong
  // glows still approach white).
  const premultiplied = g.add('resolve-premultiplied', 'math.multiply.rgb-scalar', { a: [source, 'rgb'], b: alpha });
  const oneRgb: GraphPort = [g.unary('one-rgb', 'convert.scalar-to-rgb', 'one'), 'rgb'];
  const room = g.binary('resolve-room', 'math.subtract.rgb', oneRgb, premultiplied);
  const falloff = g.binary('resolve-falloff', 'math.power.rgb', [g.unary('euler-rgb', 'convert.scalar-to-rgb', g.number('euler', Math.E)), 'rgb'],
    g.binary('glow-negative', 'math.subtract.rgb', [g.unary('zero-rgb', 'convert.scalar-to-rgb', 'zero'), 'rgb'], glow));
  const result = g.binary('resolve-result', 'math.subtract.rgb', oneRgb, g.binary('resolve-remaining', 'math.multiply.rgb', room, falloff));
  const resultPeak = g.add('resolve-peak', 'vector.reduce-max.rgb', { rgb: result });
  const coverage = g.add('resolve-coverage', 'math.clamp.scalar', { value: g.binary('resolve-coverage-raw', 'math.max.scalar', alpha, resultPeak), min: 'zero', max: 'one' });
  const safeCoverage = g.binary('resolve-coverage-safe', 'math.max.scalar', coverage, 'coverage-floor');
  const straight = g.add('resolve-straight', 'math.divide-ieee.rgb-scalar', { a: result, b: safeCoverage });
  const clamped = g.add('resolve-clamped', 'math.clamp.rgb-scalar', { value: straight, min: 'zero', max: 'one' });
  const output = g.add('resolve-output', 'vector.combine.rgba', { rgb: clamped, alpha: [g.add('resolve-alpha', 'convert.scalar-to-alpha', { value: coverage }), 'alpha'] });
  g.add('output', 'image.output', { image: [output, 'image'] });
  return g.graph();
}
