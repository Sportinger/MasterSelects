// Bulge/Pinch Effect Shader

struct BulgeParams {
  amount: f32,    // positive = bulge, negative = pinch
  radius: f32,
  centerX: f32,
  centerY: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BulgeParams;

@fragment
fn bulgeFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let delta = input.uv - center;
  let dist = length(delta);

  // Calculate bulged UV unconditionally to satisfy uniform control flow
  let safeDist = max(dist, 0.0001); // Avoid division by zero
  let normalizedDist = safeDist / params.radius;
  let factor = pow(normalizedDist, params.amount);
  let newDist = factor * params.radius;
  let direction = delta / safeDist; // normalize without branch
  let bulgedUV = center + direction * newDist;

  // Use select to choose UV based on whether we're in the effect radius
  let inRadius = dist < params.radius && dist > 0.0;
  let finalUV = select(input.uv, bulgedUV, inRadius);

  return textureSample(inputTex, texSampler, finalUV);
}
