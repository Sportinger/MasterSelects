struct ImageMarchingSquaresTopology {
  a: vec2f,
  b: vec2f,
  c: vec2f,
  d: vec2f,
  count: u32,
};

// Occupancies are exactly 0.0 or 1.0 (normally produced by step). Sampling,
// interpolation, and ambiguity policy remain outside this reusable lookup.
fn imageMarchingSquaresTopology(occupancy: vec4f, top: vec2f, right: vec2f, bottom: vec2f, left: vec2f) -> ImageMarchingSquaresTopology {
  let mask = u32(occupancy.x) | (u32(occupancy.y) << 1u) | (u32(occupancy.z) << 2u) | (u32(occupancy.w) << 3u);
  var result = ImageMarchingSquaresTopology(top, top, top, top, 0u);
  switch mask {
    case 1u, 14u: { result.a = left; result.b = top; result.count = 1u; }
    case 2u, 13u: { result.a = top; result.b = right; result.count = 1u; }
    case 3u, 12u: { result.a = left; result.b = right; result.count = 1u; }
    case 4u, 11u: { result.a = right; result.b = bottom; result.count = 1u; }
    case 5u: { result.a = left; result.b = top; result.c = right; result.d = bottom; result.count = 2u; }
    case 6u, 9u: { result.a = top; result.b = bottom; result.count = 1u; }
    case 7u, 8u: { result.a = left; result.b = bottom; result.count = 1u; }
    case 10u: { result.a = top; result.b = right; result.c = bottom; result.d = left; result.count = 2u; }
    default: {}
  }
  return result;
}
