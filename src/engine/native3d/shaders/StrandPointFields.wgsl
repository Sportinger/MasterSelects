// General curve fields: the same context and packed output as the CPU curve executor.
struct Params { points: u32, strands: u32, width: u32, statsWidth: u32 }
struct FieldContext { position: vec3f, curveU: f32, point: f32, strand: f32, points: f32, strands: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> rest: array<vec4f>;
// Local point index, strand index, points in strand, unused.
@group(0) @binding(2) var<storage, read> contexts: array<vec4u>;
@group(0) @binding(3) var<storage, read> ranges: array<vec2u>;
@group(0) @binding(4) var<storage, read> fieldConstants: array<f32>;
@group(0) @binding(5) var<storage, read_write> packed: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> metrics: array<vec2f>;

//@strand-fields

@compute @workgroup_size(256)
fn deform(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x + gid.y * params.width * 256u;
  if (index >= params.points) { return; }
  let info = contexts[index];
  let u = f32(info.x) / f32(max(1u, info.z - 1u));
  let result = strandPoint(FieldContext(rest[index].xyz, u, f32(info.x), f32(info.y), f32(info.z), f32(params.strands)), rest[index].w);
  packed[index * 3u] = vec4f(result.xyz, 0.0);
  packed[index * 3u + 1u] = vec4f(0.0, 0.0, 0.0, result.w);
}

// Runs after StrandFrames. Only these two numbers per strand are read back, never the points.
@compute @workgroup_size(64)
fn measure(@builtin(global_invocation_id) gid: vec3u) {
  let strand = gid.x + gid.y * params.statsWidth * 64u;
  if (strand >= params.strands) { return; }
  let range = ranges[strand];
  var extent = 0.0;
  for (var point = 0u; point < range.y; point++) {
    extent = max(extent, length(packed[(range.x + point) * 3u].xyz));
  }
  var arc = 0.0;
  if (range.y > 0u) { arc = packed[(range.x + range.y - 1u) * 3u].w; }
  metrics[strand] = vec2f(extent, arc);
}
