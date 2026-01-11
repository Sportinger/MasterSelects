// Twirl Effect Shader

struct TwirlParams {
  amount: f32,
  radius: f32,
  centerX: f32,
  centerY: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: TwirlParams;

@fragment
fn twirlFragment(input: VertexOutput) -> @location(0) vec4f {
  let center = vec2f(params.centerX, params.centerY);
  let delta = input.uv - center;
  let dist = length(delta);

  // Calculate twirled UV unconditionally to satisfy uniform control flow
  let safeRadius = max(params.radius, 0.0001); // Avoid division by zero
  let factor = 1.0 - min(dist / safeRadius, 1.0);
  let angle = params.amount * factor * factor;

  let s = sin(angle);
  let c = cos(angle);
  let rotated = vec2f(
    delta.x * c - delta.y * s,
    delta.x * s + delta.y * c
  );
  let twirledUV = center + rotated;

  // Use select to choose UV based on whether we're in the effect radius
  let inRadius = dist < params.radius;
  let finalUV = select(input.uv, twirledUV, inRadius);

  return textureSample(inputTex, texSampler, finalUV);
}
