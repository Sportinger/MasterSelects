import { createImageOperatorEvaluator, type ImageOperatorEvaluationContext, type ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

/** CPU test adapter for explicit producer passes; external resources stay with
 * the fixture. This does not emulate texture quantization or GPU scheduling. */
export function evaluateMaterializedImage(plan: ImageOperatorPlan, pixel: [number, number, number, number], context: ImageOperatorEvaluationContext) {
  const producers = new Map(plan.passes?.filter(pass => pass.outputResource).map(pass => [pass.outputResource!, pass.program]));
  const resources = new Map(plan.resources?.map(resource => [resource.id, resource]));
  const evaluators = new Map<ImageOperatorPlan, ReturnType<typeof createImageOperatorEvaluator>>();
  const sample = (program: ImageOperatorPlan, uv: [number, number], maxEdge?: number): [number, number, number, number] => {
    const size = context.resolution ?? [100, 100];
    const scale = maxEdge ? Math.min(1, maxEdge / Math.max(...size)) : 1;
    const resolution: [number, number] = [Math.max(1, Math.round(size[0] * scale)), Math.max(1, Math.round(size[1] * scale))];
    let evaluate = evaluators.get(program);
    if (!evaluate) { evaluate = createImageOperatorEvaluator(program); evaluators.set(program, evaluate); }
    return evaluate(pixel, { ...context, uv, resolution, derivativeAutoMode: 'fine',
      pixelCoordinate: uv.map((value, i) => Math.max(0, Math.min(resolution[i] - 1, Math.floor(value * resolution[i])))) as [number, number],
      sampleImage: context.sampleImage ?? (() => pixel),
      sampleResource: (id, position) => {
        const producer = producers.get(id);
        if (producer) return sample(producer, position, resources.get(id)?.maxEdge);
        if (!context.sampleResource) throw new Error(`Test resource ${id} is missing.`);
        return context.sampleResource(id, position);
      },
    });
  };
  return sample(plan, context.uv ?? [.5, .5]);
}
