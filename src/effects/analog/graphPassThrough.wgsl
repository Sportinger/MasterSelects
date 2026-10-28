// Graph-owned effects (Block Dissolve, Block Silhouette, Data HUD) render through their node graphs; these pass-throughs are
// only the registered fallbacks the pipeline cache never builds for them (one entry point per effect).

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;

@fragment
fn blockDissolveFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}

@fragment
fn blockSilhouetteFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}

@fragment
fn dataHudFragment(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(inputTex, texSampler, input.uv);
}
