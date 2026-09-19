struct PlanarProjectionParams {
  row0: vec4f,
  row1: vec4f,
  row2: vec4f,
  options: vec4f,
}

@group(0) @binding(0) var<uniform> params: PlanarProjectionParams;
@group(0) @binding(1) var projectionSampler: sampler;
@group(0) @binding(2) var background: texture_2d<f32>;
@group(0) @binding(3) var content: texture_2d<f32>;

@vertex fn planarProjectionVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let vertices = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(vertices[index], 0.0, 1.0);
}

@fragment fn planarProjectionFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let screen = position.xy / params.options.xy;
  let point = vec3f(screen, 1.0);
  let denominator = dot(params.row2.xyz, point);
  let original = textureSampleLevel(background, projectionSampler, screen, 0.0);
  if (abs(denominator) < 0.000001) {
    return original;
  }
  let uv = vec2f(dot(params.row0.xyz, point), dot(params.row1.xyz, point)) / denominator;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    return original;
  }
  let sampled = textureSampleLevel(content, projectionSampler, uv, 0.0);
  let alpha = sampled.a * params.options.z;
  return vec4f(mix(original.rgb, sampled.rgb, alpha), original.a + alpha * (1.0 - original.a));
}
