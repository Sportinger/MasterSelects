// Separable Gaussian / Box Blur: WGSL reference of the editable operator graph
// (services/operators/blurEffectGraphs.ts), following effects/blur/blurSampling.ts.
// Rendering is owned by the graph. `separableBlurHorizontal` and `separableBlurVertical`
// are its two passes (the GPU check compares them with the graph); `gaussianBlurFragment`
// and `boxBlurFragment` are the registered single-pass entries for the generic effect
// layout: they evaluate the horizontal pass at the two cache rows a vertical tap filters.

struct SeparableBlurParams {
  radius: f32,  // pixels on a 1080p frame (shorter side 1080 px)
  width: f32,
  height: f32,
  kind: f32,    // 0 Gaussian, 1 Box
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SeparableBlurParams;

struct SeparableKernel { radiusPx: f32, sigma: f32, reach: f32, pairs: f32, stride: f32, count: i32 };

fn separableKernel() -> SeparableKernel {
  let radiusPx = params.radius * (min(params.width, params.height) / 1080.0);
  let sigma = max(radiusPx * 0.5, 0.0001);
  let reach = select(sigma * 3.0, radiusPx + 1.0, params.kind > 0.5);
  let pairs = min(ceil(reach * 0.5), 127.0);
  let stride = max(reach / 254.0, 1.0);
  let count = i32(clamp(trunc(pairs * 2.0 + 1.0), 1.0, 256.0));
  return SeparableKernel(radiusPx, sigma, reach, pairs, stride, count);
}

fn separableWeight(kernel: SeparableKernel, x: f32) -> f32 {
  if (params.kind > 0.5) { return clamp(kernel.reach - x, 0.0, 1.0); }
  return gaussian(x, kernel.sigma);
}

// Pair tap k: offset (texels, signed) and weight.
fn separableTap(kernel: SeparableKernel, k: i32) -> vec2f {
  let signed = f32(k) - kernel.pairs;
  let magnitude = abs(signed);
  let farTexel = magnitude * 2.0;
  let far = farTexel * kernel.stride;
  let near = max(farTexel - 1.0, 0.0) * kernel.stride;
  let farWeight = separableWeight(kernel, far);
  let nearWeight = separableWeight(kernel, near) * min(magnitude, 1.0);
  let weight = nearWeight + farWeight;
  let centre = (near * nearWeight + far * farWeight) / max(weight, 1e-20);
  return vec2f(centre * (signed / max(magnitude, 1.0)), weight);
}

fn premultiplied(color: vec4f) -> vec4f { return vec4f(color.rgb * color.a, color.a); }
fn straight(color: vec4f) -> vec4f { return vec4f(color.rgb / max(color.a, 0.000001), color.a); }

// One pass along `axis`; the horizontal pass premultiplies the straight source.
fn separablePass(uv: vec2f, axis: vec2f, premultiply: bool) -> vec4f {
  let kernel = separableKernel();
  let resolution = vec2f(params.width, params.height);
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  for (var k = 0; k < kernel.count; k++) {
    let tap = separableTap(kernel, k);
    var color = textureSampleLevel(inputTex, texSampler, uv + axis * tap.x / resolution, 0.0);
    if (premultiply) { color = premultiplied(color); }
    sum += color * tap.y;
    weightSum += tap.y;
  }
  return sum / vec4f(weightSum);
}

@fragment
fn separableBlurHorizontal(input: VertexOutput) -> @location(0) vec4f {
  return separablePass(input.uv, vec2f(1.0, 0.0), true);
}

@fragment
fn separableBlurVertical(input: VertexOutput) -> @location(0) vec4f {
  return straight(separablePass(input.uv, vec2f(0.0, 1.0), false));
}

fn separableBlurSinglePass(uv: vec2f) -> vec4f {
  let kernel = separableKernel();
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  // Each vertical tap linearly filters the cached horizontal pass between two rows (with the
  // sampler's edge clamp); one call site keeps the nested pass out of unrolled copies.
  for (var j = 0; j < kernel.count * 2; j++) {
    let tap = separableTap(kernel, j / 2);
    let row = clamp(uv.y * params.height + tap.x - 0.5, 0.0, params.height - 1.0);
    let lower = floor(row);
    let isUpper = (j % 2) == 1;
    let sourceRow = select(lower, min(lower + 1.0, params.height - 1.0), isUpper);
    let share = select(1.0 - (row - lower), row - lower, isUpper);
    sum += separablePass(vec2f(uv.x, (sourceRow + 0.5) / params.height), vec2f(1.0, 0.0), true) * (share * tap.y);
    if (!isUpper) { weightSum += tap.y; }
  }
  return straight(sum / vec4f(weightSum));
}

// Registered entries (one per effect; `params.kind` selects the kernel).
@fragment
fn gaussianBlurFragment(input: VertexOutput) -> @location(0) vec4f { return separableBlurSinglePass(input.uv); }

@fragment
fn boxBlurFragment(input: VertexOutput) -> @location(0) vec4f { return separableBlurSinglePass(input.uv); }
