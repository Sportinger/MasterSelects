// Sharpen Effect Shader - High Quality Unsharp Mask

struct SharpenParams {
  amount: f32,
  radius: f32,
  width: f32,
  height: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: SharpenParams;

@fragment
fn sharpenFragment(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = vec2f(1.0 / params.width, 1.0 / params.height);
  let center = textureSample(inputTex, texSampler, input.uv);

  // Multi-sample blur for unsharp mask
  var blur = vec4f(0.0);
  var totalWeight = 0.0;

  let samples = 3; // 3x3 to 5x5 kernel
  let sigma = params.radius * 0.5 + 0.5;

  for (var x = -samples; x <= samples; x++) {
    for (var y = -samples; y <= samples; y++) {
      let offset = vec2f(f32(x), f32(y)) * texelSize * params.radius;
      let distSq = f32(x * x + y * y);
      let weight = exp(-distSq / (2.0 * sigma * sigma));

      blur += textureSample(inputTex, texSampler, input.uv + offset) * weight;
      totalWeight += weight;
    }
  }
  blur /= totalWeight;

  // Unsharp mask: original + (original - blur) * amount
  let sharpened = center.rgb + (center.rgb - blur.rgb) * params.amount;

  return vec4f(clamp(sharpened, vec3f(0.0), vec3f(1.0)), center.a);
}
