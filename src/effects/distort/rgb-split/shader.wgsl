// RGB Split: WGSL reference of the editable graph (services/operators/mirrorRecipes.ts).

struct RGBSplitParams {
  amount: f32,     // share of the width (height when vertical); lens: the split at the left/right edges
  angle: f32,      // radians, on-screen direction (offset mode)
  lens: f32,       // 1: red magnified, blue shrunk about the centre
  edges: f32,
  width: f32,
  height: f32,
  lensScale: f32,  // red/blue scale per unit of Amount (2)
  _p0: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: RGBSplitParams;

@fragment
fn rgbSplitFragment(input: VertexOutput) -> @location(0) vec4f {
  let resolution = vec2f(params.width, params.height);
  let direction = vec2f(cos(params.angle), sin(params.angle));
  let linear = direction * length(direction * resolution) * params.amount / resolution;
  let lens = (input.uv - vec2f(0.5)) * (-params.lensScale * params.amount);
  let offset = select(linear, lens, params.lens > 0.5);
  let red = distortSampleEdges(inputTex, texSampler, input.uv + offset, params.edges, resolution);
  let green = distortSamplePremultiplied(inputTex, input.uv);
  let blue = distortSampleEdges(inputTex, texSampler, input.uv - offset, params.edges, resolution);
  let alpha = max(max(red.a, green.a), blue.a);
  let premultiplied = vec3f(red.r * red.a, green.g, blue.b * blue.a);
  return vec4f(premultiplied / max(alpha, 0.000001), alpha);
}
