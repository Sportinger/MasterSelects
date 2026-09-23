/** Source Motion keeps the pair's times fixed across its entire spatial patch.
 * Resolve the history index twice per analysis pixel, not for every LK tap. */
export const SOURCE_MOTION_SAMPLING_WGSL = /* wgsl */`
struct MotionHistoryPoint {
  young: vec4f,
  old: vec4f,
  blend: f32,
}
fn resolveMotionHistoryPoint(ages: texture_2d<f32>, count: u32, requestedDelay: f32) -> MotionHistoryPoint {
  let delay = max(0.0, requestedDelay);
  var lo = 1u; var hi = count - 1u;
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    if (textureLoad(ages, vec2i(i32(mid), 0), 0).x < delay) { lo = mid + 1u; } else { hi = mid; }
  }
  let young = textureLoad(ages, vec2i(i32(lo - 1u), 0), 0);
  let old = textureLoad(ages, vec2i(i32(lo), 0), 0);
  let blend = clamp((delay - young.x) / max(old.x - young.x, .00001), 0.0, 1.0);
  return MotionHistoryPoint(young, old, blend);
}
fn flowHistoryLuma(atlas: texture_2d_array<f32>, s: sampler, point: MotionHistoryPoint, grid: vec2u, uv: vec2f) -> f32 {
  let young = residentTemporalPoint(atlas, s, uv, point.young, grid, vec4f(0.0));
  if (point.blend <= 0.0) { return dot(young.rgb, vec3f(.299, .587, .114)); }
  let old = residentTemporalPoint(atlas, s, uv, point.old, grid, vec4f(0.0));
  return dot(mix(young, old, point.blend).rgb, vec3f(.299, .587, .114));
}
fn sampleDisMotion(atlas: texture_2d_array<f32>, ages: texture_2d<f32>, s: sampler,
  uv: vec2f, requestedDelay: f32, header: vec4f) -> vec4f {
  let count = u32(header.x);
  if (count < 2u) { return vec4f(0.0); }
  let delay = max(0.0,requestedDelay); var lo = 1u; var hi = count-1u;
  while (lo < hi) {
    let mid = (lo+hi)/2u;
    if (textureLoad(ages,vec2i(i32(mid),0),0).x < delay) { lo = mid+1u; } else { hi = mid; }
  }
  let young = textureLoad(ages,vec2i(i32(lo-1u),0),0);
  let old = textureLoad(ages,vec2i(i32(lo),0),0);
  let grid = vec2u(textureLoad(ages,vec2i(i32(textureDimensions(ages).x-1u),1),0).xy);
  let weight = clamp((delay-young.x)/max(old.x-young.x,.00001),0.0,1.0);
  var a = residentTemporalPoint(atlas,s,uv,young,grid,vec4f(0.0));
  var b = residentTemporalPoint(atlas,s,uv,old,grid,vec4f(0.0));
  a = vec4f(a.xy*textureLoad(ages,vec2i(i32(lo-1u),1),0).x,a.ba);
  b = vec4f(b.xy*textureLoad(ages,vec2i(i32(lo),1),0).x,b.ba);
  if (header.y > .5) { return select(a,b,weight >= .5); }
  return mix(a,b,weight);
}
`;
