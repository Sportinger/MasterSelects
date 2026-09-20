export const IMAGE_OPERATOR_PARAMETER_CAPACITY = 64;
export const IMAGE_OPERATOR_PARAMETER_VEC4_COUNT = 16;
export const IMAGE_OPERATOR_PARAMETER_BUFFER_BYTES = 256;
export const IMAGE_OPERATOR_PARAMETER_WGSL_TYPE = 'ImageOperatorParameters';

/** Packs portable scalar slots into the fixed uniform block shared by every GPU adapter. */
export function packImageOperatorParameters(values: readonly number[]): Float32Array<ArrayBuffer> {
  if (values.length > IMAGE_OPERATOR_PARAMETER_CAPACITY) {
    throw new Error(`Image operator program exceeds ${IMAGE_OPERATOR_PARAMETER_CAPACITY} parameter slots.`);
  }
  const packed = new Float32Array(IMAGE_OPERATOR_PARAMETER_CAPACITY);
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) throw new Error(`Image operator parameter ${index} must be finite.`);
    packed[index] = value;
  });
  return packed;
}
