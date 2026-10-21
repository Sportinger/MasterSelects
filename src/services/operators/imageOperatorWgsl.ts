import { IMAGE_OPERATOR_PARAMETER_VEC4_COUNT } from './imageOperatorParameters';
import hash2d from '../../effects/_shared/hash2d.wgsl?raw';
import hashPcg2d from '../../effects/_shared/hashPcg2d.wgsl?raw';
import gaussian from '../../effects/_shared/gaussian.wgsl?raw';
import coordinateRotation from '../../effects/_shared/coordinateRotation.wgsl?raw';
import radialProjection from '../../effects/_shared/radialProjection.wgsl?raw';
export const imageF32 = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value);
export const imageParameterExpression = (slot: number) => `imageParameters.values[${Math.floor(slot / 4)}].${'xyzw'[slot % 4]}`;
export const IMAGE_PARAMETER_WGSL = `struct ImageOperatorParameters { values: array<vec4f, ${IMAGE_OPERATOR_PARAMETER_VEC4_COUNT}>, };`;
export const IMAGE_HASH2D_WGSL = hash2d.replace('fn hash(', 'fn imageGraphHash2d(');
/** PCG2D (Jarzynski & Olano 2020) of the whole-number cell; the top 24 bits give an exact f32 in [0, 1). */
export const IMAGE_CELL_HASH_WGSL = `fn imageGraphCellHash(p: vec2f) -> f32 {
  var v = bitcast<vec2u>(vec2i(floor(p))) * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> vec2u(16u));
  return f32(v.x >> 8u) / 16777216.0;
}`;
export const IMAGE_HASH_PCG2D_WGSL = hashPcg2d;
export const IMAGE_GAUSSIAN_WGSL = gaussian.replace('fn gaussian(', 'fn imageGraphGaussian(');
export const IMAGE_COORDINATE_ROTATION_WGSL = coordinateRotation;
export const IMAGE_VECTOR_WGSL = `fn imageGraphNormalize2(value: vec2f) -> vec2f {
  if (all(value == vec2f(0.0))) { return vec2f(0.0); }
  return normalize(value);
}`;
export const IMAGE_RADIAL_PROJECTION_WGSL = radialProjection
  .replace('fn radialProjectionRadius(', 'fn imageGraphProjectRadius(')
  .replace('fn inverseRadialProjectionRadius(', 'fn imageGraphUnprojectRadius(');
export const IMAGE_COLOR_WGSL = `fn imageGraphRgbToHsv(c: vec3f) -> vec3f {
  let K = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0); let p = mix(vec4f(c.bg, K.wz), vec4f(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r)); let d = q.x - min(q.w, q.y); let e = 1.0e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn imageGraphHsvToRgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0); let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}`;
