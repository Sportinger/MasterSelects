struct MeshUniforms {
  mvp: mat4x4f,
  world: mat4x4f,
  color: vec4f,
}

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normalWorld: vec3f,
}

@group(0) @binding(0) var<uniform> uniforms: MeshUniforms;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.mvp * vec4f(input.position, 1.0);
  output.normalWorld = normalize((uniforms.world * vec4f(input.normal, 0.0)).xyz);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let lightDir = normalize(vec3f(1.0, 2.0, 3.0));
  let ambient = 0.6;
  let diffuse = max(dot(normalize(input.normalWorld), lightDir), 0.0) * 0.4;
  return vec4f(uniforms.color.rgb * (ambient + diffuse), uniforms.color.a);
}
