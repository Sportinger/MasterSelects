import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/**
 * Object mask shared by the Glitch / Data recipes (Block Dissolve, Data HUD): which pixels belong to the
 * object, by brightness against Threshold (Dark on light, Light on dark), by alpha, everywhere, or by how
 * far the colour differs from the frame edge in the same row (Differs from edge: a render on a studio
 * backdrop or a gradient, where the object is as bright as the background).
 *
 * Contract: the recipe defines the constants `zero`, `one` and `half`, the input `frame` and normalized
 * `uv`, and for `objectMap` the straight frame split `source-split` with its alpha `source-alpha`. The
 * Object choice reads the option index of the `mask` parameter (Dark on light 0, Light on dark 1, Alpha 2,
 * Everywhere 3, Differs from edge 4) and `threshold`.
 */
export function objectMaskControls(g: AnalogRecipeBuilder): void {
  g.clampedParam('threshold', 'threshold', 'zero', 'one');
  g.bound('mask', 'mask', 'values.choice');
  g.add('mask-light-or-alpha', 'math.step.scalar', { edge: 'half', value: 'mask' });
  g.add('mask-alpha', 'math.step.scalar', { edge: g.number('mask-alpha-edge', 1.5), value: 'mask' });
  g.add('mask-everywhere', 'math.step.scalar', { edge: g.number('mask-everywhere-edge', 2.5), value: 'mask' });
  g.add('mask-edge', 'math.step.scalar', { edge: g.number('mask-edge-edge', 3.5), value: 'mask' });
}

/** Where the backdrop is read: just inside the left and right frame edges. */
const EDGE_READ_X = [.008, .992] as const;

/**
 * How far a straight colour `rgb` at `uv` differs from the backdrop: the largest channel difference to the
 * frame edge colour in the same row, the nearer of the left and right edge (an object touching one side
 * still finds the backdrop on the other).
 */
export function edgeDistance(g: AnalogRecipeBuilder, id: string, rgb: GraphPort, uv: GraphPort) {
  const [, y] = g.split2(`${id}-uv-split`, uv);
  const sides = EDGE_READ_X.map((x, k) => {
    g.add(`${id}-side${k}-sample`, 'image.sample', { image: ['frame', 'image'], uv: g.vec2(`${id}-side${k}-uv`, g.number(`${id}-side${k}-x`, x), y) });
    g.add(`${id}-side${k}-split`, 'vector.split.rgba', { image: [`${id}-side${k}-sample`, 'image'] });
    const difference = g.binary(`${id}-side${k}-difference`, 'math.subtract.rgb', rgb, [`${id}-side${k}-split`, 'rgb']);
    const magnitude = g.binary(`${id}-side${k}-magnitude`, 'math.max.rgb', difference, g.scaleRgb(`${id}-side${k}-negated`, difference, g.number(`${id}-side${k}-minus`, -1)));
    return g.add(`${id}-side${k}-distance`, 'vector.reduce-max.rgb', { rgb: magnitude });
  });
  return g.min(id, sides[0], sides[1]);
}

/** Object weight (0 or 1) of a straight sample: by brightness against Threshold, by alpha, or everywhere. */
export function objectWeight(g: AnalogRecipeBuilder, id: string, luma: GraphPort, alpha: GraphPort) {
  const light = g.add(`${id}-light`, 'math.step.scalar', { edge: 'threshold-clamped', value: luma });
  const tone = g.mix(`${id}-tone`, g.sub(`${id}-dark`, 'one', light), light, 'mask-light-or-alpha');
  const byBrightness = g.mul(`${id}-by-brightness`, tone, g.add(`${id}-covered`, 'math.step.scalar', { edge: 'half', value: alpha }));
  const byAlpha = g.add(`${id}-by-alpha`, 'math.step.scalar', { edge: 'threshold-clamped', value: alpha });
  return g.mix(id, g.mix(`${id}-masked`, byBrightness, byAlpha, 'mask-alpha'), 'one', 'mask-everywhere');
}

/** The object weight of every pixel (0 or 1, in all three channels), cached once as `object-cache`. */
export function objectMap(g: AnalogRecipeBuilder): void {
  const luma = g.add('source-luma', 'color.luminance-rec709.rgb', { rgb: ['source-split', 'rgb'] });
  const toned = objectWeight(g, 'object-toned', luma, 'source-alpha');
  // Differs from edge: covered pixels whose colour is more than Threshold away from the row's backdrop.
  const differs = g.add('object-differs', 'math.step.scalar', { edge: 'threshold-clamped', value: edgeDistance(g, 'object-edge-distance', ['source-split', 'rgb'], ['uv', 'uv']) });
  const fromEdge = g.mul('object-from-edge', differs, g.add('object-edge-covered', 'math.step.scalar', { edge: 'half', value: 'source-alpha' }));
  const object = g.mix('object', toned, fromEdge, 'mask-edge');
  g.add('object-image', 'vector.combine.rgba', { rgb: g.rgbConstant('object-rgb', object), alpha: ['source-split', 'alpha'] });
  g.add('object-cache', 'image.materialize', { image: ['object-image', 'image'] });
}

/** Object weight (0 or 1) from the cached object map at `uv`. */
export function objectAt(g: AnalogRecipeBuilder, id: string, uv: GraphPort) {
  g.add(`${id}-sample`, 'image.sample', { image: ['object-cache', 'image'], uv });
  g.add(`${id}-split`, 'vector.split.rgba', { image: [`${id}-sample`, 'image'] });
  g.add(`${id}-vector`, 'convert.rgb-to-vec3', { rgb: [`${id}-split`, 'rgb'] });
  g.add(`${id}-components`, 'vector.split.vec3', { value: `${id}-vector` });
  // Bilinear reads between object and background land between 0 and 1.
  return g.add(`${id}-object`, 'math.step.scalar', { edge: 'half', value: [`${id}-components`, 'x'] });
}
