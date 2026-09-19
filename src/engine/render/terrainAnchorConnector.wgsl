struct ConnectorParams {
  endpoints: vec4f,
  color: vec4f,
  frame: vec4f,
}

@group(0) @binding(0) var<uniform> connector: ConnectorParams;
@group(0) @binding(1) var connectorSampler: sampler;
@group(0) @binding(2) var background: texture_2d<f32>;

@vertex fn connectorCopyVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment fn connectorCopyFragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureSampleLevel(background, connectorSampler, position.xy / connector.frame.xy, 0.0);
}

@vertex fn connectorLineVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let start = connector.endpoints.xy * connector.frame.xy;
  let end = connector.endpoints.zw * connector.frame.xy;
  let direction = normalize(end - start);
  let normal = vec2f(-direction.y, direction.x) * connector.frame.z * 0.5;
  let corners = array<vec2f, 6>(start + normal, start - normal, end + normal, end + normal, start - normal, end - normal);
  let point = corners[index] / connector.frame.xy;
  return vec4f(point.x * 2.0 - 1.0, 1.0 - point.y * 2.0, 0.0, 1.0);
}

@fragment fn connectorLineFragment() -> @location(0) vec4f {
  return connector.color;
}
