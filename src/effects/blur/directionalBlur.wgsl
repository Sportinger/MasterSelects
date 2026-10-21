// Motion / Zoom / Radial Blur: WGSL reference of the editable two-stage operator graph
// (services/operators/directionalBlurEffectGraphs.ts), following effects/blur/blurSampling.ts.
// Rendering is owned by the graph. `directionalBlurPremultiply` (premultiplied source cache),
// `directionalBlurFine` (stage A, reading that cache) and `directionalBlurCoarse` (stage B,
// reading the stage A cache) are its three passes, each reading its input on binding 1; the
// GPU check compares them with the graph. `motionBlurFragment`, `zoomBlurFragment` and
// `radialBlurFragment` are the registered single-pass entries of the generic effect layout.
// GPU check only; never rendered: graph-owned effects render through their compiled graph and
// `prewarmEffect` skips them. They evaluate stage A at every coarse tap directly (up to
// 64 × 256 reads per pixel) and premultiply after filtering the straight source, an
// approximation at alpha edges.

struct DirectionalBlurParams {
  amount: f32,
  angle: f32,
  centerX: f32,
  centerY: f32,
  width: f32,
  height: f32,
  kind: f32,  // 0 Motion, 1 Zoom, 2 Radial
  mode: f32,  // Radial: 0 Zoom, 1 Spin
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: DirectionalBlurParams;

fn resolution() -> vec2f { return vec2f(params.width, params.height); }
fn blurCenter() -> vec2f { return vec2f(params.centerX, params.centerY) * resolution(); }
fn isMotion() -> bool { return params.kind < 0.5; }
fn isRadial() -> bool { return params.kind > 1.5; }
fn isSpin() -> bool { return isRadial() && params.mode > 0.5; }

// Motion and Radial Blur pass the picture through below 0 (legacy); Zoom Blur streaks inward.
fn blurAmount() -> f32 { return select(max(params.amount, 0.0), params.amount, params.kind > 0.5 && params.kind < 1.5); }

// Group range for the pixel at `uv`: start, signed length; longest range; longest in pixels.
// Counts and the box length use the range's magnitude (z, w).
fn directionalRange(uv: vec2f) -> vec4f {
  if (isMotion()) {
    let halfLength = blurAmount() * length(vec2f(cos(params.angle), sin(params.angle)) * resolution());
    return vec4f(-halfLength, halfLength * 2.0, abs(halfLength * 2.0), abs(halfLength * 2.0));
  }
  let center = blurCenter();
  let farthest = length(vec2f(max(center.x, params.width - center.x), max(center.y, params.height - center.y)));
  if (!isRadial()) {
    let span = log(max(1.0 + blurAmount() * 0.5, 0.05));
    return vec4f(0.0, span, abs(span), abs(span) * farthest);
  }
  let arc = blurAmount() * 0.3490658503988659;
  let shrinkRate = blurAmount() * 0.2;
  let centerUv = vec2f(params.centerX, params.centerY);
  let zoomLength = log(max(1.0 - shrinkRate * length(uv - centerUv), 0.05));
  let farUv = length(vec2f(max(centerUv.x, 1.0 - centerUv.x), max(centerUv.y, 1.0 - centerUv.y)));
  let zoomLongest = log(max(1.0 - shrinkRate * farUv, 0.05));
  let spin = isSpin();
  let longest = abs(select(zoomLongest, arc, spin));
  return vec4f(select(0.0, -arc * 0.5, spin), select(zoomLength, arc, spin), longest, longest * farthest);
}

fn directionalStep(range: vec4f) -> f32 {
  let coarseCount = clamp(ceil(sqrt(range.w * 2.0)), 1.0, 64.0);
  return max(range.z / coarseCount, 1e-9);
}

// T(u) of the pixel position `base` (pixels), returned as the sampling UV.
fn directionalTransform(base: vec2f, u: f32) -> vec2f {
  if (isMotion()) {
    let moved = base + vec2f(cos(params.angle), sin(params.angle)) * u;
    let raw = moved / resolution();
    let wrapped = raw - floor(raw * 0.5) * 2.0;
    return select(wrapped, vec2f(2.0) - wrapped, wrapped > vec2f(1.0));
  }
  let center = blurCenter();
  let relative = base - center;
  var offset = relative * exp(u);
  if (isSpin()) {
    offset = vec2f(relative.x * cos(u) - relative.y * sin(u), relative.x * sin(u) + relative.y * cos(u));
  }
  return (center + offset) / resolution();
}

// Stage A at `uv`: average over the box u in [-step/2, step/2] of the premultiplied input
// (`premultiply`: of the straight input, premultiplied after filtering).
fn directionalFine(uv: vec2f, step: f32, premultiply: bool) -> vec4f {
  let pixel = uv * resolution();
  let speed = select(length(pixel - blurCenter()), 1.0, isMotion());
  let count = i32(clamp(ceil(step * speed), 1.0, 256.0));
  var sum = vec4f(0.0);
  for (var i = 0; i < count; i++) {
    let u = ((f32(i) + 0.5) / f32(count) - 0.5) * step;
    let color = textureSampleLevel(inputTex, texSampler, directionalTransform(pixel, u), 0.0);
    sum += select(color, vec4f(color.rgb * color.a, color.a), premultiply);
  }
  return sum / vec4f(f32(count));
}

struct CoarseTap { uv: vec2f, weight: f32 };

fn directionalCoarseCount(range: vec4f, step: f32) -> i32 {
  return i32(clamp(ceil(abs(range.y) / step - 0.0001), 1.0, 64.0));
}

fn directionalCoarseTap(uv: vec2f, range: vec4f, step: f32, k: i32) -> CoarseTap {
  let span = abs(range.y);
  let spanSafe = max(span, 1e-9);
  let covered = clamp(span / step - f32(k), 0.0, 1.0);
  let along = (f32(k) + covered * 0.5) * step;
  let u = range.x + along * (range.y / spanSafe);
  let t = along / spanSafe;
  var taper = 1.0;
  if (isMotion()) { let centered = t * 2.0 - 1.0; taper = exp(centered * centered * -2.0); }
  if (isRadial() && !isSpin()) { taper = 1.0 - t * 0.5; }
  return CoarseTap(directionalTransform(uv * resolution(), u), taper * max(covered, 0.000001));
}

fn straightColor(color: vec4f) -> vec4f { return vec4f(color.rgb / max(color.a, 0.000001), color.a); }

@fragment
fn directionalBlurPremultiply(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSampleLevel(inputTex, texSampler, input.uv, 0.0);
  return vec4f(color.rgb * color.a, color.a);
}

@fragment
fn directionalBlurFine(input: VertexOutput) -> @location(0) vec4f {
  return directionalFine(input.uv, directionalStep(directionalRange(input.uv)), false);
}

@fragment
fn directionalBlurCoarse(input: VertexOutput) -> @location(0) vec4f {
  let range = directionalRange(input.uv);
  let step = directionalStep(range);
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  for (var k = 0; k < directionalCoarseCount(range, step); k++) {
    let tap = directionalCoarseTap(input.uv, range, step, k);
    sum += textureSampleLevel(inputTex, texSampler, tap.uv, 0.0) * tap.weight;
    weightSum += tap.weight;
  }
  return straightColor(sum / vec4f(weightSum));
}

fn directionalBlurSinglePass(uv: vec2f) -> vec4f {
  let range = directionalRange(uv);
  let step = directionalStep(range);
  var sum = vec4f(0.0);
  var weightSum = 0.0;
  for (var k = 0; k < directionalCoarseCount(range, step); k++) {
    let tap = directionalCoarseTap(uv, range, step, k);
    sum += directionalFine(clamp(tap.uv, vec2f(0.0), vec2f(1.0)), step, true) * tap.weight;
    weightSum += tap.weight;
  }
  return straightColor(sum / vec4f(weightSum));
}

// Registered entries (one per effect; `params.kind` selects the transform).
@fragment
fn motionBlurFragment(input: VertexOutput) -> @location(0) vec4f { return directionalBlurSinglePass(input.uv); }

@fragment
fn zoomBlurFragment(input: VertexOutput) -> @location(0) vec4f { return directionalBlurSinglePass(input.uv); }

@fragment
fn radialBlurFragment(input: VertexOutput) -> @location(0) vec4f { return directionalBlurSinglePass(input.uv); }
