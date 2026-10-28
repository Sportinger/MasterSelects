import type { GraphPort } from './blurGraphBuilder';
import type { AnalogRecipeBuilder } from './analogRecipeBuilder';

/** Taps each side of a Gaussian pass at most (Sequence Reduce runs 1..256 entries); wider blurs spread them. */
export const GAUSSIAN_SIDE_MAX = 127;
/** Finite-difference step of the curl, in noise cells. */
const CURL_STEP = 0.05;
/** Typical slope of 2-octave Fractal Noise per noise cell, so a curl vector is about 1 long. */
const CURL_SLOPE = 0.55;

/**
 * Shared flow-field parts of the image recipes (Flow Mosh): a separable Gaussian, a 2-D curl noise and a
 * streamline traced backwards through a cached flow image. Each part is a chain of atomic nodes, so the
 * same chain can be rebuilt in the node graph. They need the constants `zero`, `one`, `half`, `tiny`
 * and the nodes `uv` and `resolution`.
 */

/**
 * One Gaussian pass along `axis` over `source`, `sigma` texels of the pass it runs in (Sequence Reduce of
 * up to 2 × 127 + 1 taps; wider kernels spread their taps evenly). Returns the normalised image port.
 */
export function gaussianPass(g: AnalogRecipeBuilder, p: string, axis: 'x' | 'y', source: GraphPort, sigma: GraphPort): GraphPort {
  const reach = g.mul(`${p}-reach`, g.max(`${p}-sigma`, sigma, g.number(`${p}-sigma-min`, .3)), g.number(`${p}-three`, 3));
  const side = g.min(`${p}-side`, g.unary(`${p}-side-needed`, 'math.ceil.scalar', reach), g.number(`${p}-side-max`, GAUSSIAN_SIDE_MAX));
  const stride = g.max(`${p}-stride`, g.div(`${p}-stride-raw`, reach, side), 'one');
  const count = g.plus(`${p}-count`, g.mul(`${p}-count-sides`, side, g.number(`${p}-two`, 2)), 'one');
  const index = g.add(`${p}-index`, 'image.sequence-index');
  const offset = g.mul(`${p}-offset`, g.sub(`${p}-signed`, [index, 'index'], side), stride);
  const vector = axis === 'x' ? g.vec2(`${p}-offset-vec2`, offset, 'zero') : g.vec2(`${p}-offset-vec2`, 'zero', offset);
  const uv = g.add2(`${p}-uv`, ['uv', 'uv'], g.binary(`${p}-offset-uv`, 'math.divide-ieee.vec2', vector, ['resolution', 'value']));
  const read = g.add(`${p}-read`, 'image.sample', { image: source, uv });
  const weight = g.add(`${p}-weight`, 'math.gaussian.scalar', { value: offset, sigma: g.max(`${p}-weight-sigma`, sigma, `${p}-sigma-min`) });
  const reduce = g.add(`${p}-reduce`, 'image.sequence-reduce', { sample: [read, 'image'], weight, count });
  const mean = g.add(`${p}-mean`, 'math.divide-ieee.vec4', { a: [reduce, 'sum'],
    b: g.add(`${p}-weight-vec4`, 'convert.scalar-to-vec4', { value: g.max(`${p}-safe-weight`, [reduce, 'weightSum'], 'tiny') }) });
  return [g.add(`${p}-image`, 'convert.vec4-to-image', { value: mean }), 'image'];
}

/** Divergence-free swirl at `at` (noise cells): the curl (dn/dy, −dn/dx) of 2-octave Fractal Noise, about 1 long. */
export function curlNoise(g: AnalogRecipeBuilder, p: string, at: GraphPort): GraphPort {
  const step = g.number(`${p}-step`, CURL_STEP);
  const noise = (id: string, dx: number, dy: number) => g.add(`${p}-${id}`, 'noise.fractal2d.vec2', {
    value: dx || dy ? g.add2(`${p}-${id}-at`, at, g.vec2(`${p}-${id}-shift`, dx ? (dx > 0 ? step : g.sub(`${p}-${id}-neg`, 'zero', step)) : 'zero',
      dy ? (dy > 0 ? step : g.sub(`${p}-${id}-neg`, 'zero', step)) : 'zero')) : at,
    octaves: g.number(`${p}-${id}-octaves`, 2), roughness: 'half' });
  const scale = g.number(`${p}-scale`, 1 / (2 * CURL_STEP * CURL_SLOPE));
  const dy = g.mul(`${p}-dndy`, g.sub(`${p}-dy`, noise('up', 0, 1), noise('down', 0, -1)), scale);
  const dx = g.mul(`${p}-dndx`, g.sub(`${p}-dx`, noise('right', 1, 0), noise('left', -1, 0)), scale);
  return g.vec2(`${p}-curl`, dy, g.sub(`${p}-curl-y`, 'zero', dx));
}

/**
 * Traces a streamline backwards from `start` (pixels) through the flow image `flow` (RG = direction per unit
 * length, read with normalized UV) for `distance` pixels in `steps` equal steps. Returns the end point (pixels).
 */
export function traceBack(g: AnalogRecipeBuilder, p: string, flow: string, start: GraphPort, distance: GraphPort, steps: number): GraphPort {
  const stepLength = g.div(`${p}-step-length`, distance, g.number(`${p}-steps`, steps));
  let point: GraphPort = start;
  for (let step = 0; step < steps; step++) {
    const id = `${p}-${step}`;
    const uv = g.binary(`${id}-uv`, 'math.divide-ieee.vec2', point, ['resolution', 'value']);
    g.add(`${id}-read`, 'image.sample', { image: [flow, 'image'], uv });
    g.add(`${id}-split`, 'vector.split.rgba', { image: [`${id}-read`, 'image'] });
    g.add(`${id}-xyz`, 'vector.split.vec3', { value: g.add(`${id}-rg`, 'convert.rgb-to-vec3', { rgb: [`${id}-split`, 'rgb'] }) });
    const direction = g.vec2(`${id}-flow`, [`${id}-xyz`, 'x'], [`${id}-xyz`, 'y']);
    point = g.sub2(`${id}-point`, point, g.scale2(`${id}-move`, direction, stepLength));
  }
  return point;
}
