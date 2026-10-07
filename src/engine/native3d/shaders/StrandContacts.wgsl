// Frame-local capsule projection after GPU curve fields. Sorted cells keep pair traversal
// deterministic; Jacobi writes never race. The duplicated endpoint of a ring is welded.
struct Params { points: u32, buckets: u32, radius: f32, smoothing: f32, strength: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> packed: array<vec4f>;
@group(0) @binding(2) var<storage, read> contexts: array<vec4u>;
@group(0) @binding(3) var<storage, read> ranges: array<vec2u>;
@group(0) @binding(4) var<storage, read> inputPoints: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> outputPoints: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> keys: array<vec2u>;
@group(0) @binding(7) var<storage, read_write> cells: array<vec2u>;
@group(0) @binding(8) var<storage, read_write> longest: atomic<u32>;

fn closed(range: vec2u) -> bool {
  return range.y > 2u && distance(packed[range.x * 3u].xyz, packed[(range.x + range.y - 1u) * 3u].xyz) < 1e-6;
}
fn canonical(i: u32) -> u32 {
  let info = contexts[i]; let range = ranges[info.y];
  return select(i, range.x, info.x == range.y - 1u && closed(range));
}
fn original(i: u32) -> vec3f { return packed[canonical(i) * 3u].xyz; }
fn point(i: u32) -> vec4f { return inputPoints[canonical(i)]; }
fn cellSize() -> f32 { return max(1e-8, bitcast<f32>(atomicLoad(&longest)) * 1.25 + params.radius * 3.0); }
fn coordinate(i: u32) -> vec3i { return vec3i(floor((point(i).xyz + point(i + 1u).xyz) * (0.5 / cellSize()))); }
fn hash(c: vec3i) -> u32 { let v = vec3u(c); return ((v.x * 73856093u) ^ (v.y * 19349663u) ^ (v.z * 83492791u)) & (params.buckets - 1u); }

@compute @workgroup_size(256)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= params.points) { return; }
  outputPoints[i] = vec4f(original(i), params.radius * clamp(packed[canonical(i) * 3u + 1u].w, 0.0, 1.0));
}
@compute @workgroup_size(256)
fn measure(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= params.points || contexts[i].x + 1u >= contexts[i].z) { return; }
  atomicMax(&longest, bitcast<u32>(distance(point(i).xyz, point(i + 1u).xyz)));
}
@compute @workgroup_size(256)
fn makeKeys(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= params.points) { return; }
  var key = params.buckets;
  if (contexts[i].x + 1u < contexts[i].z) { key = hash(coordinate(i)); }
  keys[i] = vec2u(key, i);
}
@compute @workgroup_size(256)
fn cellRanges(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= params.points) { return; }
  let key = keys[i].x; if (key >= params.buckets) { return; }
  if (i == 0u || keys[i - 1u].x != key) { cells[key].x = i; }
  if (i + 1u == params.points || keys[i + 1u].x != key) { cells[key].y = i + 1u; }
}

fn closest(d1: vec3f, d2: vec3f, r: vec3f) -> vec2f {
  let a = dot(d1, d1); let e = dot(d2, d2); let f = dot(d2, r);
  var s = 0.0; var t = 0.0;
  if (a <= 1e-24 && e <= 1e-24) { return vec2f(0.0); }
  if (a <= 1e-24) { t = clamp(f / e, 0.0, 1.0); }
  else {
    let c = dot(d1, r);
    if (e <= 1e-24) { s = clamp(-c / a, 0.0, 1.0); }
    else {
      let b = dot(d1, d2); let denominator = a * e - b * b;
      if (denominator > 0.0) { s = clamp((b * f - c * e) / denominator, 0.0, 1.0); }
      t = (b * s + f) / e;
      if (t < 0.0) { t = 0.0; s = clamp(-c / a, 0.0, 1.0); }
      else if (t > 1.0) { t = 1.0; s = clamp((b - c) / a, 0.0, 1.0); }
    }
  }
  return vec2f(s, t);
}
fn adjacent(a: u32, b: u32) -> bool {
  if (contexts[a].y != contexts[b].y) { return false; }
  let range = ranges[contexts[a].y];
  let a0 = packed[a * 3u].w; let a1 = packed[(a + 1u) * 3u].w;
  let b0 = packed[b * 3u].w; let b1 = packed[(b + 1u) * 3u].w;
  var gap = abs((a0 + a1 - b0 - b1) * 0.5);
  if (closed(range)) { gap = min(gap, packed[(range.x + range.y - 1u) * 3u].w - gap); }
  return gap - (a1 - a0 + b1 - b0) * 0.5 < params.radius * 2.2;
}
fn correction(a: u32, b: u32, vertex: u32) -> vec4f {
  if (a == b || adjacent(a, b)) { return vec4f(0.0); }
  let a0 = point(a); let a1 = point(a + 1u); let b0 = point(b); let b1 = point(b + 1u);
  let d1 = a1.xyz - a0.xyz; let d2 = b1.xyz - b0.xyz;
  let st = closest(d1, d2, a0.xyz - b0.xyz);
  let radius = mix(a0.w, a1.w, st.x) + mix(b0.w, b1.w, st.y);
  let delta = a0.xyz + d1 * st.x - b0.xyz - d2 * st.y;
  let dist = length(delta); if (dist >= radius || radius <= 0.0) { return vec4f(0.0); }
  var normal = delta / max(1e-12, dist);
  if (dist < 1e-9) {
    let perpendicular = cross(d1, d2);
    if (length(perpendicular) > 1e-12) { normal = normalize(perpendicular); }
    else {
      let direction = select(d1, vec3f(0.0, 1.0, 0.0), dot(d1, d1) < 1e-20);
      let axis = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(direction.x) < abs(direction.y));
      normal = normalize(cross(direction, axis)) * select(-1.0, 1.0, a < b);
    }
  }
  let weights = vec4f(1.0 - st.x, st.x, 1.0 - st.y, st.y);
  let weight = select(weights.y, weights.x, canonical(a) == vertex);
  if (weight < 1e-6) { return vec4f(0.0); }
  return vec4f(normal * ((radius - dist) * weight / max(1e-12, dot(weights, weights))), 1.0);
}
@compute @workgroup_size(256)
fn solve(@builtin(global_invocation_id) id: vec3u) {
  let raw = id.x; if (raw >= params.points) { return; }
  let i = canonical(raw); let info = contexts[i]; let range = ranges[info.y];
  let ring = closed(range);
  var incident = vec2u(i, i - 1u);
  if (info.x == 0u) { incident.y = select(params.points, range.x + range.y - 2u, ring); }
  if (info.x + 1u >= range.y) { incident.x = params.points; }
  var total = vec4f(0.0);
  for (var side = 0u; side < 2u; side++) {
    let a = incident[side]; if (a >= params.points) { continue; }
    let c = coordinate(a);
    for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
      let targetCell = c + vec3i(x, y, z); let cell = cells[hash(targetCell)];
      for (var entry = cell.x; entry < cell.y; entry++) {
        let b = keys[entry].y;
        if (all(coordinate(b) == targetCell)) { total += correction(a, b, i); }
      }
    } } }
  }
  // Averaged simultaneous corrections stay stable even when many capsules share a tight knot.
  outputPoints[raw] = vec4f(point(i).xyz + total.xyz / max(1.0, total.w), point(i).w);
}
@compute @workgroup_size(256)
fn smoothCorrections(@builtin(global_invocation_id) id: vec3u) {
  let raw = id.x; if (raw >= params.points) { return; }
  let i = canonical(raw); let info = contexts[i]; let range = ranges[info.y];
  let ring = closed(range); var p = point(i);
  if (ring || (info.x > 0u && info.x + 1u < range.y)) {
    let left = select(i - 1u, range.x + range.y - 2u, info.x == 0u);
    let right = i + 1u;
    let average = (point(left).xyz - original(left) + point(right).xyz - original(right)) * 0.5;
    p = vec4f(p.xyz + params.smoothing * (average - (p.xyz - original(i))), p.w);
  }
  outputPoints[raw] = p;
}
@compute @workgroup_size(256)
fn finish(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x; if (i >= params.points) { return; }
  // Each thread reads only its own original slot here; welded results are already identical.
  let old = packed[i * 3u];
  packed[i * 3u] = vec4f(mix(old.xyz, inputPoints[i].xyz, params.strength), old.w);
}
