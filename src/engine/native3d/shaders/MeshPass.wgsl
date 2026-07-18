struct MeshLight {
  positionKind: vec4f,
  colorIntensity: vec4f,
  directionDiameter: vec4f,
}

struct MeshUniforms {
  mvp: mat4x4f,
  world: mat4x4f,
  color: vec4f,
  shading: vec4f,
  uvTransform: vec4f,
  ambientColorIntensity: vec4f,
  lights: array<MeshLight, 4>,
}

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normalWorld: vec3f,
  @location(1) uv: vec2f,
  @location(2) worldPosition: vec3f,
}

@group(0) @binding(0) var<uniform> uniforms: MeshUniforms;
@group(0) @binding(1) var meshSampler: sampler;
@group(0) @binding(2) var baseColorTexture: texture_2d<f32>;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let worldPosition = uniforms.world * vec4f(input.position, 1.0);
  output.position = uniforms.mvp * vec4f(input.position, 1.0);
  output.normalWorld = normalize((uniforms.world * vec4f(input.normal, 0.0)).xyz);
  output.uv = input.uv;
  output.worldPosition = worldPosition.xyz;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let uv = input.uv * uniforms.uvTransform.xy + uniforms.uvTransform.zw;
  let sampledTextureColor = textureSample(baseColorTexture, meshSampler, uv);
  let textureColor = mix(vec4f(1.0), sampledTextureColor, uniforms.shading.w);
  let color = uniforms.color * textureColor;
  if (uniforms.shading.x > 0.5) {
    return vec4f(color.rgb, color.a);
  }

  let normal = normalize(input.normalWorld);
  if (uniforms.shading.z < 0.5) {
    let lightDir = normalize(vec3f(1.0, 2.0, 3.0));
    let ambient = 0.6;
    let diffuse = max(dot(normal, lightDir), 0.0) * 0.4;
    return vec4f(color.rgb * (ambient + diffuse), color.a);
  }

  var lighting = uniforms.ambientColorIntensity.rgb * uniforms.ambientColorIntensity.a;
  let lightCount = i32(uniforms.shading.y + 0.5);
  for (var i = 0; i < 4; i = i + 1) {
    if (i >= lightCount) {
      continue;
    }

    let light = uniforms.lights[i];
    let toLight = light.positionKind.xyz - input.worldPosition;
    let distanceToLight = max(length(toLight), 0.001);
    let dirToLight = toLight / distanceToLight;
    let diameter = max(light.directionDiameter.w, 0.001);
    var attenuation = 1.0 / (1.0 + pow(distanceToLight / diameter, 2.0));

    if (light.positionKind.w > 1.5) {
      let panelDirection = normalize(light.directionDiameter.xyz);
      attenuation = attenuation * max(dot(-dirToLight, panelDirection), 0.0);
    }

    let diffuse = max(dot(normal, dirToLight), 0.0);
    lighting = lighting + light.colorIntensity.rgb * light.colorIntensity.a * diffuse * attenuation;
  }

  return vec4f(color.rgb * min(lighting, vec3f(8.0)), color.a);
}
