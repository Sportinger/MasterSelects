// Composites the analytic strand raster over the scene: premultiplied color, and the depth of the
// fiber that first half-covers each pixel (the incoming scene depth where none does).
@group(0) @binding(0) var strandColor: texture_2d<f32>;
@group(0) @binding(1) var strandDepth: texture_2d<f32>;

@vertex
fn fullscreenVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

struct ResolvedRaster {
  @location(0) color: vec4f,
  @builtin(frag_depth) depth: f32,
};

@fragment
fn resolveRaster(@builtin(position) position: vec4f) -> ResolvedRaster {
  let pixel = vec2i(position.xy);
  var result: ResolvedRaster;
  result.color = textureLoad(strandColor, pixel, 0);
  result.depth = textureLoad(strandDepth, pixel, 0).x;
  return result;
}
