// Saturation Effect Shader

struct SaturationParams {
  amount: f32,
  _p1: f32,
  _p2: f32,
  _p3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SaturationParams;

@fragment
fn saturationFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  let gray = luminance601(color.rgb);
  let adjusted = mix(vec3f(gray), color.rgb, params.amount);
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}
