// Surface Bind on the GPU (CPU reference: clothSurface.ts bindToCloth and strandFrames.ts
// packStrandPoints). The rest curves stay on the GPU; each frame only the simulated cloth grid is
// uploaded. bindPoints places every rest point on the bicubic (Catmull-Rom) sheet and lifts it
// along the sheet normal; strandFrames then walks each strand to write arc length,
// rotation-minimizing frames (double reflection) and tangents in the strand point layout.

struct BindParams {
  columns: u32,
  rows: u32,
  strands: u32,
  points: u32,
  size: vec2f,      // rest sheet width and height
  height: f32,      // Surface Bind height scale
  dispatchWidth: u32,
};

@group(0) @binding(0) var<uniform> bind: BindParams;
// x, y, z on the flat rest sheet and the yarn radius scale.
@group(0) @binding(1) var<storage, read> rest: array<vec4f>;
// (columns + 1) × (rows + 1) simulated positions, row-major from the bottom edge.
@group(0) @binding(2) var<storage, read> grid: array<f32>;
// First point and point count per strand.
@group(0) @binding(3) var<storage, read> strandRanges: array<vec2u>;
// Three vec4 per point: (position, arc length), (frame normal, radius scale), (tangent, strand index).
@group(0) @binding(4) var<storage, read_write> packed: array<vec4f>;

fn gridNode(x: i32, y: i32) -> vec3f {
  let base = u32(y * i32(bind.columns + 1u) + x) * 3u;
  return vec3f(grid[base], grid[base + 1u], grid[base + 2u]);
}

/** Rows beyond the border continue linearly. */
fn gridColumn(x: i32, y: i32) -> vec3f {
  let rows = i32(bind.rows);
  if (y < 0) {
    return 2.0 * gridNode(x, 0) - gridNode(x, 1);
  }
  if (y > rows) {
    return 2.0 * gridNode(x, rows) - gridNode(x, rows - 1);
  }
  return gridNode(x, y);
}

/** Columns beyond the border continue linearly, as in sampleClothGrid. */
fn gridAt(x: i32, y: i32) -> vec3f {
  let columns = i32(bind.columns);
  if (x < 0) {
    return 2.0 * gridColumn(0, y) - gridColumn(1, y);
  }
  if (x > columns) {
    return 2.0 * gridColumn(columns, y) - gridColumn(columns - 1, y);
  }
  return gridColumn(x, y);
}

fn weights(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2) * 0.5;
}

fn slopes(t: f32) -> vec4f {
  let t2 = t * t;
  return vec4f(-3.0 * t2 + 4.0 * t - 1.0, 9.0 * t2 - 10.0 * t, -9.0 * t2 + 8.0 * t + 1.0, 3.0 * t2 - 2.0 * t) * 0.5;
}

@compute @workgroup_size(256)
fn bindPoints(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x + gid.y * bind.dispatchWidth * 256u;
  if (index >= bind.points) {
    return;
  }
  let local = rest[index];
  let columns = f32(bind.columns);
  let rows = f32(bind.rows);
  let u = (local.x / bind.size.x + 0.5) * columns;
  let v = (local.y / bind.size.y + 0.5) * rows;
  let cu = clamp(u, 0.0, columns);
  let cv = clamp(v, 0.0, rows);
  let i = min(i32(bind.columns) - 1, i32(floor(cu)));
  let j = min(i32(bind.rows) - 1, i32(floor(cv)));
  let wu = weights(cu - f32(i));
  let wv = weights(cv - f32(j));
  let su = slopes(cu - f32(i));
  let sv = slopes(cv - f32(j));
  var point = vec3f(0.0);
  var du = vec3f(0.0);
  var dv = vec3f(0.0);
  for (var b = 0; b < 4; b++) {
    for (var a = 0; a < 4; a++) {
      let value = gridAt(i - 1 + a, j - 1 + b);
      point += wu[a] * wv[b] * value;
      du += su[a] * wv[b] * value;
      dv += wu[a] * sv[b] * value;
    }
  }
  // Beyond the sheet the surface continues along its edge tangent.
  point += du * (u - cu) + dv * (v - cv);
  let normal = cross(du, dv);
  let length = sqrt(dot(normal, normal));
  let lift = local.z * bind.height / select(1.0, length, length > 0.0);
  packed[index * 3u] = vec4f(point + normal * lift, 0.0);
}

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
  let strand = gid.x + gid.y * bind.dispatchWidth * 64u;
  if (strand >= bind.strands) {
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
    packed[index * 3u + 1u] = vec4f(normal, rest[index].w);
    packed[index * 3u + 2u] = vec4f(tangent, f32(strand));
    previousPoint = p;
    previousTangent = tangent;
  }
}
