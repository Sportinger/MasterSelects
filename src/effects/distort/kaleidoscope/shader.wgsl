// Kaleidoscope: WGSL reference of the editable graph (services/operators/mirrorRecipes.ts).

struct KaleidoscopeParams {
  segments: f32,     // 2…64; fractions crossfade the neighbouring whole counts
  rotation: f32,     // radians, spins the pattern
  sourceAngle: f32,  // radians, picks the slice of the picture
  zoom: f32,
  centerX: f32,
  centerY: f32,
  shape: f32,
  edges: f32,
  width: f32,
  height: f32,
  _p0: f32,
  _p1: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: KaleidoscopeParams;

fn kaleidoscopeRead(count: f32, angle: f32, radius: f32, center: vec2f, scale: vec2f, resolution: vec2f) -> vec4f {
  let wedge = TAU / count;
  let wrapped = fract(angle / wedge) * wedge;
  let folded = select(wrapped, wedge - wrapped, wrapped > wedge * 0.5);
  let turned = folded + params.sourceAngle;
  let read = distortSampleEdges(inputTex, texSampler, center + vec2f(cos(turned), sin(turned)) * radius / scale, params.edges, resolution);
  return vec4f(read.rgb * read.a, read.a);
}

@fragment
fn kaleidoscopeFragment(input: VertexOutput) -> @location(0) vec4f {
  let resolution = vec2f(params.width, params.height);
  let center = vec2f(params.centerX, params.centerY);
  let scale = distortShapeScale(params.shape, resolution);
  let p = (input.uv - center) * scale;
  let angle = atan2(p.y, p.x) + params.rotation;
  let radius = length(p) / max(params.zoom, 0.01);
  let count = clamp(params.segments, 2.0, 64.0);
  let low = floor(count);
  let mixed = mix(kaleidoscopeRead(low, angle, radius, center, scale, resolution),
    kaleidoscopeRead(low + 1.0, angle, radius, center, scale, resolution), count - low);
  return vec4f(mixed.rgb / max(mixed.a, 0.000001), mixed.a);
}
