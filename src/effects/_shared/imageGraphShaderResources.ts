import type { ImageOperatorPlan } from '../../services/operators/imageOperatorGraph';
import { imageGraphLoadFunction, imageGraphManualBilinearFunction, imageGraphResourceSampleExpression } from './imageGraphSampling';

export function validateImageGraphResourceSampling(plan: Pick<ImageOperatorPlan, 'resourceInputs' | 'resourceSampling'>): void {
  const resources = plan.resourceInputs ?? [], sampling = plan.resourceSampling;
  if (resources.length > 8) throw new Error('Image graph pass exceeds the eight-resource input limit.');
  if (sampling && sampling.length !== resources.length) throw new Error('Image graph resource sampling descriptors must align with resource inputs.');
  if (sampling?.some(mode => mode !== 'hardware-linear-clamp' && mode !== 'manual-bilinear-clamp'
    && mode !== 'exact-pixel-load' && mode !== 'exact-u32-pixel-load')) {
    throw new Error('Image graph resource sampling mode is unsupported.');
  }
}

function uintDecodeFunctions(index: number, texture: string): string {
  return `fn imageGraphResourceMetadata${index}() -> vec4f { return imageGraphRuntime.resourceMetadata[${index}]; }
fn imageGraphByteWord${index}(pixel: vec2i) -> u32 {
  let metadata = imageGraphResourceMetadata${index}();
  let maximum = max(vec2i(metadata.yz) - vec2i(1), vec2i(0));
  return textureLoad(${texture}, clamp(pixel, vec2i(0), maximum), 0).r;
}
fn imageGraphByteFloat${index}(word: u32, floatMode: f32, floatGain: f32) -> f32 {
  if ((word & 0x7f800000u) == 0x7f800000u) { return 0.0; }
  let value = bitcast<f32>(word) * floatGain;
  if (floatMode < 0.5) { return clamp(value, 0.0, 1.0); }
  if (floatMode < 1.5) { return fract(abs(value)); }
  return clamp(abs(value), 0.0, 1.0);
}
fn decodeImageGraphBytePixel${index}(pixel: vec2f, depth: f32, floatMode: f32, floatGain: f32) -> vec4f {
  let coordinate = vec2i(pixel);
  if (depth < 0.5) { return unpack4x8unorm(imageGraphByteWord${index}(coordinate)); }
  if (depth < 1.5) {
    let lo = unpack2x16unorm(imageGraphByteWord${index}(vec2i(coordinate.x * 2, coordinate.y)));
    let hi = unpack2x16unorm(imageGraphByteWord${index}(vec2i(coordinate.x * 2 + 1, coordinate.y)));
    return vec4f(lo, hi);
  }
  let base = coordinate.x * 4;
  return vec4f(
    imageGraphByteFloat${index}(imageGraphByteWord${index}(vec2i(base, coordinate.y)), floatMode, floatGain),
    imageGraphByteFloat${index}(imageGraphByteWord${index}(vec2i(base + 1, coordinate.y)), floatMode, floatGain),
    imageGraphByteFloat${index}(imageGraphByteWord${index}(vec2i(base + 2, coordinate.y)), floatMode, floatGain),
    imageGraphByteFloat${index}(imageGraphByteWord${index}(vec2i(base + 3, coordinate.y)), floatMode, floatGain)
  );
}`;
}

/** Source-independent declarations for render and compute Image IR adapters. */
export function imageGraphResourceDeclarations(plan: Pick<ImageOperatorPlan, 'resourceInputs' | 'resourceSampling' | 'capabilities'>): string {
  validateImageGraphResourceSampling(plan);
  return (plan.resourceInputs ?? []).map((_id, index) => {
    const texture = `imageGraphResource${index}`, mode = plan.resourceSampling?.[index];
    if (_id === 'input-history:atlas') return `@group(0) @binding(${3 + index}) var ${texture}: texture_2d_array<f32>;`;
    if (mode === 'exact-u32-pixel-load') {
      return `@group(0) @binding(${3 + index}) var ${texture}: texture_2d<u32>;\n${uintDecodeFunctions(index, texture)}`;
    }
    const helper = mode === 'exact-pixel-load' ? '' : mode === 'manual-bilinear-clamp'
      ? imageGraphManualBilinearFunction(`sampleImageGraphResource${index}`, texture)
      : `fn sampleImageGraphResource${index}(uv: vec2f) -> vec4f { return ${imageGraphResourceSampleExpression(texture, 'texSampler', 'uv')}; }`;
    const load = plan.capabilities.includes('pixel-load') ? `\n${imageGraphLoadFunction(`loadImageGraphResource${index}`, texture)}` : '';
    return `@group(0) @binding(${3 + index}) var ${texture}: texture_2d<f32>;\n${helper}${load}`;
  }).join('\n');
}

export function imageGraphResourceSampleType(mode: NonNullable<ImageOperatorPlan['resourceSampling']>[number] | undefined): GPUTextureSampleType {
  return mode === 'exact-u32-pixel-load' ? 'uint' : mode === 'exact-pixel-load' ? 'unfilterable-float' : 'float';
}
