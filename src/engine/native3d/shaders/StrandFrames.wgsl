// Strand frames (CPU reference: strandFrames.ts packStrandPoints): walks each strand of points
// written by a GPU stage (Surface Bind, Rod Simulation) and writes arc length, rotation-minimizing
// frames (double reflection) and tangents in the strand point layout. The writer leaves each point
// in slot 0 and its radius scale in the w of slot 1.

struct FramesParams {
  strands: u32,
  dispatchWidth: u32,
};

@group(0) @binding(0) var<uniform> frames: FramesParams;
// First point and point count per strand.
@group(0) @binding(1) var<storage, read> strandRanges: array<vec2u>;
// Three vec4 per point: (position, arc length), (frame normal, radius scale), (tangent, strand index).
@group(0) @binding(2) var<storage, read_write> packed: array<vec4f>;

fn boundPoint(index: u32) -> vec3f {
  return packed[index * 3u].xyz;
}

/** Central-difference tangent at point `i` of a strand; `fallback` where neighbours coincide. */
fn pointTangent(start: u32, count: u32, i: u32, fallback: vec3f) -> vec3f {
  let previous = boundPoint(start + select(i - 1u, 0u, i == 0u));
  let next = boundPoint(start + min(count - 1u, i + 1u));
  let span = next - previous;
  let length = sqrt(dot(span, span));
  return select(fallback, span / length, length > 1e-12);
}

@compute @workgroup_size(64)
fn strandFrames(@builtin(global_invocation_id) gid: vec3u) {
  let strand = gid.x + gid.y * frames.dispatchWidth * 64u;
  if (strand >= frames.strands) {
    return;
  }
  let start = strandRanges[strand].x;
  let count = strandRanges[strand].y;
  if (count == 0u) {
    return;
  }
  var tangent = pointTangent(start, count, 0u, vec3f(1.0, 0.0, 0.0));
  let axis = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(tangent.z) < 0.9);
  let side = axis - tangent * dot(axis, tangent);
  let sideLength = sqrt(dot(side, side));
  var normal = select(vec3f(0.0, 1.0, 0.0), side / sideLength, sideLength > 1e-12);
  var arc = 0.0;
  var previousPoint = boundPoint(start);
  var previousTangent = tangent;
  for (var i = 0u; i < count; i++) {
    let index = start + i;
    let p = boundPoint(index);
    // The writer of the points left the radius scale in the frame slot.
    let radius = packed[index * 3u + 1u].w;
    if (i > 0u) {
      tangent = pointTangent(start, count, i, previousTangent);
      let v1 = p - previousPoint;
      let c1 = dot(v1, v1);
      arc += sqrt(c1);
      if (c1 > 1e-18) {
        // Double reflection: reflect frame and tangent across the chord, then align the tangent.
        var reflected = normal - (2.0 * dot(v1, normal) / c1) * v1;
        let reflectedTangent = previousTangent - (2.0 * dot(v1, previousTangent) / c1) * v1;
        let v2 = tangent - reflectedTangent;
        let c2 = dot(v2, v2);
        if (c2 > 1e-18) {
          reflected -= (2.0 * dot(v2, reflected) / c2) * v2;
        }
        let length = sqrt(dot(reflected, reflected));
        if (length > 1e-12) {
          normal = reflected / length;
        }
      }
    }
    packed[index * 3u] = vec4f(p, arc);
    packed[index * 3u + 1u] = vec4f(normal, radius);
    packed[index * 3u + 2u] = vec4f(tangent, f32(strand));
    previousPoint = p;
    previousTangent = tangent;
  }
}
