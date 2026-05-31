// Shared transition prelude.
// Prepended to every transition fragment shader by TransitionPipeline. Declares the
// fullscreen vertex shader, the from/to textures, and a fixed-size uniform block.
//
// Uniform layout (matches packUniforms in each transition module):
//   progress : f32   eased blend progress, 0..1
//   p0..p6   : f32   transition-specific slots (softness, direction, color, ...)
//
// Both `fromTex` (outgoing clip) and `toTex` (incoming clip) are already rendered
// in output space (aspect/transform/effects applied), so transitions operate in
// straight screen UV coordinates.

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

struct TransitionUniforms {
  progress: f32,
  p0: f32,
  p1: f32,
  p2: f32,
  p3: f32,
  p4: f32,
  p5: f32,
  p6: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var fromTex: texture_2d<f32>;
@group(0) @binding(2) var toTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: TransitionUniforms;

fn getFromColor(uv: vec2f) -> vec4f {
  return textureSample(fromTex, texSampler, uv);
}

fn getToColor(uv: vec2f) -> vec4f {
  return textureSample(toTex, texSampler, uv);
}
