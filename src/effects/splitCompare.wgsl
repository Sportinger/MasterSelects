struct CompareUniforms {
  position: f32,
  feather: f32,
  _padding: vec2f,
};

@group(0) @binding(0) var compareSampler: sampler;
@group(0) @binding(1) var untreatedTexture: texture_2d<f32>;
@group(0) @binding(2) var effectedTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> compare: CompareUniforms;

struct CompareVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn compareVertex(@builtin(vertex_index) vertexIndex: u32) -> CompareVertexOutput {
  let positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var output: CompareVertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

@fragment
fn compareFragment(input: CompareVertexOutput) -> @location(0) vec4f {
  let untreated = textureSample(untreatedTexture, compareSampler, input.uv);
  let effected = textureSample(effectedTexture, compareSampler, input.uv);
  let halfFeather = max(compare.feather * 0.5, 0.00001);
  let mixAmount = smoothstep(compare.position - halfFeather, compare.position + halfFeather, input.uv.x);
  return mix(untreated, effected, mixAmount);
}
