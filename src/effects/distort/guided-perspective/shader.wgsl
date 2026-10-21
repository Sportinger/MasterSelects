struct GuidedPerspectiveParams { row0: vec4f, row1: vec4f, row2: vec4f, controls: vec4f };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: GuidedPerspectiveParams;

// The matrix already includes Strength (guidedPerspectiveMatrix), so lines stay straight at any strength.
@fragment
fn guidedPerspectiveFragment(input: VertexOutput) -> @location(0) vec4f {
  let outputUv = (input.uv - 0.5) / params.controls.x + 0.5;
  let point = vec3f(outputUv, 1.0);
  let w = dot(params.row2.xyz, point);
  let safeW = select(-1.0, 1.0, w >= 0.0) * max(abs(w), 0.00001);
  let sourceUv = vec2f(dot(params.row0.xyz, point), dot(params.row1.xyz, point)) / safeW;
  // One source pixel of soft coverage so the slanted borders do not stair-step.
  let size = vec2f(textureDimensions(inputTex));
  let low = sourceUv * size;
  let high = (vec2f(1.0) - sourceUv) * size;
  let coverage = clamp(min(min(low.x, low.y), min(high.x, high.y)) + 0.5, 0.0, 1.0) * select(0.0, 1.0, w > 0.00001);
  let color = textureSampleLevel(inputTex, texSampler, sourceUv, 0.0);
  return vec4f(color.rgb, color.a * coverage);
}
