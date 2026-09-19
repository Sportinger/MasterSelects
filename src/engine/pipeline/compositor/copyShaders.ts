// Simple copy shader for regular textures
export const COPY_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  var output: VertexOutput;
  output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(x, 1.0 - y);
  return output;
}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSample(sourceTexture, texSampler, input.uv);
}
`;

function createExternalCopyShader(sourceUv: string): string {
  return `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  var output: VertexOutput;
  output.position = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(x, 1.0 - y);
  return output;
}

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_external;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(sourceTexture, texSampler, ${sourceUv});
}
`;
}

// HTML video external textures and unrotated decoded frames already match the
// effect texture convention.
export const EXTERNAL_COPY_SHADER = createExternalCopyShader('input.uv');

// A decoded WebCodecs frame exposes coded pixels. Apply the MP4 display
// rotation before effects so they see the same upright image as <video>.
export const EXTERNAL_COPY_90_SHADER = createExternalCopyShader('vec2f(input.uv.y, 1.0 - input.uv.x)');
export const EXTERNAL_COPY_180_SHADER = createExternalCopyShader('vec2f(1.0 - input.uv.x, 1.0 - input.uv.y)');
export const EXTERNAL_COPY_270_SHADER = createExternalCopyShader('vec2f(1.0 - input.uv.y, input.uv.x)');
