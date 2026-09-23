/** Same age interpolation as the cache sampler, using a binary lower-bound search. */
export const hybridTemporalWeights = /* wgsl */`
@group(0) @binding(0) var demand: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> ages: array<vec4f>;
struct Weights { groups: vec4u, factors: vec4f }
fn weights(delayInput: f32) -> Weights {
  let header = ages[arrayLength(&ages) - 1u];
  let count = u32(header.x);
  if (count <= 1u) { return Weights(vec4u(0u), vec4f(1.0, 0.0, 0.0, 0.0)); }
  let delay = max(delayInput, 0.0);
  var lo = 1u; var hi = count - 1u;
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    if (ages[mid].x < delay) { lo = mid + 1u; } else { hi = mid; }
  }
  var weight = clamp((delay - ages[lo - 1u].x) / max(ages[lo].x - ages[lo - 1u].x, .00001), 0.0, 1.0);
  if (header.y > .5) { weight = select(0.0, 1.0, weight >= .5); }
  let a = ages[lo - 1u]; let b = ages[lo];
  // Interpolate actual source PTS inside each grid sample, then interpolate
  // temporal grid positions. Dense grids must not shrink frame crossfades.
  return Weights(vec4u(u32(a.y), u32(a.z), u32(b.y), u32(b.z)),
    vec4f((1.0 - a.w) * (1.0 - weight), a.w * (1.0 - weight), (1.0 - b.w) * weight, b.w * weight));
}`;

export const hybridTemporalDemandShader = hybridTemporalWeights + /* wgsl */`
@group(0) @binding(2) var<storage, read_write> used: array<atomic<u32>>;
fn mark(group: u32) { atomicOr(&used[group / 32u], 1u << (group % 32u)); }
@compute @workgroup_size(16, 16) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(demand))) { return; }
  let w = weights(textureLoad(demand, vec2i(id.xy), 0).z);
  for (var i = 0u; i < 4u; i++) { if (w.factors[i] > 0.0) { mark(w.groups[i]); } }
}`;

export const hybridTemporalCompositeShader = hybridTemporalWeights + /* wgsl */`
@group(0) @binding(2) var atlas: texture_2d_array<f32>;
@group(0) @binding(3) var current: texture_2d<f32>;
@group(0) @binding(4) var s: sampler;
@group(0) @binding(5) var<storage, read> slots: array<i32>;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return Vertex(vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0), uv);
}
fn sampleGroup(group: u32, uv: vec2f, position: vec2i) -> vec4f {
  if (slots[group] < 0) { return vec4f(0.0); }
  if (group == 0u) { return textureLoad(current, position, 0); }
  let size = vec2f(textureDimensions(atlas));
  return textureSampleLevel(atlas, s, clamp(uv, .5 / size, 1.0 - .5 / size), slots[group], 0.0);
}
@fragment fn fragment(v: Vertex) -> @location(0) vec4f {
  let position = vec2i(v.position.xy);
  let request = textureLoad(demand, position, 0);
  let w = weights(request.z);
  var color = vec4f(0.0);
  for (var i = 0u; i < 4u; i++) {
    if (w.factors[i] > 0.0) { color += sampleGroup(w.groups[i], request.xy, position) * w.factors[i]; }
  }
  return color;
}`;
