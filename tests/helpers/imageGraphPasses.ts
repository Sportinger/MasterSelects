import { evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

export type Pixel = [number, number, number, number];
type Sampler = (uv: [number, number]) => Pixel;

export interface PassEvaluationOptions {
  /**
   * Emulate the GPU: every cached resource is a texture of the frame size whose texels are its
   * producer pass evaluated at texel centres, read with bilinear filtering and clamp-to-edge.
   * Without it a cached resource is evaluated exactly at the sampled UV (an idealised cache).
   */
  filterResources?: boolean;
  /** Store cached texels as float16, like the rgba16float caches. */
  float16?: boolean;
  /** Composition timeline time in seconds (default 0). */
  time?: number;
}

const f16round = (Math as unknown as { f16round?: (value: number) => number }).f16round ?? ((value: number) => value);

/** Bilinear, clamp-to-edge read of a discrete texture given by its texels. */
function bilinear(width: number, height: number, texel: (x: number, y: number) => Pixel, [u, v]: [number, number]): Pixel {
  const x = u * width - 0.5, y = v * height - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const clampX = (value: number) => Math.min(width - 1, Math.max(0, value)), clampY = (value: number) => Math.min(height - 1, Math.max(0, value));
  const corners: Array<[number, number, number]> = [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]];
  const result: Pixel = [0, 0, 0, 0];
  for (const [cx, cy, weight] of corners) {
    if (!weight) continue;
    texel(clampX(cx), clampY(cy)).forEach((value, channel) => { result[channel] += value * weight; });
  }
  return result;
}

/** A discrete RGBA texture (straight alpha) sampled like a GPU texture with a linear, clamp-to-edge sampler. */
export function discreteImage(width: number, height: number, pixel: (x: number, y: number) => Pixel): Sampler {
  return uv => bilinear(width, height, pixel, uv);
}

/** Evaluates a (multi-pass) image plan on the CPU; caches are shared between calls of the returned function. */
export function createImagePassEvaluator(plan: ImageOperatorPlan, resolution: [number, number], sampleImage: Sampler,
  options: PassEvaluationOptions = {}): Sampler {
  const caches = new Map<string, Map<number, Pixel>>();
  const producer = (id: string) => {
    const pass = plan.passes?.find(candidate => candidate.outputResource === id);
    if (!pass) throw new Error(`No pass produces ${id}`);
    return pass.program;
  };
  const texel = (id: string, x: number, y: number): Pixel => {
    let cache = caches.get(id);
    if (!cache) { cache = new Map(); caches.set(id, cache); }
    const key = y * resolution[0] + x, known = cache.get(key);
    if (known) return known;
    const value = evaluate(producer(id), [(x + 0.5) / resolution[0], (y + 0.5) / resolution[1]]);
    const stored = (options.float16 ? value.map(f16round) : value) as Pixel;
    cache.set(key, stored);
    return stored;
  };
  const sampleResource = (id: string, sampled: [number, number]): Pixel => options.filterResources
    ? bilinear(resolution[0], resolution[1], (x, y) => texel(id, x, y), sampled)
    : evaluate(producer(id), sampled);
  function evaluate(program: ImageOperatorPlan, at: [number, number]): Pixel {
    return evaluateImageOperatorPlan(program, sampleImage(at), { uv: at, resolution, sampleImage, sampleResource,
      ...(options.time === undefined ? {} : { timelineTimeSeconds: options.time }) });
  }
  return uv => evaluate(plan, uv);
}

/** One pixel of a (multi-pass) image plan on the CPU (see `createImagePassEvaluator`). */
export function evaluateImagePasses(plan: ImageOperatorPlan, uv: [number, number], resolution: [number, number],
  sampleImage: Sampler, options: PassEvaluationOptions = {}): Pixel {
  return createImagePassEvaluator(plan, resolution, sampleImage, options)(uv);
}
