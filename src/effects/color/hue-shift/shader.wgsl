// Hue Shift Effect Shader

struct HueShiftParams {
  shift: f32,
  _p1: f32,
  _p2: f32,
  _p3: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: HueShiftParams;

@fragment
fn hueShiftFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(inputTex, texSampler, input.uv);
  var hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + params.shift);
  return vec4f(hsv2rgb(hsv), color.a);
}
