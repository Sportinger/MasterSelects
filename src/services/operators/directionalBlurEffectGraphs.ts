import type { EffectOperatorGraph } from '../../types/operatorGraph';
import {
  DIRECTIONAL_MAX_COARSE_TAPS, DIRECTIONAL_MAX_FINE_TAPS, RADIAL_MIN_SCALE, RADIAL_SCALE_PER_AMOUNT,
  SPIN_RADIANS_PER_AMOUNT, ZOOM_SCALE_PER_AMOUNT,
} from '../../effects/blur/blurSampling';
import { BlurGraphBuilder, normalizeNodes, premultipliedSourceCache, unpremultiplyNodes, type GraphPort } from './blurGraphBuilder';

export type EditableDirectionalBlurEffectType = 'motion-blur' | 'radial-blur' | 'zoom-blur';

/**
 * Two-stage Motion, Zoom and Radial Blur (contract: `effects/blur/blurSampling.ts`).
 * Each tap position is T(u) of a one-parameter transform group in pixel space:
 * translation (Motion), log-scale about the centre (Zoom, Radial Zoom) or rotation about
 * the centre (Radial Spin). The source is premultiplied into an rgba16float cache first (exact
 * filtering at alpha edges). Stage A averages a short box of length `step` with taps at most
 * one pixel apart into a second cache; stage B samples that cache at coarse taps one box
 * apart over the whole range. Below 0, Motion and Radial Blur clamp the amount to 0 and pass the
 * picture through (legacy); a negative Zoom Blur amount streaks inward. Counts use magnitudes.
 */
function transform(g: BlurGraphBuilder, type: EditableDirectionalBlurEffectType, prefix: string, base: string, u: string): string {
  const id = (name: string) => `${prefix}-${name}`;
  let moved: string;
  if (type === 'motion-blur') {
    const shift = g.add(id('shift'), 'math.multiply.vec2-scalar', { a: 'direction', b: u });
    moved = g.binary(id('moved'), 'math.add.vec2', base, shift);
  } else {
    const relative = g.binary(id('relative'), 'math.subtract.vec2', base, 'center');
    const scale = g.unary(id('scale'), 'math.exp.scalar', u);
    const scaled = g.add(id('scaled'), 'math.multiply.vec2-scalar', { a: relative, b: scale });
    let offset = scaled;
    if (type === 'radial-blur') {
      const rotated = g.add(id('rotated'), 'coordinates.rotate.vec2', { value: relative, angle: u });
      offset = g.add(id('mode-offset'), 'select.vec2', { condition: ['is-spin', 'condition'], falseValue: scaled, trueValue: rotated });
    }
    moved = g.binary(id('moved'), 'math.add.vec2', 'center', offset);
  }
  const raw = g.binary(id('uv-raw'), 'math.divide-ieee.vec2', moved, 'resolution');
  // Motion mirrors at the frame edge (transitions rely on it); Zoom and Radial keep the sampler's
  // edge clamp: a mirrored zoom/spin path folds onto other rays, where the cached boxes no longer tile.
  return type === 'motion-blur' ? g.unary(id('uv'), 'coordinates.mirror-repeat.vec2', raw) : raw;
}

/** Pixels moved per group unit at `pixel`: 1 for translations, the centre distance otherwise. */
function speed(g: BlurGraphBuilder, type: EditableDirectionalBlurEffectType, prefix: string, pixel: string): string | undefined {
  if (type === 'motion-blur') return undefined;
  const relative = g.binary(`${prefix}-speed-relative`, 'math.subtract.vec2', pixel, 'center');
  return g.unary(`${prefix}-speed`, 'vector.length.vec2', relative);
}

function createTwoStageBlurGraph(type: EditableDirectionalBlurEffectType): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5);
  g.number('tiny', 1e-9); g.number('cover-epsilon', 1e-4); g.number('covered-floor', 1e-6);
  const boundAmount = g.bound('amount', 'amount');
  // Motion and Radial Blur leave the picture unchanged below 0, as their legacy shaders did.
  const amount = type === 'zoom-blur' ? boundAmount : g.binary('amount-positive', 'math.max.scalar', boundAmount, 'zero');

  // Range of the group parameter: start, signed length; longest range and its length in pixels.
  let rangeStart: GraphPort = 'zero', rangeLength: string, longest: string, longestPx: string;
  if (type === 'motion-blur') {
    g.add('direction', 'vector.unit-direction.scalar', { angle: g.bound('angle', 'angle') });
    // On-screen direction in pixels; the reach keeps the legacy length Length * |(cos * W, sin * H)|,
    // so horizontal streaks are a share of the width and vertical ones a share of the height.
    const extent = g.unary('direction-extent', 'vector.length.vec2', g.binary('direction-frame', 'math.multiply.vec2', 'direction', 'resolution'));
    const halfLength = g.binary('half-length', 'math.multiply.scalar', amount, extent);
    rangeStart = g.binary('range-start', 'math.subtract.scalar', 'zero', halfLength);
    rangeLength = g.binary('range-length', 'math.multiply.scalar', halfLength, 'two');
    longest = g.unary('longest', 'math.abs.scalar', rangeLength); longestPx = longest;
  } else {
    g.add('resolution-split', 'vector.split.vec2', { value: 'resolution' });
    g.number('min-scale', RADIAL_MIN_SCALE);
    const centerUv = g.add('center-uv', 'vector.combine.vec2', { x: g.bound('center-x', 'centerX'), y: g.bound('center-y', 'centerY') });
    g.binary('center', 'math.multiply.vec2', centerUv, 'resolution');
    const centerSplit = g.add('center-split', 'vector.split.vec2', { value: 'center' });
    const farX = g.binary('far-x', 'math.max.scalar', [centerSplit, 'x'], g.binary('right-x', 'math.subtract.scalar', ['resolution-split', 'x'], [centerSplit, 'x']));
    const farY = g.binary('far-y', 'math.max.scalar', [centerSplit, 'y'], g.binary('bottom-y', 'math.subtract.scalar', ['resolution-split', 'y'], [centerSplit, 'y']));
    const farthest = g.unary('farthest', 'vector.length.vec2', g.add('far-corner', 'vector.combine.vec2', { x: farX, y: farY }));
    if (type === 'zoom-blur') {
      g.number('zoom-scale-per-amount', ZOOM_SCALE_PER_AMOUNT);
      const grow = g.binary('zoom-grow', 'math.multiply.scalar', amount, 'zoom-scale-per-amount');
      // Negative amounts zoom inward; the scale never reaches 0 (Amount below -1.9).
      const endScale = g.binary('zoom-end-scale', 'math.max.scalar', g.binary('zoom-end-scale-raw', 'math.add.scalar', 'one', grow), 'min-scale');
      rangeLength = g.unary('range-length', 'math.log.scalar', endScale);
      longest = g.unary('longest', 'math.abs.scalar', rangeLength);
    } else {
      g.add('mode', 'values.choice', {}, { bindings: { value: 'mode' } });
      g.add('is-spin', 'compare.greater.scalar', { a: 'mode', b: 'half' });
      // Spin: a symmetric arc of amount * 20 degrees.
      g.number('spin-per-amount', SPIN_RADIANS_PER_AMOUNT);
      const arc = g.binary('spin-arc', 'math.multiply.scalar', amount, 'spin-per-amount');
      const arcHalf = g.binary('spin-arc-half', 'math.multiply.scalar', arc, 'half');
      const spinStart = g.binary('spin-start', 'math.subtract.scalar', 'zero', arcHalf);
      // Legacy zoom: inward to scale 1 - 0.2 * amount * (UV distance), never below 0.05.
      g.number('radial-scale-per-amount', RADIAL_SCALE_PER_AMOUNT);
      const shrinkRate = g.binary('radial-shrink-rate', 'math.multiply.scalar', amount, 'radial-scale-per-amount');
      const uvDistance = g.unary('radial-uv-distance', 'vector.length.vec2', g.binary('radial-uv-offset', 'math.subtract.vec2', ['uv', 'uv'], centerUv));
      const scaleRaw = g.binary('radial-scale-raw', 'math.subtract.scalar', 'one', g.binary('radial-shrink', 'math.multiply.scalar', shrinkRate, uvDistance));
      const zoomLength = g.unary('radial-log-scale', 'math.log.scalar', g.binary('radial-scale', 'math.max.scalar', scaleRaw, 'min-scale'));
      const centerUvSplit = g.add('center-uv-split', 'vector.split.vec2', { value: centerUv });
      const farU = g.binary('far-u', 'math.max.scalar', [centerUvSplit, 'x'], g.binary('right-u', 'math.subtract.scalar', 'one', [centerUvSplit, 'x']));
      const farV = g.binary('far-v', 'math.max.scalar', [centerUvSplit, 'y'], g.binary('bottom-v', 'math.subtract.scalar', 'one', [centerUvSplit, 'y']));
      const farUv = g.unary('farthest-uv', 'vector.length.vec2', g.add('far-corner-uv', 'vector.combine.vec2', { x: farU, y: farV }));
      const longestScale = g.binary('radial-longest-scale', 'math.max.scalar',
        g.binary('radial-longest-scale-raw', 'math.subtract.scalar', 'one', g.binary('radial-longest-shrink', 'math.multiply.scalar', shrinkRate, farUv)), 'min-scale');
      const zoomLongest = g.unary('radial-longest', 'math.log.scalar', longestScale);
      const pick = (id: string, zoom: GraphPort, spin: GraphPort) => g.add(id, 'select.scalar', { condition: ['is-spin', 'condition'], falseValue: zoom, trueValue: spin });
      rangeStart = pick('range-start', 'zero', spinStart);
      rangeLength = pick('range-length', zoomLength, arc);
      longest = g.unary('longest', 'math.abs.scalar', pick('longest-signed', zoomLongest, arc));
    }
    longestPx = g.binary('longest-px', 'math.multiply.scalar', longest, farthest);
  }

  // Coarse taps ~ sqrt(2 * longest streak in px); every pixel shares the box length `step`.
  const coarseNeeded = g.unary('coarse-needed', 'math.ceil.scalar', g.unary('coarse-root', 'math.sqrt.scalar', g.binary('longest-px-double', 'math.multiply.scalar', longestPx, 'two')));
  g.number('coarse-limit', DIRECTIONAL_MAX_COARSE_TAPS);
  const coarseCount = g.add('coarse-count', 'math.clamp.scalar', { value: coarseNeeded, min: 'one', max: 'coarse-limit' });
  const step = g.binary('step', 'math.max.scalar', g.binary('step-raw', 'math.divide-ieee.scalar', longest, coarseCount), 'tiny');

  // Stage A: box of length `step` around every pixel, taps at most one pixel apart.
  const finePixel = g.binary('fine-pixel', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
  const fineSpeed = speed(g, type, 'fine', finePixel);
  const fineReach = fineSpeed ? g.binary('fine-reach', 'math.multiply.scalar', step, fineSpeed) : step;
  g.number('fine-limit', DIRECTIONAL_MAX_FINE_TAPS);
  const fineCount = g.add('fine-count', 'math.clamp.scalar', { value: g.unary('fine-needed', 'math.ceil.scalar', fineReach), min: 'one', max: 'fine-limit' });
  const fineSequence = g.add('fine-sequence', 'image.sequence-index');
  const fineShare = g.binary('fine-share', 'math.divide-ieee.scalar', g.binary('fine-entry', 'math.add.scalar', [fineSequence, 'index'], 'half'), fineCount);
  const fineU = g.binary('fine-u', 'math.multiply.scalar', g.binary('fine-centered', 'math.subtract.scalar', fineShare, 'half'), step);
  const fineSample = g.add('fine-sample', 'image.sample', { image: [premultipliedSourceCache(g), 'image'], uv: transform(g, type, 'fine', finePixel, fineU) });
  const fineReduce = g.add('fine-reduce', 'image.sequence-reduce', { sample: [fineSample, 'image'], weight: 'one', count: fineCount });
  const cache = g.add('fine-cache', 'image.materialize', { image: normalizeNodes(g, 'fine', fineReduce) });

  // Stage B: coarse taps one box apart over this pixel's range; a partial last box is weighted by its share.
  const coarsePixel = g.binary('coarse-pixel', 'math.multiply.vec2', ['uv', 'uv'], 'resolution');
  const span = g.unary('range-span', 'math.abs.scalar', rangeLength);
  const spanSafe = g.binary('range-span-safe', 'math.max.scalar', span, 'tiny');
  const direction = g.binary('range-direction', 'math.divide-ieee.scalar', rangeLength, spanSafe);
  const boxes = g.binary('boxes', 'math.divide-ieee.scalar', span, step);
  const countHere = g.add('coarse-count-here', 'math.clamp.scalar',
    { value: g.unary('coarse-needed-here', 'math.ceil.scalar', g.binary('boxes-guarded', 'math.subtract.scalar', boxes, 'cover-epsilon')), min: 'one', max: 'coarse-limit' });
  const coarseSequence = g.add('coarse-sequence', 'image.sequence-index');
  const covered = g.add('covered', 'math.clamp.scalar', { value: g.binary('covered-raw', 'math.subtract.scalar', boxes, [coarseSequence, 'index']), min: 'zero', max: 'one' });
  const entry = g.binary('coarse-entry', 'math.add.scalar', [coarseSequence, 'index'], g.binary('covered-half', 'math.multiply.scalar', covered, 'half'));
  const along = g.binary('along', 'math.multiply.scalar', entry, step);
  const coarseU = g.binary('coarse-u', 'math.add.scalar', rangeStart, g.binary('along-signed', 'math.multiply.scalar', along, direction));
  const taperT = g.binary('taper-t', 'math.divide-ieee.scalar', along, spanSafe);
  let taper: GraphPort = 'one';
  if (type === 'motion-blur') {
    // Legacy soft streak: exp(-2 * (2t - 1)^2).
    const centered = g.binary('taper-centered', 'math.subtract.scalar', g.binary('taper-double', 'math.multiply.scalar', taperT, 'two'), 'one');
    g.number('taper-gain', -2);
    taper = g.unary('taper', 'math.exp.scalar', g.binary('taper-exponent', 'math.multiply.scalar', g.binary('taper-squared', 'math.multiply.scalar', centered, centered), 'taper-gain'));
  } else if (type === 'radial-blur') {
    // Legacy radial zoom weights 1 - 0.5 t; Spin is uniform.
    const legacy = g.binary('taper-legacy', 'math.subtract.scalar', 'one', g.binary('taper-falloff', 'math.multiply.scalar', taperT, 'half'));
    taper = g.add('taper', 'select.scalar', { condition: ['is-spin', 'condition'], falseValue: legacy, trueValue: 'one' });
  }
  const weight = g.binary('coarse-weight', 'math.multiply.scalar', taper, g.binary('covered-weight', 'math.max.scalar', covered, 'covered-floor'));
  const coarseSample = g.add('coarse-sample', 'image.sample', { image: [cache, 'image'], uv: transform(g, type, 'coarse', coarsePixel, coarseU) });
  const coarseReduce = g.add('coarse-reduce', 'image.sequence-reduce', { sample: [coarseSample, 'image'], weight, count: countHere });
  unpremultiplyNodes(g, normalizeNodes(g, 'coarse', coarseReduce));
  return g.graph();
}

export function createDefaultMotionBlurGraph(): EffectOperatorGraph { return createTwoStageBlurGraph('motion-blur'); }
export function createDefaultRadialBlurGraph(): EffectOperatorGraph { return createTwoStageBlurGraph('radial-blur'); }
export function createDefaultZoomBlurGraph(): EffectOperatorGraph { return createTwoStageBlurGraph('zoom-blur'); }

export function createDefaultDirectionalBlurGraph(type: EditableDirectionalBlurEffectType): EffectOperatorGraph {
  return createTwoStageBlurGraph(type);
}
