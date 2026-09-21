import { IMAGE_OPERATOR_PARAMETER_VEC4_COUNT } from './imageOperatorParameters';
import hash2d from '../../effects/_shared/hash2d.wgsl?raw';
import gaussian from '../../effects/_shared/gaussian.wgsl?raw';
export const imageF32 = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value);
export const imageParameterExpression = (slot: number) => `imageParameters.values[${Math.floor(slot / 4)}].${'xyzw'[slot % 4]}`;
export const IMAGE_PARAMETER_WGSL = `struct ImageOperatorParameters { values: array<vec4f, ${IMAGE_OPERATOR_PARAMETER_VEC4_COUNT}>, };`;
export const IMAGE_HASH2D_WGSL = hash2d.replace('fn hash(', 'fn imageGraphHash2d(');
export const IMAGE_GAUSSIAN_WGSL = gaussian.replace('fn gaussian(', 'fn imageGraphGaussian(');
export const IMAGE_COLOR_WGSL = `fn imageGraphRgbToHsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r)); let d = q.x - min(q.w, q.y); let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn imageGraphHsvToRgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0); let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}`;
