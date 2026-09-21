import type { ImageOperatorPlan } from './imageOperatorGraph';
import { IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES, packImageOperatorParameters } from './imageOperatorParameters';

export const IMAGE_OPERATOR_TIME_BUFFER_BYTES = 16;

export interface ImageOperatorResourceMetadata {
  width: number;
  height: number;
  available: boolean;
}

function uintMetadataSlots(plan: Pick<ImageOperatorPlan, 'resourceInputs' | 'resourceSampling'>): number {
  return plan.resourceSampling?.includes('exact-u32-pixel-load') ? plan.resourceInputs?.length ?? 0 : 0;
}

export function imageOperatorRuntimeUniformSize(plan: Pick<ImageOperatorPlan, 'capabilities' | 'values' | 'resourceInputs' | 'resourceSampling'>): number {
  return (plan.values.length ? IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES : 0)
    + (plan.capabilities.includes('time') || plan.capabilities.includes('resolution') ? IMAGE_OPERATOR_TIME_BUFFER_BYTES : 0)
    + uintMetadataSlots(plan) * 16;
}

/** One portable binding: optional 256-byte scalar block followed by aligned composition time. */
export function packImageOperatorRuntimeUniforms(
  plan: Pick<ImageOperatorPlan, 'capabilities' | 'values' | 'resourceInputs' | 'resourceSampling'>,
  timelineTimeSeconds: number,
  width: number,
  height: number,
  resourceMetadata?: ReadonlyMap<string, ImageOperatorResourceMetadata>,
): Float32Array<ArrayBuffer> | null {
  const size = imageOperatorRuntimeUniformSize(plan);
  if (!size) return null;
  const packed = new Float32Array(size / 4);
  if (plan.values.length) packed.set(packImageOperatorParameters(plan.values));
  if (plan.capabilities.includes('time')) {
    if (!Number.isFinite(timelineTimeSeconds)) throw new Error('Image operator timeline time must be finite.');
    packed[plan.values.length ? IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES / 4 : 0] = timelineTimeSeconds;
  }
  if (plan.capabilities.includes('resolution')) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error('Image operator resolution must be positive and finite.');
    }
    const contextOffset = plan.values.length ? IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES / 4 : 0;
    packed[contextOffset + 2] = width;
    packed[contextOffset + 3] = height;
  }
  const metadataSlots = uintMetadataSlots(plan);
  if (metadataSlots) {
    const metadataOffset = (plan.values.length ? IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES : 0)
      + (plan.capabilities.includes('time') || plan.capabilities.includes('resolution') ? IMAGE_OPERATOR_TIME_BUFFER_BYTES : 0);
    for (let index = 0; index < metadataSlots; index += 1) {
      if (plan.resourceSampling?.[index] !== 'exact-u32-pixel-load') continue;
      const id = plan.resourceInputs?.[index];
      const metadata = id ? resourceMetadata?.get(id) : undefined;
      if (!metadata) throw new Error(`Image operator uint resource ${String(id)} requires runtime metadata.`);
      if (!Number.isFinite(metadata.width) || metadata.width <= 0 || !Number.isFinite(metadata.height) || metadata.height <= 0) {
        throw new Error(`Image operator uint resource ${id} dimensions must be positive and finite.`);
      }
      const offset = metadataOffset / 4 + index * 4;
      packed[offset] = metadata.available ? 1 : 0;
      packed[offset + 1] = metadata.width;
      packed[offset + 2] = metadata.height;
    }
  }
  return packed;
}
