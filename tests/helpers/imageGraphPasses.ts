import { evaluateImageOperatorPlan, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

export type Pixel = [number, number, number, number];

/** Evaluates a (multi-pass) image plan on the CPU. Cached resources are evaluated exactly at the
 * sampled UV, so the result equals a GPU run up to the cache's linear filtering and float16 storage. */
export function evaluateImagePasses(plan: ImageOperatorPlan, uv: [number, number], resolution: [number, number],
  sampleImage: (uv: [number, number]) => Pixel): Pixel {
  const evaluate = (program: ImageOperatorPlan, at: [number, number]): Pixel => evaluateImageOperatorPlan(program, sampleImage(at), {
    uv: at, resolution, sampleImage,
    sampleResource: (id, sampled) => {
      const pass = plan.passes?.find(candidate => candidate.outputResource === id);
      if (!pass) throw new Error(`No pass produces ${id}`);
      return evaluate(pass.program, sampled);
    },
  });
  return evaluate(plan, uv);
}
