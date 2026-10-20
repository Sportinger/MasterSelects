// Twirl: WGSL reference of the editable graph (services/operators/uvDistortRecipes.ts).

struct TwirlParams {
  amount: f32,    // turn at the centre in radians, fading to 0 at the radius
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
@group(0) @binding(2) var<uniform> params: TwirlParams;

@fragment
fn twirlFragment(input: VertexOutput) -> @location(0) vec4f {
  let resolution = vec2f(params.width, params.height);
  let center = vec2f(params.centerX, params.centerY);
  let scale = distortShapeScale(params.shape, resolution);
  let p = (input.uv - center) * scale;
  let falloff = 1.0 - min(length(p) / max(params.radius, 0.0001), 1.0);
  let angle = params.amount * falloff * falloff;
  let s = sin(angle);
  let c = cos(angle);
  let moved = vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
  return distortSampleEdges(inputTex, texSampler, center + moved / scale, params.edges, resolution);
}
