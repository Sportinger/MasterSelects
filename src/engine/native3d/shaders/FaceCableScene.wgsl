struct Light { projection: mat4x4f, position: vec4f, color: vec4f, settings: vec4f, direction: vec4f }
struct Params { mvp: mat4x4f, world: mat4x4f, lights: array<Light, 4>, options: vec4f, outline: array<vec4f, 100> }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var video: texture_2d<f32>;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var shadowMap: texture_depth_2d_array;
struct Vertex {
  @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) uv: vec2f,
  @location(3) color: vec3f, @location(4) material: f32
}
struct Varying {
  @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f,
  @location(2) uv: vec2f, @location(3) color: vec3f, @location(4) @interpolate(flat) material: f32
}
@vertex fn mainVertex(v: Vertex) -> Varying {
  var o: Varying;
  o.position = params.mvp * vec4f(v.position, 1);
  o.world = (params.world * vec4f(v.position, 1)).xyz;
  o.normal = normalize((params.world * vec4f(v.normal, 0)).xyz);
  o.uv = v.uv; o.color = v.color; o.material = v.material;
  return o;
}
fn onFace(uv: vec2f) -> bool {
  let count = u32(params.options.z);
  if (count < 3u) { return false; }
  var inside = false; var j = count - 1u;
  for (var i = 0u; i < count; i++) {
    let a = params.outline[i].xy; let b = params.outline[j].xy;
    if ((a.y > uv.y) != (b.y > uv.y)) {
      if (uv.x < (b.x - a.x) * (uv.y - a.y) / (b.y - a.y) + a.x) { inside = !inside; }
    }
    j = i;
  }
  return inside;
}
fn visibility(p: vec3f, i: u32) -> f32 {
  if (params.lights[i].settings.x <= 0.0) { return 1.0; }
  let projected = params.lights[i].projection * vec4f(p, 1);
  if (projected.w <= 0.0) { return 1.0; }
  let ndc = projected.xyz / projected.w;
  let uv = ndc.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0)) || any(uv > vec2f(1)) || ndc.z < 0.0 || ndc.z > 1.0) { return 1.0; }
  let spread = params.lights[i].settings.y / 2048.0;
  var lit = 0.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    lit += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(x), f32(y)) * spread, i32(i), ndc.z - 0.00002);
  }}
  return 1.0 - (1.0 - lit / 9.0) * params.lights[i].settings.x;
}
@fragment fn mainFragment(v: Varying) -> @location(0) vec4f {
  if (v.material < 1.5 && (any(v.uv < vec2f(0.0)) || any(v.uv > vec2f(1.0)))) { discard; }
  if (v.material < 0.5 && onFace(v.uv)) { discard; }
  var base = v.color;
  var sourceUv = v.uv;
  if (params.options.w == 1.0) { sourceUv = vec2f(v.uv.y, 1.0 - v.uv.x); }
  if (params.options.w == 2.0) { sourceUv = vec2f(1.0 - v.uv.x, 1.0 - v.uv.y); }
  if (params.options.w == 3.0) { sourceUv = vec2f(1.0 - v.uv.y, v.uv.x); }
  if (v.material < 1.5) { base = textureSampleLevel(video, texSampler, sourceUv, 0.0).rgb; }
  var illumination = vec3f(0.15); var shadowWeight = 0.0; var totalWeight = 0.0;
  for (var i = 0u; i < u32(params.options.x); i++) {
    let light = params.lights[i]; let delta = light.position.xyz - v.world;
    let direction = normalize(delta); let distance2 = dot(delta, delta);
    var power = light.color.a / (1.0 + distance2 * 0.08);
    if (light.settings.z > 0.5) { power *= max(0.0, dot(-direction, light.direction.xyz)); }
    let vis = visibility(v.world, i);
    illumination += light.color.rgb * max(0.0, dot(normalize(v.normal), direction)) * power * vis;
    shadowWeight += (1.0 - vis) * power; totalWeight += power;
  }
  if (v.material > 1.5 && v.material < 2.5) {
    if (params.options.x < 0.5) { illumination = vec3f(0.7); }
    base *= illumination;
  } else if (v.material > 0.5 && v.material < 1.5) {
    base *= 1.0 - shadowWeight / max(1.0, totalWeight);
  }
  return vec4f(base * params.options.y, params.options.y);
}
