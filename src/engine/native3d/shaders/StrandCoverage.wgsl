// Strand-only multisampling. Other scene geometry supplies the initial depth;
// the final pass returns premultiplied coverage and a representative shared depth.
@group(0) @binding(0) var sceneDepth: texture_depth_2d;
@group(0) @binding(1) var strandColor: texture_multisampled_2d<f32>;
@group(0) @binding(2) var strandDepth: texture_depth_multisampled_2d;

@vertex
fn fullscreenVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn seedDepth(@builtin(position) position: vec4f) -> @builtin(frag_depth) f32 {
  return textureLoad(sceneDepth, vec2i(position.xy), 0);
}

struct ResolvedStrands {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn resolveStrands(@builtin(position) position: vec4f) -> ResolvedStrands {
  let pixel = vec2i(position.xy);
  var result: ResolvedStrands;
  result.color = vec4f(0.0);
  var nearest = 1.0;
  var farthest = 0.0;
  var covered = 0u;
  for (var sample = 0; sample < 4; sample++) {
    let color = textureLoad(strandColor, pixel, sample);
    let depth = textureLoad(strandDepth, pixel, sample);
    nearest = min(nearest, depth);
    farthest = max(farthest, depth);
    if (color.a > 0.0) {
      // Alpha-to-coverage has already selected samples. Using its input alpha
      // again would square opacity; each surviving sample contributes once.
      result.color += vec4f(color.rgb, 1.0) * 0.25;
      covered++;
    }
  }
  // Later single-sample scene passes cannot retain all four depths. Keep the
  // incoming scene depth on sparse edges; covered cores write strand depth.
  result.depth = select(farthest, nearest, covered >= 2u);
  return result;
}
