struct SurfaceUniforms {
  mvp: mat4x4f,
  reference: mat4x4f,
  inverseReference: mat4x4f,
  // xy: grid cells, z: signed world depth per source second, w: opacity
  shape: vec4f,
  mode: vec4f,
}
@group(0) @binding(0) var<uniform> surface: SurfaceUniforms;
@group(0) @binding(1) var colorTexture: texture_2d<f32>;
// R: continuous signed source age. G: bounded flow displacement. A: validity.
@group(0) @binding(2) var geometryTexture: texture_2d<f32>;
@group(0) @binding(3) var colorSampler: sampler;
@group(0) @binding(4) var band: texture_2d<f32>;

struct SurfaceVertex {
  @builtin(position) position: vec4f,
  @location(0) localPosition: vec3f,
  @location(1) imageUV: vec2f,
  @location(2) @interpolate(flat) valid: f32,
}

fn unproject(p: vec3f) -> vec3f {
  let h = surface.inverseReference * vec4f(p, 1.0);
  return h.xyz / h.w;
}

@vertex fn vertexMain(@builtin(vertex_index) id: u32) -> SurfaceVertex {
  let corners = array<vec2u, 6>(vec2u(0,0), vec2u(1,0), vec2u(0,1),
    vec2u(0,1), vec2u(1,0), vec2u(1,1));
  let columns = u32(surface.shape.x);
  let cell = id / 6u;
  let uv = vec2f(vec2u(cell % columns, cell / columns) + corners[id % 6u]) / surface.shape.xy;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let nearPoint = unproject(vec3f(ndc, 0.0));
  let farPoint = unproject(vec3f(ndc, 1.0));
  let ray = normalize(farPoint - nearPoint);
  // The undeformed image plane is local z = 0. The saved reference matrix
  // maps that plane to the unit image rectangle, independently of view orbit.
  let baseline = -nearPoint.z / ray.z;
  let size = vec2i(textureDimensions(geometryTexture));
  let pixel = clamp(vec2i(uv * vec2f(size)), vec2i(0), size - vec2i(1));
  let field = textureLoad(geometryTexture, pixel, 0);
  let displacement = field.r * surface.shape.z + field.g;
  let margin = min(.0001, length(farPoint - nearPoint) * .001);
  let distance = clamp(baseline + displacement, margin, length(farPoint - nearPoint) - margin);
  var local = nearPoint + ray * distance;
  var valid = 1.0;
  if (surface.mode.x > .5) {
    let vertex = vec2i(vec2u(cell % columns, cell / columns) + corners[id % 6u]);
    let tracked = textureLoad(band,vertex,0);
    local = vec3f(tracked.x-.5,.5-tracked.y,-displacement);
    let base = vec2i(i32(cell%columns),i32(cell/columns));
    valid = min(min(textureLoad(band,base,0).b,textureLoad(band,base+vec2i(1,0),0).b),
      min(textureLoad(band,base+vec2i(0,1),0).b,textureLoad(band,base+vec2i(1,1),0).b));
  }
  var result: SurfaceVertex;
  result.localPosition = local;
  result.imageUV = uv; result.valid = valid;
  result.position = surface.mvp * vec4f(local, 1.0);
  return result;
}

@fragment fn fragmentMain(input: SurfaceVertex) -> @location(0) vec4f {
  if (input.valid < .5) { discard; }
  // Reproject the interpolated position, then divide. Interpolated vertex UV
  // would distort the image on triangles whose vertices have different depth.
  let projected = surface.reference * vec4f(input.localPosition, 1.0);
  let uv = select(projected.xy / projected.w * vec2f(.5, -.5) + vec2f(.5),input.imageUV,surface.mode.x>.5);
  let color = textureSampleLevel(colorTexture, colorSampler, uv, 0.0);
  // Free bands use an explicit cutout surface: depth resolves self-overlap,
  // without pretending object sorting is order-independent transparency.
  if (surface.mode.x>.5 && color.a<.5) { discard; }
  let alpha = select(color.a,1.0,surface.mode.x>.5) * surface.shape.w;
  if (alpha <= 0.0) { discard; }
  return vec4f(color.rgb * alpha, alpha);
}
