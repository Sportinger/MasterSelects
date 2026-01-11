// Invert Effect Shader

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

@fragment
fn invertFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  return vec4f(1.0 - color.rgb, color.a);
}
