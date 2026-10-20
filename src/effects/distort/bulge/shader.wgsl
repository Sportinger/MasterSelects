// Bulge & Pinch: WGSL reference of the editable graph (services/operators/uvDistortRecipes.ts).

struct BulgeParams {
  amount: f32,    // 1 = unchanged, above 1 bulges, below 1 pinches
  radius: f32,
  centerX: f32,
  centerY: f32,
  shape: f32,
  edges: f32,
  width: f32,
  height: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BulgeParams;

@fragment
fn bulgeFragment(input: VertexOutput) -> @location(0) vec4f {
  let resolution = vec2f(params.width, params.height);
  let center = vec2f(params.centerX, params.centerY);
  let scale = distortShapeScale(params.shape, resolution);
  let p = (input.uv - center) * scale;
  let r = length(p) / max(params.radius, 0.0001);
  let inside = max(1.0 - r * r, 0.0);
  let beta = max(params.amount - 1.0, 0.0) * 1.232 - clamp(1.0 - params.amount, 0.0, 1.0) * 0.95;
  let moved = p * exp(-beta * inside * inside);
  return distortSampleEdges(inputTex, texSampler, center + moved / scale, params.edges, resolution);
}
