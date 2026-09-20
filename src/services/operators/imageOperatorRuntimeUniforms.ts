import type { ImageOperatorPlan } from './imageOperatorGraph';
import { IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES, packImageOperatorParameters } from './imageOperatorParameters';

export const IMAGE_OPERATOR_TIME_BUFFER_BYTES = 16;

export function imageOperatorRuntimeUniformSize(plan: Pick<ImageOperatorPlan, 'capabilities' | 'values'>): number {
  return (plan.values.length ? IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES : 0)
    + (plan.capabilities.includes('time') ? IMAGE_OPERATOR_TIME_BUFFER_BYTES : 0);
}

/** One portable binding: optional 256-byte scalar block followed by aligned composition time. */
export function packImageOperatorRuntimeUniforms(
  plan: Pick<ImageOperatorPlan, 'capabilities' | 'values'>,
  timelineTimeSeconds: number,
): Float32Array<ArrayBuffer> | null {
  const size = imageOperatorRuntimeUniformSize(plan);
  if (!size) return null;
  const packed = new Float32Array(size / 4);
  if (plan.values.length) packed.set(packImageOperatorParameters(plan.values));
  if (plan.capabilities.includes('time')) {
    if (!Number.isFinite(timelineTimeSeconds)) throw new Error('Image operator timeline time must be finite.');
    packed[plan.values.length ? IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES / 4 : 0] = timelineTimeSeconds;
  }
  return packed;
}
