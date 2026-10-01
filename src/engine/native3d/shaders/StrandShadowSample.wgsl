// Deep opacity lookup of a strand layer's shadow, shared by the strands themselves (self-shadowing)
// and by lit meshes that receive the strands' shadow. `matrix` is the shadowing light's
// view-projection in scene space; `range` is (near, far, 1 perspective / 0 orthographic, unused).

/** Distance along the shadowing light for a depth value of its projection. */
fn strandShadowLinearDepth(depth: f32, range: vec4f) -> f32 {
  let near = range.x;
  let far = range.y;
  return select(near + depth * (far - near), near * far / (far - depth * (far - near)), range.z > 0.5);
}

/**
 * Light reaching scene position `p` through the fibers in front of it. `spacing` is the distance
 * between opacity layers, `bias` (in layers) keeps a fiber from shadowing itself, `strength` blends
 * the shadow in.
 */
fn strandShadowTransmittance(p: vec3f, matrix: mat4x4f, spacing: f32, strength: f32, range: vec4f, bias: f32,
  depthMap: texture_depth_2d, opacityMap: texture_2d<f32>, opacitySampler: sampler) -> f32 {
  let clip = matrix * vec4f(p, 1.0);
  if (clip.w <= 1e-5) {
    return 1.0;
  }
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) {
    return 1.0;
  }
  // Nearest fiber depth, bilinear over the four surrounding texels that hold a fiber: thin fibers
  // would otherwise make it jump between texels and band the shadow along every strand.
  let size = vec2i(textureDimensions(depthMap));
  let position = uv * vec2f(size) - 0.5;
  let origin = vec2i(floor(position));
  let f = position - floor(position);
  var weight = 0.0;
  var depth = 0.0;
  for (var corner = 0; corner < 4; corner++) {
    let offset = vec2i(corner & 1, corner >> 1);
    let sample = textureLoad(depthMap, clamp(origin + offset, vec2i(0), size - vec2i(1)), 0);
    let w = select(1.0 - f.x, f.x, offset.x == 1) * select(1.0 - f.y, f.y, offset.y == 1) * select(0.0, 1.0, sample < 0.99999);
    weight += w;
    depth += w * strandShadowLinearDepth(sample, range);
  }
  if (weight <= 1e-4) {
    return 1.0;
  }
  let layer = clamp((strandShadowLinearDepth(ndc.z, range) - depth / weight) / spacing - bias, 0.0, 4.0);
  let o = textureSampleLevel(opacityMap, opacitySampler, uv, 0.0);
  var cumulative = array<f32, 5>(0.0, o.x, o.y, o.z, o.w);
  let index = min(u32(layer), 3u);
  let opacity = mix(cumulative[index], cumulative[index + 1u], layer - f32(index));
  return mix(1.0, exp(-opacity), strength);
}
