import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { kneeRom1GainGraph } from './smokeGainUpgrade';

/** Smallest fade per frame (three quarters of an 8-bit step), so every trail reaches zero on 8-bit history. */
export const ROM1_TRAIL_FADE_FLOOR = 0.75 / 255;

type Ref = { node: string; port: string };
class Graph {
  readonly nodes: BoundOperatorNode[] = []; readonly edges: OperatorEdge[] = []; readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 12) * 290, y: Math.floor(this.nodes.length / 12) * 230 }; return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${from.port}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value', port = 'value') { const out = this.node(id, operator, port); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref, port = 'value') { const out = this.node(id, operator, port); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  vec2(id: string, x: Ref, y: Ref) { const out = this.node(id, 'vector.combine.vec2'); this.edge(x, out, 'x'); this.edge(y, out, 'y'); return out; }
}

function noise2d(g: Graph, id: string, point: Ref, zero: Ref, one: Ref, two: Ref, three: Ref): Ref {
  const integer = g.unary(`${id}-integer`, 'math.floor.vec2', point), fraction = g.unary(`${id}-fraction`, 'math.fract.vec2', point);
  const squared = g.binary(`${id}-squared`, 'math.multiply.vec2', fraction, fraction);
  const twice = g.node(`${id}-twice`, 'math.multiply.vec2-scalar'); g.edge(fraction, twice, 'a'); g.edge(two, twice, 'b');
  const three2 = g.unary(`${id}-three`, 'convert.scalar-to-vec2', three), fade = g.binary(`${id}-fade`, 'math.multiply.vec2', squared, g.binary(`${id}-fade-base`, 'math.subtract.vec2', three2, twice));
  const fadeParts = g.node(`${id}-fade-parts`, 'vector.split.vec2', 'x'); g.edge(fade, fadeParts, 'value');
  const pointAt = (suffix: string, x: Ref, y: Ref) => g.binary(`${id}-${suffix}`, 'math.add.vec2', integer, g.vec2(`${id}-${suffix}-offset`, x, y));
  const hash = (suffix: string, value: Ref) => g.unary(`${id}-hash-${suffix}`, 'noise.hash2d.vec2', value);
  const h00 = hash('00', pointAt('p00', zero, zero)), h10 = hash('10', pointAt('p10', one, zero));
  const h01 = hash('01', pointAt('p01', zero, one)), h11 = hash('11', pointAt('p11', one, one));
  const mix = (suffix: string, a: Ref, b: Ref, t: Ref) => { const out = g.node(`${id}-${suffix}`, 'math.mix.scalar'); g.edge(a, out, 'a'); g.edge(b, out, 'b'); g.edge(t, out, 't'); return out; };
  return mix('result', mix('row-zero', h00, h10, { node: fadeParts.node, port: 'x' }),
    mix('row-one', h01, h11, { node: fadeParts.node, port: 'x' }), { node: fadeParts.node, port: 'y' });
}

/**
 * Granular four-octave expansion of the ROM1 feedback shader. Since 2026-10-22 the trail is kept premultiplied
 * (a cut-out layer's smoke fades in alpha, not to black); opaque layers render as before.
 */
export function createDefaultRom1Graph(): EffectOperatorGraph { return createRom1Graph('premultiplied'); }

/**
 * The recipe saved before 2026-10-22: it faded the trail's straight colour together with its alpha, so smoke outside
 * a cut-out layer turned dark. Untouched saved copies upgrade on load (upgradeRom1Graph); only recognition uses it.
 */
export function createRom1GraphBefore20261022(): EffectOperatorGraph { return createRom1Graph('straight'); }

function createRom1Graph(recipe: 'straight' | 'premultiplied'): EffectOperatorGraph {
  const g = new Graph(), frame = g.node('frame', 'image.frame', 'image'), history = g.node('history', 'image.frame-history', 'image');
  const uv = g.node('uv', 'image.normalized-uv', 'uv'), time = g.node('time', 'image.timeline-time');
  const bind = (id: string) => g.node(id, 'values.number', 'value', { value: id });
  const opacity = bind('opacity'), gain = bind('gain'), speed = bind('speed'), detail = bind('detail'), strength = bind('strength');
  const density = bind('density'), gainX = bind('gainX'), gainY = bind('gainY');
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), three = g.number('three', 3), tiny = g.number('tiny', .001);
  const safeDensity = g.binary('safe-density', 'math.max.scalar', density, tiny), safeDetail = g.binary('safe-detail', 'math.max.scalar', detail, tiny);
  const noiseGain = g.binary('noise-gain', 'math.max.scalar', speed, tiny);
  const densityUv = g.node('density-uv', 'math.multiply.vec2-scalar'); g.edge(uv, densityUv, 'a'); g.edge(safeDensity, densityUv, 'b');
  const noiseUv = g.node('noise-uv', 'math.multiply.vec2-scalar'); g.edge(densityUv, noiseUv, 'a'); g.edge(safeDetail, noiseUv, 'b');
  let sum = g.unary('sum-zero', 'convert.scalar-to-vec2', zero), normalizer = zero, amplitude = g.number('amplitude-0', .5), frequency = one;
  const amplitudeRatio = g.number('amplitude-ratio', .53);
  for (let index = 0; index < 4; index++) {
    const octavePoint = g.node(`octave-${index}-point`, 'math.multiply.vec2-scalar'); g.edge(noiseUv, octavePoint, 'a'); g.edge(frequency, octavePoint, 'b');
    const octaveTimeOffset = g.binary(`octave-${index}-time-offset`, 'math.multiply.scalar', g.number(`octave-${index}-index`, index), g.number(`octave-${index}-time-step`, 13.37));
    const octaveTime = g.binary(`octave-${index}-time`, 'math.add.scalar', time, octaveTimeOffset);
    const shifted = (id: string, x: Ref, y: Ref) => g.binary(id, 'math.add.vec2', octavePoint, g.vec2(`${id}-offset`, x, y));
    const n1 = noise2d(g, `octave-${index}-n1`, shifted(`octave-${index}-n1-point`,
      g.binary(`octave-${index}-n1-x`, 'math.multiply.scalar', octaveTime, g.number(`octave-${index}-071`, .071)),
      g.binary(`octave-${index}-n1-y`, 'math.multiply.scalar', octaveTime, g.number(`octave-${index}-113`, .113))), zero, one, two, three);
    const point1173 = g.node(`octave-${index}-point1173`, 'math.multiply.vec2-scalar'); g.edge(octavePoint, point1173, 'a'); g.edge(g.number(`octave-${index}-1173`, 1.173), point1173, 'b');
    const n2x = g.binary(`octave-${index}-n2-x`, 'math.subtract.scalar', g.number(`octave-${index}-1917`, 19.17),
      g.binary(`octave-${index}-097t`, 'math.multiply.scalar', octaveTime, g.number(`octave-${index}-097`, .097)));
    const n2y = g.binary(`octave-${index}-n2-y`, 'math.add.scalar', g.number(`octave-${index}-731`, 7.31),
      g.binary(`octave-${index}-053t`, 'math.multiply.scalar', octaveTime, g.number(`octave-${index}-053`, .053)));
    const n2 = noise2d(g, `octave-${index}-n2`, g.binary(`octave-${index}-n2-point`, 'math.add.vec2', point1173, g.vec2(`octave-${index}-n2-offset`, n2x, n2y)), zero, one, two, three);
    const vector = g.vec2(`octave-${index}-noise`, n1, n2), vector2 = g.node(`octave-${index}-noise2`, 'math.multiply.vec2-scalar'); g.edge(vector, vector2, 'a'); g.edge(two, vector2, 'b');
    const centered = g.binary(`octave-${index}-centered`, 'math.subtract.vec2', vector2, g.unary(`octave-${index}-one2`, 'convert.scalar-to-vec2', one));
    const weighted = g.node(`octave-${index}-weighted`, 'math.multiply.vec2-scalar'); g.edge(centered, weighted, 'a'); g.edge(amplitude, weighted, 'b');
    sum = g.binary(`sum-${index}`, 'math.add.vec2', sum, weighted); normalizer = g.binary(`normalizer-${index}`, 'math.add.scalar', normalizer, amplitude);
    if (index < 3) { amplitude = g.binary(`amplitude-${index + 1}`, 'math.multiply.scalar', amplitude, amplitudeRatio); frequency = g.binary(`frequency-${index + 1}`, 'math.multiply.scalar', frequency, two); }
  }
  const offsetBase = g.binary('offset-base', 'math.divide-ieee.vec2', sum, g.unary('normalizer-vec2', 'convert.scalar-to-vec2', normalizer));
  const negativeY = g.binary('negative-gain-y', 'math.multiply.scalar', gainY, g.number('negative-one', -1)), gainVector = g.vec2('gain-vector', gainX, negativeY);
  const scaled = (id: string, value: Ref, factor: Ref) => { const out = g.node(id, 'math.multiply.vec2-scalar'); g.edge(value, out, 'a'); g.edge(factor, out, 'b'); return out; };
  const gainStrength = scaled('gain-strength', gainVector, strength), gainScale = scaled('gain-scale', gainStrength, g.number('offset-factor', .005));
  const gainNoise = scaled('gain-noise', gainScale, noiseGain), offset = g.binary('offset', 'math.multiply.vec2', offsetBase, gainNoise);
  const warped = g.binary('warped-uv', 'math.add.vec2', uv, offset);
  const zero2 = g.unary('zero-vec2', 'convert.scalar-to-vec2', zero), one2 = g.unary('one-vec2', 'convert.scalar-to-vec2', one);
  const clamped = g.node('feedback-uv', 'math.clamp.vec2'); g.edge(warped, clamped, 'value'); g.edge(zero2, clamped, 'min'); g.edge(one2, clamped, 'max');
  const sample = (id: string, image: Ref, coordinate: Ref) => { const out = g.node(id, 'image.sample', 'image'); g.edge(image, out, 'image'); g.edge(coordinate, out, 'uv'); return out; };
  const source = sample('source', frame, uv), wet = sample('wet-source', frame, clamped), feedback = sample('feedback-sample', history, clamped);
  const warpedParts = g.node('warped-parts', 'vector.split.vec2', 'x'); g.edge(warped, warpedParts, 'value');
  const edgeX = g.binary('edge-x', 'math.min.scalar', { node: warpedParts.node, port: 'x' }, g.binary('one-minus-x', 'math.subtract.scalar', one, { node: warpedParts.node, port: 'x' }));
  const edgeY = g.binary('edge-y', 'math.min.scalar', { node: warpedParts.node, port: 'y' }, g.binary('one-minus-y', 'math.subtract.scalar', one, { node: warpedParts.node, port: 'y' }));
  const edgeMask = g.node('edge-mask', 'math.smoothstep.scalar'); g.edge(g.number('edge-low', -.005), edgeMask, 'edge0'); g.edge(g.number('edge-high', .025), edgeMask, 'edge1'); g.edge(g.binary('edge', 'math.min.scalar', edgeX, edgeY), edgeMask, 'value');
  const split = (id: string, image: Ref) => { const out = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(image, out, 'image'); return out; };
  const numericAlpha = (id: string, image: Ref) => { const value = g.unary(`${id}-vec4`, 'convert.image-to-vec4', image, 'image'); const parts = g.node(`${id}-components`, 'vector.split.vec4', 'w'); g.edge(value, parts, 'value'); return { node: parts.node, port: 'w' }; };
  const safeGain = g.binary('safe-gain', 'math.max.scalar', gain, zero), gainRgb = g.unary('gain-rgb', 'convert.scalar-to-rgb', safeGain, 'value', 'rgb');
  // Trail (2026-10-22): the share kept per frame, 0 to 0.995; the recipe before it kept a fixed 0.98.
  const decay = recipe === 'straight' ? g.number('feedback-decay', .98) : g.node('trail-clamped', 'math.clamp.scalar');
  if (recipe !== 'straight') { g.edge(bind('trail'), decay, 'value'); g.edge(zero, decay, 'min'); g.edge(g.number('trail-max', .995), decay, 'max'); }
  const opacityClamp = g.node('opacity-clamp', 'math.clamp.scalar'); g.edge(opacity, opacityClamp, 'value'); g.edge(zero, opacityClamp, 'min'); g.edge(one, opacityClamp, 'max');
  const finish = { g, frame, source, wet, feedback, edgeMask, split, numericAlpha, gainRgb, decay, opacityClamp, zero, one, tiny };
  if (recipe === 'straight') finishStraight(finish); else finishPremultiplied(finish);
  // Gain passes a knee instead of lifting every pixel to white (smokeGainUpgrade.ts, also for saved graphs).
  return kneeRom1GainGraph({ version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout });
}

interface Rom1Finish {
  g: Graph; frame: Ref; source: Ref; wet: Ref; feedback: Ref; edgeMask: Ref; gainRgb: Ref; decay: Ref; opacityClamp: Ref; zero: Ref; one: Ref; tiny: Ref;
  split: (id: string, image: Ref) => Ref; numericAlpha: (id: string, image: Ref) => Ref;
}

function output(g: Graph, rgb: Ref, alpha: Ref) {
  const vector = g.unary('water-rgb-vector', 'convert.rgb-to-vec3', rgb, 'rgb'), parts = g.node('water-rgb-parts', 'vector.split.vec3', 'x'); g.edge(vector, parts, 'value');
  const value = g.node('water-value', 'vector.combine.vec4'); for (const component of ['x', 'y', 'z'] as const) g.edge({ node: parts.node, port: component }, value, component); g.edge(alpha, value, 'w');
  return value;
}

/** Before 2026-10-22: straight colour, decayed and kept brighter like the alpha. */
function finishStraight({ g, source, wet, feedback, edgeMask, split, numericAlpha, gainRgb, decay, opacityClamp, zero, one }: Rom1Finish) {
  const maskedFeedback = g.node('feedback-masked', 'math.multiply.image-scalar'); g.edge(feedback, maskedFeedback, 'a'); g.edge(edgeMask, maskedFeedback, 'b');
  const sourceParts = split('source', source), wetParts = split('wet', wet), feedbackParts = split('feedback', maskedFeedback);
  const sourceAlpha = numericAlpha('source-alpha', source), feedbackAlpha = numericAlpha('feedback-alpha', maskedFeedback);
  const wetMix = g.node('wet-mix', 'math.mix.rgb'); g.edge({ node: sourceParts.node, port: 'rgb' }, wetMix, 'a'); g.edge({ node: wetParts.node, port: 'rgb' }, wetMix, 'b'); g.edge(g.number('wet-factor', .18), wetMix, 't');
  const alphaGain = g.node('alpha-gain', 'math.multiply.rgb-scalar'); g.edge(gainRgb, alphaGain, 'a'); g.edge(sourceAlpha, alphaGain, 'b');
  const liftedRaw = g.binary('lifted-raw', 'math.add.rgb', wetMix, alphaGain), lifted = g.node('lifted', 'math.clamp.rgb-scalar');
  g.edge(liftedRaw, lifted, 'value'); g.edge(zero, lifted, 'min'); g.edge(one, lifted, 'max');
  const advected = g.node('advected', 'math.multiply.rgb-scalar'); g.edge({ node: feedbackParts.node, port: 'rgb' }, advected, 'a'); g.edge(decay, advected, 'b');
  const waterRgb = g.node('water-rgb', 'math.max.rgb'); g.edge(lifted, waterRgb, 'a'); g.edge(advected, waterRgb, 'b');
  const decayedAlpha = g.binary('feedback-alpha-decayed', 'math.multiply.scalar', feedbackAlpha, decay);
  const alphaMax = g.binary('water-alpha-max', 'math.max.scalar', sourceAlpha, decayedAlpha);
  const waterAlpha = g.node('water-alpha', 'math.clamp.scalar'); g.edge(alphaMax, waterAlpha, 'value'); g.edge(zero, waterAlpha, 'min'); g.edge(one, waterAlpha, 'max');
  const waterValue = output(g, waterRgb, waterAlpha), sourceValue = g.unary('source-value', 'convert.image-to-vec4', source, 'image');
  const mixed = g.node('mixed', 'math.mix.vec4'); g.edge(sourceValue, mixed, 'a'); g.edge(waterValue, mixed, 'b'); g.edge(opacityClamp, mixed, 't');
  const result = g.unary('result', 'convert.vec4-to-image', mixed, 'value', 'image'), out = g.node('output', 'image.output', ''); g.edge(result, out, 'image');
}

/**
 * Premultiplied: colour × alpha is decayed and kept brighter, so a trail outside a cut-out fades in alpha and keeps its
 * colour; Opacity blends premultiplied and the result is divided back to straight colour. With alpha 1 everywhere every
 * step equals the straight recipe.
 */
function finishPremultiplied({ g, source, wet, feedback, edgeMask, split, numericAlpha, gainRgb, decay, opacityClamp, zero, one, tiny }: Rom1Finish) {
  const sourceParts = split('source', source), wetParts = split('wet', wet), feedbackParts = split('feedback', feedback);
  const sourceAlpha = numericAlpha('source-alpha', source), wetAlpha = numericAlpha('wet-alpha', wet), rawFeedbackAlpha = numericAlpha('feedback-alpha', feedback);
  const feedbackAlpha = g.binary('feedback-alpha-masked', 'math.multiply.scalar', rawFeedbackAlpha, edgeMask);
  const premultiplied = (id: string, rgb: Ref, alpha: Ref) => { const out = g.node(id, 'math.multiply.rgb-scalar'); g.edge(rgb, out, 'a'); g.edge(alpha, out, 'b'); return out; };
  const sourceP = premultiplied('source-premultiplied', { node: sourceParts.node, port: 'rgb' }, sourceAlpha);
  const wetP = premultiplied('wet-premultiplied', { node: wetParts.node, port: 'rgb' }, wetAlpha);
  const feedbackP = premultiplied('feedback-premultiplied', { node: feedbackParts.node, port: 'rgb' }, feedbackAlpha);
  const wetMix = g.node('wet-mix', 'math.mix.rgb'); g.edge(sourceP, wetMix, 'a'); g.edge(wetP, wetMix, 'b'); g.edge(g.number('wet-factor', .18), wetMix, 't');
  const alphaGain = g.node('alpha-gain', 'math.multiply.rgb-scalar'); g.edge(gainRgb, alphaGain, 'a'); g.edge(sourceAlpha, alphaGain, 'b');
  // The lift stays within the source's own coverage (1 on an opaque layer, as before).
  const liftedRaw = g.binary('lifted-raw', 'math.add.rgb', wetMix, alphaGain), lifted = g.node('lifted', 'math.clamp.rgb-scalar');
  g.edge(liftedRaw, lifted, 'value'); g.edge(zero, lifted, 'min'); g.edge(sourceAlpha, lifted, 'max');
  const advected = g.node('advected', 'math.multiply.rgb-scalar'); g.edge(feedbackP, advected, 'a'); g.edge(decay, advected, 'b');
  // The frame history is 8-bit: a fade smaller than half a step rounds back to the same value, so a
  // high Trail left a grey ghost that never went (Trail 0.995 at 100 of 255). Each frame fades by at
  // least ROM1_TRAIL_FADE_FLOOR; above that the share kept is exactly Trail.
  const floor = g.number('trail-fade-floor', ROM1_TRAIL_FADE_FLOOR);
  const floorRgb = g.unary('trail-fade-floor-rgb', 'convert.scalar-to-rgb', floor, 'value', 'rgb');
  const zeroRgb = g.unary('trail-zero-rgb', 'convert.scalar-to-rgb', zero, 'value', 'rgb');
  const shortfall = g.binary('trail-shortfall', 'math.max.rgb', g.binary('trail-shortfall-raw', 'math.subtract.rgb', floorRgb,
    g.binary('trail-faded-by', 'math.subtract.rgb', feedbackP, advected)), zeroRgb);
  const faded = g.binary('trail-faded', 'math.subtract.rgb', advected, shortfall);
  const waterRgb = g.node('water-rgb', 'math.max.rgb'); g.edge(lifted, waterRgb, 'a'); g.edge(faded, waterRgb, 'b');
  const decayedAlpha = g.binary('feedback-alpha-decayed', 'math.multiply.scalar', feedbackAlpha, decay);
  const alphaShortfall = g.binary('trail-alpha-shortfall', 'math.max.scalar', g.binary('trail-alpha-shortfall-raw', 'math.subtract.scalar', floor,
    g.binary('trail-alpha-faded-by', 'math.subtract.scalar', feedbackAlpha, decayedAlpha)), zero);
  const fadedAlpha = g.binary('trail-alpha-faded', 'math.subtract.scalar', decayedAlpha, alphaShortfall);
  const alphaMax = g.binary('water-alpha-max', 'math.max.scalar', sourceAlpha, fadedAlpha);
  const waterAlpha = g.node('water-alpha', 'math.clamp.scalar'); g.edge(alphaMax, waterAlpha, 'value'); g.edge(zero, waterAlpha, 'min'); g.edge(one, waterAlpha, 'max');
  const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceP, mixed, 'a'); g.edge(waterRgb, mixed, 'b'); g.edge(opacityClamp, mixed, 't');
  const mixedAlpha = g.node('mixed-alpha', 'math.mix.scalar'); g.edge(sourceAlpha, mixedAlpha, 'a'); g.edge(waterAlpha, mixedAlpha, 'b'); g.edge(opacityClamp, mixedAlpha, 't');
  const coverage = g.binary('mixed-alpha-safe', 'math.max.scalar', mixedAlpha, tiny);
  const straight = g.node('straight', 'math.divide-ieee.rgb-scalar'); g.edge(mixed, straight, 'a'); g.edge(coverage, straight, 'b');
  const straightClamped = g.node('straight-clamped', 'math.clamp.rgb-scalar'); g.edge(straight, straightClamped, 'value'); g.edge(zero, straightClamped, 'min'); g.edge(one, straightClamped, 'max');
  const value = output(g, straightClamped, mixedAlpha);
  const result = g.unary('result', 'convert.vec4-to-image', value, 'value', 'image'), out = g.node('output', 'image.output', ''); g.edge(result, out, 'image');
}
