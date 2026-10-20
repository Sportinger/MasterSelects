// Wave: WGSL reference of the editable graph (services/operators/uvDistortRecipes.ts).

struct WaveParams {
  amplitudeX: f32,  // vertical shift of waves that run along X (fraction of the height)
  amplitudeY: f32,  // horizontal shift of waves that run along Y (fraction of the width)
  frequencyX: f32,  // waves across the width
  frequencyY: f32,  // waves down the height
  phase: f32,       // radians, includes speed * time
  edges: f32,
  width: f32,
  height: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: WaveParams;

@fragment
fn waveFragment(input: VertexOutput) -> @location(0) vec4f {
  var uv = input.uv;
  uv.y += sin(uv.x * params.frequencyX * TAU + params.phase) * params.amplitudeX;
  uv.x += sin(uv.y * params.frequencyY * TAU + params.phase) * params.amplitudeY;
  return distortSampleEdges(inputTex, texSampler, uv, params.edges, vec2f(params.width, params.height));
}
