// Kaleidoscope Effect Shader

struct KaleidoscopeParams {
  segments: f32,
  rotation: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: KaleidoscopeParams;

@fragment
fn kaleidoscopeFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv - 0.5;
  let angle = atan2(uv.y, uv.x) + params.rotation;
  let radius = length(uv);

  let segmentAngle = TAU / params.segments;
  var a = fract(angle / segmentAngle) * segmentAngle;

  if (a > segmentAngle * 0.5) {
    a = segmentAngle - a;
  }

  uv = vec2f(cos(a), sin(a)) * radius + 0.5;
  return textureSample(inputTex, texSampler, uv);
}
