import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/**
 * Object mask shared by the Glitch / Data recipes (Block Dissolve, Data HUD): which pixels belong to the
 * object, by brightness against Threshold (Dark on light, Light on dark), by alpha, or everywhere.
 *
 * Contract: the recipe defines the constants `zero`, `one` and `half`, and for `objectMap` the straight
 * frame split `source-split` with its alpha `source-alpha`. The Object choice reads the option index of
 * the `mask` parameter (Dark on light 0, Light on dark 1, Alpha 2, Everywhere 3) and `threshold`.
 */
export function objectMaskControls(g: AnalogRecipeBuilder): void {
  g.clampedParam('threshold', 'threshold', 'zero', 'one');
  g.bound('mask', 'mask', 'values.choice');
  g.add('mask-light-or-alpha', 'math.step.scalar', { edge: 'half', value: 'mask' });
  g.add('mask-alpha', 'math.step.scalar', { edge: g.number('mask-alpha-edge', 1.5), value: 'mask' });
  g.add('mask-everywhere', 'math.step.scalar', { edge: g.number('mask-everywhere-edge', 2.5), value: 'mask' });
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
  const object = objectWeight(g, 'object', luma, 'source-alpha');
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
