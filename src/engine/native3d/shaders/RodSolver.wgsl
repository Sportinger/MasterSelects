// Elastic rods on the GPU, the scheme of the CPU reference (rodSolver.ts, rodContacts.ts) in f32:
// XPBD in small steps; stretch and bend constraints colour by colour (rodTopology.ts), contacts as
// one averaged Jacobi pass that every segment gathers for its own two nodes. No atomics, fixed
// iteration orders and a stable sort make every step deterministic on one device.
//
// `topology` (read-only) holds, in vec4u words with floats bit-cast:
//   per node    3 words: (rest xyz, inverse mass), (pull direction xyz, 0), (before, after, left segment, right segment)
//   per segment 2 words: (node a, node b, rod, ring), (rest length, arc of midpoint, rod length, stretch compliance)
//   per bend    2 words: (prev, mid, next, 0), (1 / l1, 1 / l2, compliance, 0)
//   colour lists of segment and bend indices, four per word.
// `state` holds positions (xyz, inverse mass), velocities, predicted positions and two contact
// sums per segment ((correction of node a, contacts), (correction of node b, contacts)).

struct RodParams {
  nodes: u32,
  segments: u32,
  bends: u32,
  mask: u32,          // hash table size - 1
  radius: f32,
  dt: f32,            // substep
  damping: f32,       // exp(-(damping + drag) dt)
  gravity: f32,
  airPull: f32,       // 1 - exp(-AIR_DRAG dt)
  limit: f32,         // speed limit per substep
  friction: f32,
  floorHeight: f32,
  floorEnabled: u32,
  turbulenceCount: u32,
  cell: f32,          // hash grid cell size
  selfGap: f32,       // arc gap (in radii) below which segments of one rod never collide
  kinetic: f32,
  segmentBase: u32,   // first topology word of the segments
  bendBase: u32,
  colorBase: u32,
  turbulence: array<vec4f, 8>,  // (strength, frequency, 0, 0)
};

struct PassParams {
  time: f32,          // simulation time at the start of the step (air and turbulence)
  reach: f32,         // pull distance of pinned nodes at the end of this substep
  stamp: u32,         // marks cell ranges written in this substep
  colorOffset: u32,   // colour list entry and count of a stretch or bend pass
  colorCount: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  wind: vec4f,
};

@group(0) @binding(0) var<uniform> rod: RodParams;
@group(0) @binding(1) var<uniform> step: PassParams;
@group(0) @binding(2) var<storage, read> topology: array<vec4u>;
@group(0) @binding(3) var<storage, read_write> state: array<vec4f>;
// (cell key, segment) per segment; the radix sort (an even number of passes) sorts it in place.
@group(0) @binding(4) var<storage, read_write> sorted: array<vec2u>;
@group(0) @binding(5) var<storage, read_write> cellRanges: array<vec4u>;
// Largest node distance from the origin, as f32 bits (positive floats order like their bits).
@group(0) @binding(6) var<storage, read_write> extentBits: atomic<u32>;

const NO_SEGMENT = 0xffffffffu;

fn position(node: u32) -> vec4f { return state[node]; }
fn velocityIndex(node: u32) -> u32 { return rod.nodes + node; }
fn predictedIndex(node: u32) -> u32 { return 2u * rod.nodes + node; }
fn deltaIndex(segment: u32) -> u32 { return 3u * rod.nodes + 2u * segment; }
fn restNode(node: u32) -> vec4f { return bitcast<vec4f>(topology[node * 3u]); }
fn pullDirection(node: u32) -> vec3f { return bitcast<vec4f>(topology[node * 3u + 1u]).xyz; }
fn nodeLinks(node: u32) -> vec4u { return topology[node * 3u + 2u]; }
fn segmentNodes(segment: u32) -> vec4u { return topology[rod.segmentBase + segment * 2u]; }
fn segmentData(segment: u32) -> vec4f { return bitcast<vec4f>(topology[rod.segmentBase + segment * 2u + 1u]); }
fn colorEntry(index: u32) -> u32 {
  let word = topology[rod.colorBase + index / 4u];
  return word[index % 4u];
}

/** Gravity, air across the rod axis and damping, then a speed limit; pins follow their pull. */
@compute @workgroup_size(256)
fn predict(@builtin(global_invocation_id) gid: vec3u) {
  let node = gid.x;
  if (node >= rod.nodes) {
    return;
  }
  let x = position(node);
  let rest = restNode(node);
  if (rest.w == 0.0) {
    state[predictedIndex(node)] = vec4f(rest.xyz + pullDirection(node) * step.reach, 0.0);
    return;
  }
  let links = nodeLinks(node);
  var axis = position(links.y).xyz - position(links.x).xyz;
  let size = sqrt(dot(axis, axis));
  if (size > 0.0) {
    axis = axis / size;
  }
  var air = step.wind.xyz;
  for (var i = 0u; i < rod.turbulenceCount; i++) {
    let field = rod.turbulence[i];
    air += field.x * vec3f(sin(field.y * x.y + 1.3 * step.time), sin(field.y * x.z + 1.7 * step.time + 1.0), sin(field.y * x.x + 1.1 * step.time + 2.0));
  }
  var v = state[velocityIndex(node)].xyz;
  var relative = air - v;
  relative -= dot(relative, axis) * axis;
  v = (v + relative * rod.airPull - vec3f(0.0, rod.gravity * rod.dt, 0.0)) * rod.damping;
  let speed = sqrt(dot(v, v));
  if (speed > rod.limit) {
    v *= rod.limit / speed;
  }
  state[velocityIndex(node)] = vec4f(v, 0.0);
  state[predictedIndex(node)] = vec4f(x.xyz + v * rod.dt, 0.0);
}

/** Stretch constraints of one colour (CPU: RodSimulation.solveStretch). */
@compute @workgroup_size(64)
fn stretch(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= step.colorCount) {
    return;
  }
  let segment = colorEntry(step.colorOffset + gid.x);
  let nodes = segmentNodes(segment);
  let data = segmentData(segment);
  let wi = restNode(nodes.x).w;
  let wj = restNode(nodes.y).w;
  let weight = wi + wj;
  if (weight == 0.0) {
    return;
  }
  let pi = state[predictedIndex(nodes.x)].xyz;
  let pj = state[predictedIndex(nodes.y)].xyz;
  let d = pj - pi;
  let length = sqrt(dot(d, d));
  if (length < 1e-12) {
    return;
  }
  let scale = (length - data.x) / (weight + data.w / (rod.dt * rod.dt)) / length;
  state[predictedIndex(nodes.x)] = vec4f(pi + wi * scale * d, 0.0);
  state[predictedIndex(nodes.y)] = vec4f(pj - wj * scale * d, 0.0);
}

/** Bend constraints of one colour: C = (x_next - x_mid) / l2 - (x_mid - x_prev) / l1 (CPU: solveBend). */
@compute @workgroup_size(64)
fn bend(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= step.colorCount) {
    return;
  }
  let index = colorEntry(step.colorOffset + gid.x);
  let nodes = topology[rod.bendBase + index * 2u];
  let data = bitcast<vec4f>(topology[rod.bendBase + index * 2u + 1u]);
  let g1 = data.x;
  let g2 = data.y;
  let gm = g1 + g2;
  let wi = restNode(nodes.x).w;
  let wm = restNode(nodes.y).w;
  let wj = restNode(nodes.z).w;
  let weight = wi * g1 * g1 + wm * gm * gm + wj * g2 * g2;
  if (weight == 0.0) {
    return;
  }
  let pi = state[predictedIndex(nodes.x)].xyz;
  let pm = state[predictedIndex(nodes.y)].xyz;
  let pj = state[predictedIndex(nodes.z)].xyz;
  let lambda = ((pj - pm) * g2 - (pm - pi) * g1) * (-1.0 / (weight + data.z / (rod.dt * rod.dt)));
  state[predictedIndex(nodes.x)] = vec4f(pi + wi * g1 * lambda, 0.0);
  state[predictedIndex(nodes.y)] = vec4f(pm - wm * gm * lambda, 0.0);
  state[predictedIndex(nodes.z)] = vec4f(pj + wj * g2 * lambda, 0.0);
}

fn cellOf(point: vec3f) -> vec3i {
  return vec3i(floor(point / rod.cell));
}

fn cellKey(cell: vec3i) -> u32 {
  let c = bitcast<vec3u>(cell);
  return ((c.x * 73856093u) ^ (c.y * 19349663u) ^ (c.z * 83492791u)) & rod.mask;
}

/** Hash key of each segment's midpoint cell, sorted with the segment index as payload. */
@compute @workgroup_size(256)
fn cellKeys(@builtin(global_invocation_id) gid: vec3u) {
  let segment = gid.x;
  if (segment >= rod.segments) {
    return;
  }
  let nodes = segmentNodes(segment);
  let middle = 0.5 * (state[predictedIndex(nodes.x)].xyz + state[predictedIndex(nodes.y)].xyz);
  sorted[segment] = vec2u(cellKey(cellOf(middle)), segment);
}

/** First and end entry of every occupied hash bucket in the sorted keys, stamped with this substep. */
@compute @workgroup_size(256)
fn cellRangesOf(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= rod.segments) {
    return;
  }
  let key = sorted[i].x;
  if (i == 0u || sorted[i - 1u].x != key) {
    cellRanges[key].x = i;
    cellRanges[key].z = step.stamp;
  }
  if (i + 1u == rod.segments || sorted[i + 1u].x != key) {
    cellRanges[key].y = i + 1u;
  }
}

/** Neighbours along one rod (within selfGap radii of arc length) never collide (CPU: RodContacts.adjacent). */
fn adjacent(c: u32, d: u32) -> bool {
  let nc = segmentNodes(c);
  let nd = segmentNodes(d);
  if (nc.z != nd.z) {
    return false;
  }
  let dc = segmentData(c);
  let dd = segmentData(d);
  var distance = abs(dc.y - dd.y);
  if (nc.w == 1u) {
    distance = min(distance, dc.z - distance);
  }
  return distance - 0.5 * (dc.x + dd.x) < rod.selfGap * rod.radius;
}

/** Closest-point parameters (s, t) of segments p1 + s d1 and p2 + t d2 (Ericson 5.1.9). */
fn closestParameters(d1: vec3f, d2: vec3f, r: vec3f) -> vec2f {
  let a = dot(d1, d1);
  let e = dot(d2, d2);
  let f = dot(d2, r);
  var s = 0.0;
  var t = 0.0;
  if (a <= 1e-24 && e <= 1e-24) {
    return vec2f(0.0);
  }
  if (a <= 1e-24) {
    return vec2f(0.0, clamp(f / e, 0.0, 1.0));
  }
  let c = dot(d1, r);
  if (e <= 1e-24) {
    return vec2f(clamp(-c / a, 0.0, 1.0), 0.0);
  }
  let b = dot(d1, d2);
  let denominator = a * e - b * b;
  if (denominator > 0.0) {
    s = clamp((b * f - c * e) / denominator, 0.0, 1.0);
  }
  t = (b * s + f) / e;
  if (t < 0.0) {
    t = 0.0;
    s = clamp(-c / a, 0.0, 1.0);
  } else if (t > 1.0) {
    t = 1.0;
    s = clamp((b - c) / a, 0.0, 1.0);
  }
  return vec2f(s, t);
}

/**
 * Contacts of one segment against every other segment in the 27 neighbouring cells: the share of
 * each capsule push and friction correction that falls on this segment's two nodes (CPU:
 * RodContacts.solve, which visits each pair once and applies both shares).
 */
@compute @workgroup_size(64)
fn contacts(@builtin(global_invocation_id) gid: vec3u) {
  let c = gid.x;
  if (c >= rod.segments) {
    return;
  }
  let nc = segmentNodes(c);
  let a0 = state[predictedIndex(nc.x)].xyz;
  let a1 = state[predictedIndex(nc.y)].xyz;
  let xa0 = position(nc.x).xyz;
  let xa1 = position(nc.y).xyz;
  let wa = vec2f(restNode(nc.x).w, restNode(nc.y).w);
  let restC = segmentData(c).x;
  let contact = 2.0 * rod.radius;
  let home = cellOf(0.5 * (a0 + a1));
  var deltaA = vec3f(0.0);
  var deltaB = vec3f(0.0);
  var hits = 0.0;
  var visited: array<u32, 27>;
  var visitedCount = 0u;
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let key = cellKey(home + vec3i(dx, dy, dz));
        // Hash collisions can map two neighbour cells to one bucket; visit each bucket once.
        var seen = false;
        for (var v = 0u; v < visitedCount; v++) {
          seen = seen || visited[v] == key;
        }
        if (seen) {
          continue;
        }
        visited[visitedCount] = key;
        visitedCount++;
        let range = cellRanges[key];
        if (range.z != step.stamp) {
          continue;
        }
        for (var e = range.x; e < range.y; e++) {
          let d = sorted[e].y;
          if (d == c || adjacent(c, d)) {
            continue;
          }
          let nd = segmentNodes(d);
          let b0 = state[predictedIndex(nd.x)].xyz;
          let b1 = state[predictedIndex(nd.y)].xyz;
          let bound = (restC + segmentData(d).x) * 1.25 + 2.0 * contact;
          let mid = a0 + a1 - b0 - b1;
          if (dot(mid, mid) > bound * bound) {
            continue;
          }
          let d1 = a1 - a0;
          let d2 = b1 - b0;
          let r = a0 - b0;
          let st = closestParameters(d1, d2, r);
          var n = r + d1 * st.x - d2 * st.y;
          let squared = dot(n, n);
          if (squared >= contact * contact) {
            continue;
          }
          let distance = sqrt(squared);
          let error = distance - contact;
          if (distance > 1e-12) {
            n = n / distance;
          } else {
            // Coincident axes: separate across both segments, or across the first one when parallel.
            n = cross(d1, d2);
            if (length(n) < 1e-18) {
              n = vec3f(-d1.y, d1.x, 0.0);
              if (length(n.xy) < 1e-18) {
                n = vec3f(0.0, -d1.z, d1.y);
              }
            }
            n = n / max(length(n), 1e-30);
          }
          let wb = vec2f(restNode(nd.x).w, restNode(nd.y).w);
          let sharesA = vec2f(wa.x * (1.0 - st.x), wa.y * st.x);
          let sharesB = vec2f(wb.x * (1.0 - st.y), wb.y * st.y);
          let weight = sharesA.x * (1.0 - st.x) + sharesA.y * st.x + sharesB.x * (1.0 - st.y) + sharesB.y * st.y;
          if (weight <= 0.0) {
            continue;
          }
          var correction = n * (-error / weight);
          if (rod.friction > 0.0) {
            // Tangential motion of the contact point on this segment relative to the other one.
            let motion = (1.0 - st.x) * (a0 - xa0) + st.x * (a1 - xa1)
              - (1.0 - st.y) * (b0 - position(nd.x).xyz) - st.y * (b1 - position(nd.y).xyz);
            let tangential = motion - dot(motion, n) * n;
            let slide = sqrt(dot(tangential, tangential));
            let depth = -error;
            if (slide >= 1e-15) {
              let share = select(min(1.0, rod.kinetic * rod.friction * depth / slide), 1.0, slide < rod.friction * depth);
              correction -= tangential * (share / weight);
            }
          }
          deltaA += sharesA.x * correction;
          deltaB += sharesA.y * correction;
          hits += 1.0;
        }
      }
    }
  }
  state[deltaIndex(c)] = vec4f(deltaA, hits);
  state[deltaIndex(c) + 1u] = vec4f(deltaB, hits);
}

/** Averaged contact corrections, the floor, then velocity from the substep's motion. */
@compute @workgroup_size(256)
fn apply(@builtin(global_invocation_id) gid: vec3u) {
  let node = gid.x;
  if (node >= rod.nodes) {
    return;
  }
  let links = nodeLinks(node);
  var p = state[predictedIndex(node)].xyz;
  var delta = vec3f(0.0);
  var hits = 0.0;
  if (links.z != NO_SEGMENT) {
    let sum = state[deltaIndex(links.z) + 1u];
    delta += sum.xyz;
    hits += sum.w;
  }
  if (links.w != NO_SEGMENT) {
    let sum = state[deltaIndex(links.w)];
    delta += sum.xyz;
    hits += sum.w;
  }
  if (hits > 0.0) {
    p += delta / hits;
  }
  let x = position(node);
  let w = restNode(node).w;
  let ground = rod.floorHeight + rod.radius;
  if (rod.floorEnabled == 1u && w != 0.0 && p.y < ground) {
    // Floor plane (+Y up) with the same positional friction (CPU: solveFloor).
    let depth = ground - p.y;
    p.y = ground;
    let slide = vec2f(p.x - x.x, p.z - x.z);
    let length = sqrt(dot(slide, slide));
    if (length >= 1e-15) {
      let keep = select(1.0 - min(1.0, rod.kinetic * rod.friction * depth / length), 0.0, length < rod.friction * depth);
      p.x = x.x + slide.x * keep;
      p.z = x.z + slide.y * keep;
    }
  }
  state[velocityIndex(node)] = vec4f((p - x.xyz) / rod.dt, 0.0);
  state[node] = vec4f(p, w);
}

/** Bounds of the simulated rods for culling and shadow framing; read back a frame later. */
@compute @workgroup_size(256)
fn nodeExtent(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= rod.nodes) {
    return;
  }
  atomicMax(&extentBits, bitcast<u32>(length(state[gid.x].xyz)));
}
