// Pixelate Effect Shader

struct PixelateParams {
  pixelSize: f32,
  width: f32,
  height: f32,
  _p: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PixelateParams;

@fragment
fn pixelateFragment(input: VertexOutput) -> @location(0) vec4f {
  let pixelX = params.pixelSize / params.width;
  let pixelY = params.pixelSize / params.height;
  let uv = vec2f(
    floor(input.uv.x / pixelX) * pixelX + pixelX * 0.5,
    floor(input.uv.y / pixelY) * pixelY + pixelY * 0.5
  );
  return textureSample(inputTex, texSampler, uv);
}
