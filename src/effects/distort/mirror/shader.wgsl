// Mirror Effect Shader

struct MirrorParams {
  horizontal: f32,
  vertical: f32,
  _p1: f32,
  _p2: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: MirrorParams;

@fragment
fn mirrorFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;

  if (params.horizontal > 0.5 && uv.x > 0.5) {
    uv.x = 1.0 - uv.x;
  }

  if (params.vertical > 0.5 && uv.y > 0.5) {
    uv.y = 1.0 - uv.y;
  }

  return textureSample(inputTex, texSampler, uv);
}
