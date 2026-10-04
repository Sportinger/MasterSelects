// Edge-aware à-trous wavelet filter of the SVGF (plan 3.4), one iteration per dispatch with taps
// 1, 2, 4, 8 pixels apart. Weights: the luminance difference against the filtered standard deviation,
// relative depth, normals (surfaces) or tangents (fibers: their normals turn within a pixel), and an
// equal material key. The variance is filtered along. The last iteration multiplies the albedo back
// and writes (lighting, coverage) for the upscaler. Layouts: PtRealtimeIntegrator.wgsl, PtSvgf.wgsl.

struct AtrousParams {
  size: vec2u,
  step: u32,
  last: u32,
};

@group(0) @binding(0) var<storage, read> surfaces: array<vec4f>;
@group(0) @binding(1) var<storage, read> source: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> destination: array<vec4f>;
@group(0) @binding(3) var<uniform> params: AtrousParams;

const ATROUS_SIGMA_LUMINANCE: f32 = 4.0;
const ATROUS_SIGMA_DEPTH: f32 = 0.02;
const ATROUS_HIT: u32 = 1u;
const ATROUS_FIBER: u32 = 2u;

fn atrousLuminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn atrousDecodeOct(code: u32) -> vec3f {
  let f = unpack2x16unorm(code) * 2.0 - 1.0;
  var n = vec3f(f, 1.0 - abs(f.x) - abs(f.y));
  let t = clamp(-n.z, 0.0, 1.0);
  n = vec3f(n.xy + select(vec2f(t), vec2f(-t), n.xy >= vec2f(0.0)), n.z);
  return normalize(n);
}

/** Variance of the center blurred over 3x3 (steadier edge stopping). */
fn atrousBlurredVariance(center: vec2i) -> f32 {
  var sum = 0.0;
  var weight = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let p = center + vec2i(dx, dy);
      if (any(p < vec2i(0)) || any(p >= vec2i(params.size))) {
        continue;
      }
      let w = select(0.25, 0.5, dx == 0 || dy == 0) * select(1.0, 2.0, dx == 0 && dy == 0);
      sum += source[u32(p.y) * params.size.x + u32(p.x)].w * w;
      weight += w;
    }
  }
  return sum / max(weight, 1e-6);
}

@compute @workgroup_size(8, 8)
fn atrous(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= params.size)) {
    return;
  }
  let index = id.y * params.size.x + id.x;
  let s1 = surfaces[index * 4u + 1u];
  let flags = bitcast<u32>(s1.w);
  if ((flags & ATROUS_HIT) == 0u) {
    destination[index] = vec4f(0.0);
    return;
  }
  let key = bitcast<u32>(s1.z);
  let s2 = surfaces[index * 4u + 2u];
  let depth = s2.y;
  let fiber = (flags & ATROUS_FIBER) != 0u;
  let direction = atrousDecodeOct(select(bitcast<u32>(s2.w), bitcast<u32>(surfaces[index * 4u + 3u].x), fiber));
  let center = source[index];
  let luminance = atrousLuminance(center.rgb);
  let deviation = sqrt(max(atrousBlurredVariance(vec2i(id.xy)), 0.0));
  var kernel = array<f32, 3>(0.375, 0.25, 0.0625);
  var sum = vec4f(0.0);
  var weights = 0.0;
  var varianceSum = 0.0;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let p = vec2i(id.xy) + vec2i(dx, dy) * i32(params.step);
      if (any(p < vec2i(0)) || any(p >= vec2i(params.size))) {
        continue;
      }
      let at = u32(p.y) * params.size.x + u32(p.x);
      let t1 = surfaces[at * 4u + 1u];
      if (bitcast<u32>(t1.z) != key || (bitcast<u32>(t1.w) & ATROUS_HIT) == 0u) {
        continue;
      }
      let t2 = surfaces[at * 4u + 2u];
      let tap = source[at];
      let other = atrousDecodeOct(select(bitcast<u32>(t2.w), bitcast<u32>(surfaces[at * 4u + 3u].x), fiber));
      let alignment = select(max(dot(direction, other), 0.0), abs(dot(direction, other)), fiber);
      let wNormal = pow(alignment, select(64.0, 16.0, fiber));
      let reach = length(vec2f(f32(dx), f32(dy))) * f32(params.step);
      let wDepth = exp(-abs(t2.y - depth) / (ATROUS_SIGMA_DEPTH * depth * max(reach, 1.0) + 1e-5));
      let wLuminance = exp(-abs(atrousLuminance(tap.rgb) - luminance) / (ATROUS_SIGMA_LUMINANCE * deviation + 1e-4));
      let w = kernel[abs(dx)] * kernel[abs(dy)] * wNormal * wDepth * wLuminance;
      sum += vec4f(tap.rgb * w, 0.0);
      varianceSum += tap.w * w * w;
      weights += w;
    }
  }
  let color = sum.rgb / max(weights, 1e-6);
  let variance = varianceSum / max(weights * weights, 1e-12);
  if (params.last == 1u) {
    destination[index] = vec4f(color * unpack4x8unorm(bitcast<u32>(s2.x)).rgb, 1.0);
    return;
  }
  destination[index] = vec4f(color, variance);
}
