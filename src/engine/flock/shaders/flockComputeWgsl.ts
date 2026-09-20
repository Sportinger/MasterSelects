import { WIND_FORCE_WGSL } from '../../../services/operators/wind';
import { FLOCK_WGSL_MATH, FLOCK_WGSL_STRUCTS, flockSelectionWgsl } from './flockWgslShared';

/** Spatial index: identity keys, bitonic sort, per-cell ranges. */
export const FLOCK_GRID_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}
${FLOCK_WGSL_MATH}
${WIND_FORCE_WGSL}

struct SortParams { k: u32, j: u32, count: u32, pad0: u32, };

@group(0) @binding(0) var<storage, read> gridState: array<Particle>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> vals: array<u32>;
@group(0) @binding(3) var<uniform> block: StepBlock;

@compute @workgroup_size(256)
fn hashParticles(@builtin(global_invocation_id) gid: vec3u) {
  let sim = block.sim;
  let i = gid.x;
  if (i >= sim.sortCount) { return; }
  vals[i] = i;
  if (i >= sim.count) { keys[i] = U32_MAX; return; }
  let p = gridState[i];
  if (p.age < 0.0) { keys[i] = U32_MAX; return; }
  let c = vec3i(floor(p.pos / sim.cellSize));
  keys[i] = cellHash(c) & sim.tableMask;
}
`;

export const FLOCK_SORT_WGSL = /* wgsl */ `
struct SortParams { k: u32, j: u32, count: u32, pad0: u32, };

@group(0) @binding(0) var<storage, read_write> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> vals: array<u32>;
@group(0) @binding(2) var<uniform> sp: SortParams;

@compute @workgroup_size(256)
fn sortStep(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sp.count) { return; }
  let l = i ^ sp.j;
  if (l <= i || l >= sp.count) { return; }
  let ki = keys[i];
  let kl = keys[l];
  let vi = vals[i];
  let vl = vals[l];
  let ascending = (i & sp.k) == 0u;
  let greater = ki > kl || (ki == kl && vi > vl);
  if (greater == ascending) {
    keys[i] = kl;
    keys[l] = ki;
    vals[i] = vl;
    vals[l] = vi;
  }
}
`;

export const FLOCK_CELLS_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(2) var<uniform> block: StepBlock;

@compute @workgroup_size(256)
fn cellRanges(@builtin(global_invocation_id) gid: vec3u) {
  let sim = block.sim;
  let i = gid.x;
  if (i >= sim.sortCount) { return; }
  let key = keys[i];
  if (key == 0xffffffffu) { return; }
  if (i == 0u || keys[i - 1u] != key) {
    cells[key].start = i;
    cells[key].stamp = sim.stamp;
  }
  if (i + 1u >= sim.sortCount || keys[i + 1u] != key) {
    cells[key].end = i + 1u;
  }
}
`;

export const FLOCK_SIMULATE_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}
${FLOCK_WGSL_MATH}
${WIND_FORCE_WGSL}

const COHESION_GAIN: f32 = 0.6;
const ALIGNMENT_GAIN: f32 = 0.9;
const SEPARATION_GAIN: f32 = 45.0;
const PATH_SAMPLES: u32 = 48u;

@group(0) @binding(0) var<storage, read> stateIn: array<Particle>;
@group(0) @binding(1) var<storage, read_write> stateOut: array<Particle>;
@group(0) @binding(2) var<storage, read> vals: array<u32>;
@group(0) @binding(3) var<storage, read> cells: array<Cell>;
@group(0) @binding(4) var<uniform> block: StepBlock;
@group(0) @binding(5) var<storage, read_write> stats: array<atomic<u32>, 4>;

${flockSelectionWgsl('block.selections', 'evalSelections')}

fn sphereDirection(a: f32, b: f32) -> vec3f {
  let z = a * 2.0 - 1.0;
  let phi = b * TAU;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3f(r * cos(phi), r * sin(phi), z);
}

fn spawnParticle(source: Particle, index: u32, e: Emitter, generation: f32, sim: SimParams) -> Particle {
  var p = source;
  let nextGeneration = generation + 1.0;
  let seed = u32(e.seed);
  let genU = u32(nextGeneration);
  let u1 = rand01(index, mixKey(seed, genU, 1u));
  let u2 = rand01(index, mixKey(seed, genU, 2u));
  let u3 = rand01(index, mixKey(seed, genU, 3u));
  var o = vec3f(0.0);
  let shape = u32(e.shape);
  if (shape == 0u || shape == 1u) {
    let d = sphereDirection(u1, u2);
    var radius = pow(u3, 1.0 / 3.0);
    if (shape == 1u) { radius = 1.0; }
    o = d * radius * e.size;
  } else if (shape == 2u) {
    o = (vec3f(u1, u2, u3) - vec3f(0.5)) * e.size;
  } else if (shape == 3u) {
    let angle = u1 * TAU;
    let radius = sqrt(u2);
    o = vec3f(cos(angle) * radius * e.size.x, (u3 - 0.5) * e.size.y * 0.05, sin(angle) * radius * e.size.z);
  } else if (shape == 5u) {
    o = vec3f(u1 - 0.5) * e.size;
  }
  let rd = sphereDirection(rand01(index, mixKey(seed, genU, 4u)), rand01(index, mixKey(seed, genU, 5u)));
  var h = rd;
  let dirLength = length(e.direction);
  if (dirLength > 1e-6) {
    h = e.direction / dirLength * (1.0 - e.spread) + rd * e.spread;
  }
  if (sim.planar == 1u) {
    h[sim.planarAxis] = 0.0;
    o[sim.planarAxis] = 0.0;
  }
  let hl = length(h);
  if (hl > 0.0) { h = h / hl; } else { h = vec3f(0.0, 0.0, 1.0); }
  var lifetime = 0.0;
  if (e.lifetime > 0.0) {
    lifetime = e.lifetime * (1.0 + e.lifetimeVariance * (rand01(index, mixKey(seed, genU, 6u)) * 2.0 - 1.0));
  }
  p.pos = e.center + o;
  if (sim.planar == 1u) { p.pos[sim.planarAxis] = 0.0; }
  p.age = 0.0;
  p.vel = h * e.initialSpeed;
  p.life = max(0.0, lifetime);
  p.fwd = h;
  p.gen = nextGeneration;
  p.neighbors = 0.0;
  return p;
}

struct Sdf { distance: f32, normal: vec3f, };

fn obstacleSdf(o: Obstacle, position: vec3f) -> Sdf {
  let l = rotateColsInverse(o.rot0, o.rot1, o.rot2, position - o.center);
  var result: Sdf;
  var localNormal = vec3f(0.0, 1.0, 0.0);
  let shape = u32(o.shape);
  if (shape == 1u) {
    let h = o.size * 0.5;
    let q = abs(l) - h;
    let outside = length(max(q, vec3f(0.0)));
    result.distance = outside + min(max(q.x, max(q.y, q.z)), 0.0);
    let sx = select(-1.0, 1.0, l.x >= 0.0);
    let sy = select(-1.0, 1.0, l.y >= 0.0);
    let sz = select(-1.0, 1.0, l.z >= 0.0);
    if (q.x >= q.y && q.x >= q.z) { localNormal = vec3f(sx, 0.0, 0.0); }
    else if (q.y >= q.z) { localNormal = vec3f(0.0, sy, 0.0); }
    else { localNormal = vec3f(0.0, 0.0, sz); }
    if (outside > 0.0) {
      localNormal = vec3f(max(q.x, 0.0) * sx, max(q.y, 0.0) * sy, max(q.z, 0.0) * sz);
    }
  } else if (shape == 2u) {
    let halfLength = o.size.y * 0.5;
    let cy = clamp(l.y, -halfLength, halfLength);
    let d = vec3f(l.x, l.y - cy, l.z);
    let len = length(d);
    result.distance = len - o.size.x;
    localNormal = select(vec3f(1.0, 0.0, 0.0), d, len > 1e-6);
  } else if (shape == 3u) {
    result.distance = l.y;
    localNormal = vec3f(0.0, 1.0, 0.0);
  } else {
    let len = length(l);
    result.distance = len - o.size.x;
    localNormal = select(vec3f(0.0, 1.0, 0.0), l, len > 1e-6);
  }
  let world = rotateCols(o.rot0, o.rot1, o.rot2, localNormal);
  let wl = length(world);
  result.normal = select(vec3f(0.0, 1.0, 0.0), world / wl, wl > 0.0);
  return result;
}

fn nearestPath(path: PathDef, position: vec3f) -> vec4f {
  var bestU = 0.0;
  var bestDistance = 3.0e38;
  var bestPoint = path.center;
  var sampleCount = PATH_SAMPLES + 1u;
  if (pathIsClosed(path)) { sampleCount = PATH_SAMPLES; }
  for (var s = 0u; s < sampleCount; s++) {
    let u = f32(s) / f32(PATH_SAMPLES);
    let point = evaluatePathAt(path, u);
    let d = point - position;
    let dist = dot(d, d);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestU = u;
      bestPoint = point;
    }
  }
  return vec4f(bestPoint, bestU);
}

fn fieldForces(sim: SimParams, p: Particle, mask: u32) -> vec3f {
  var acc = vec3f(0.0);
  for (var o = 0u; o < sim.opCount; o++) {
    let op = block.ops[o];
    let kind = u32(op.kind);
    if (kind <= 1u) { continue; }
    if (op.selection >= 0.0 && ((mask >> u32(op.selection)) & 1u) == 0u) { continue; }
    if (kind == 2u) {
      let d = op.v0 - p.pos;
      let dist = length(d);
      if (dist < 1e-5) { continue; }
      acc += d * (falloffWeight(op.f2, dist / op.f1) * op.f0 * op.f3 / dist);
    } else if (kind == 3u) {
      let r = p.pos - op.v0;
      let along = dot(r, op.v1);
      let q = r - op.v1 * along;
      let radial = length(q);
      if (radial < 1e-5) { continue; }
      let weight = falloffWeight(op.f3, radial / op.f1) * op.f0;
      if (weight == 0.0) { continue; }
      let t = cross(op.v1, q);
      let tl = max(length(t), 1e-12);
      acc += (t / tl) * weight - (q / radial) * op.f2 * weight;
    } else if (kind == 4u) {
      let x = p.pos * op.f1 + vec3f(op.f2, 0.0, 0.0);
      acc += (vec3f(valueNoise3(x, 1u), valueNoise3(x, 2u), valueNoise3(x, 3u)) * 2.0 - vec3f(1.0)) * op.f0;
    } else if (kind == 5u) {
      acc -= p.vel * op.f0;
    } else if (kind == 6u) {
      acc += sharedWindForce(op.v0, op.f0, op.f1, valueNoise1(op.f2 * 0.5 + p.rnd * 10.0, 7u) * 2.0 - 1.0);
    } else if (kind == 7u) {
      let speed = length(p.vel);
      if (speed < 1e-5) { continue; }
      acc += p.vel * ((op.f0 - speed) * op.f1 / speed);
    } else if (kind == 8u) {
      var cluster = floor(p.rnd * op.f0);
      if (op.f5 > 0.5) { cluster = p.group - op.f0 * floor(p.group / op.f0); }
      let anchor = op.v0 + op.f1 * (vec3f(
        valueNoise1(op.f2 + cluster * 13.1, 11u),
        valueNoise1(op.f2 + cluster * 7.7 + 50.0, 12u),
        valueNoise1(op.f2 + cluster * 3.3 + 100.0, 13u),
      ) * 2.0 - vec3f(1.0));
      let d = anchor - p.pos;
      let dist = length(d);
      if (dist < 1e-5) { continue; }
      acc += d * (op.f3 * min(1.0, dist / op.f4) / dist);
    } else if (kind == 9u) {
      if (op.pathIndex < 0.0 || u32(op.pathIndex) >= sim.pathCount) { continue; }
      let path = block.paths[u32(op.pathIndex)];
      let nearest = nearestPath(path, p.pos);
      let ahead = evaluatePathAt(path, nearest.w + op.f2 * op.f3);
      let tangent = ahead - nearest.xyz;
      let tl = length(tangent);
      if (tl > 1e-5) { acc += (tangent / tl) * op.f0; }
      let d = nearest.xyz - p.pos;
      let dist = length(d);
      if (dist > op.f1 && dist > 1e-5) {
        acc += d * (op.f0 * min(2.0, (dist - op.f1) / max(op.f1, 1.0)) / dist);
      }
    }
  }
  return acc;
}

fn avoidance(sim: SimParams, position: vec3f) -> vec3f {
  var acc = vec3f(0.0);
  for (var o = 0u; o < sim.obstacleCount; o++) {
    let obstacle = block.obstacles[o];
    if (obstacle.avoidDistance <= 0.0) { continue; }
    let sdf = obstacleSdf(obstacle, position);
    if (sdf.distance >= obstacle.avoidDistance) { continue; }
    acc += sdf.normal * (obstacle.strength * (1.0 - max(0.0, sdf.distance) / obstacle.avoidDistance));
  }
  if (sim.boundaryMode == 0u) {
    let d = position - sim.boundaryCenter;
    var amount = 0.0;
    var direction = vec3f(0.0, 1.0, 0.0);
    if (sim.boundaryShape == 1u) {
      let e = abs(d) - (sim.boundarySize * 0.5 - vec3f(sim.boundarySoftness));
      amount = max(max(e.x, max(e.y, e.z)), 0.0);
      direction = vec3f(select(0.0, sign(d.x), e.x > 0.0), select(0.0, sign(d.y), e.y > 0.0), select(0.0, sign(d.z), e.z > 0.0));
    } else {
      let radius = length(d);
      amount = radius - (sim.boundarySize.x - sim.boundarySoftness);
      if (radius > 1e-6) { direction = d / radius; }
    }
    if (amount > 0.0) {
      acc -= direction * (sim.boundaryStrength * min(4.0, amount / sim.boundarySoftness));
    }
  }
  return acc;
}

@compute @workgroup_size(256)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let sim = block.sim;
  let index = gid.x;
  if (index >= sim.count) { return; }
  var p = stateIn[index];
  let emitterIndex = u32(p.emitter);
  if (emitterIndex >= sim.emitterCount) { stateOut[index] = p; return; }
  let e = block.emitters[emitterIndex];
  let localIndex = index - u32(e.offset);
  let isActive = (f32(localIndex) + 0.5) / e.count <= e.activeFraction;
  var age = p.age;
  let generation = p.gen;
  let respawn = e.respawn > 0.5;

  if (age >= 0.0 && (!isActive || (p.life > 0.0 && age >= p.life))) {
    age = -1.0;
    p.age = -1.0;
    if (isActive && respawn) {
      stateOut[index] = spawnParticle(p, index, e, generation, sim);
      atomicAdd(&stats[2], 1u);
      return;
    }
  }
  if (age < 0.0) {
    var birth = 0.0;
    if (e.birthMode > 0.5) { birth = (f32(localIndex) / e.count) * e.stagger; }
    if (isActive && sim.simTime >= birth && (generation == 0.0 || respawn)) {
      stateOut[index] = spawnParticle(p, index, e, generation, sim);
      atomicAdd(&stats[2], 1u);
    } else {
      p.age = -1.0;
      stateOut[index] = p;
    }
    return;
  }

  let mask = evalSelections(index, p, sim.selectionCount);
  var acc = vec3f(0.0);
  var ruleIdx = array<u32, 2>(0u, 0u);
  var ruleCount = 0u;
  var maxRadius = 0.0;
  for (var o = 0u; o < sim.opCount; o++) {
    if (u32(block.ops[o].kind) == 1u && ruleCount < 2u) {
      ruleIdx[ruleCount] = o;
      ruleCount++;
      maxRadius = max(maxRadius, max(block.ops[o].f3, block.ops[o].f4));
    }
  }

  var neighborCount = 0u;
  var stride = 1u;
  if (ruleCount > 0u && maxRadius > 0.0) {
    var sums = array<vec4f, 6>(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
    let maxRadius2 = maxRadius * maxRadius;
    let base = vec3i(floor(p.pos / sim.cellSize));
    // Nearest cells first: center, faces, edges, corners (NEIGHBOR_CELL_ORDER).
    var cellOrder = array<vec3i, 27>(
      vec3i(0, 0, 0),
      vec3i(-1, 0, 0), vec3i(1, 0, 0), vec3i(0, -1, 0), vec3i(0, 1, 0), vec3i(0, 0, -1), vec3i(0, 0, 1),
      vec3i(-1, -1, 0), vec3i(1, -1, 0), vec3i(-1, 1, 0), vec3i(1, 1, 0), vec3i(-1, 0, -1), vec3i(1, 0, -1),
      vec3i(-1, 0, 1), vec3i(1, 0, 1), vec3i(0, -1, -1), vec3i(0, 1, -1), vec3i(0, -1, 1), vec3i(0, 1, 1),
      vec3i(-1, -1, -1), vec3i(1, -1, -1), vec3i(-1, 1, -1), vec3i(1, 1, -1), vec3i(-1, -1, 1), vec3i(1, -1, 1), vec3i(-1, 1, 1), vec3i(1, 1, 1),
    );
    var cellIds = array<u32, 27>();
    var cellCount = 0u;
    var totalCandidates = 0u;
    for (var o = 0u; o < 27u; o++) {
      let h = cellHash(base + cellOrder[o]) & sim.tableMask;
      var duplicate = false;
      for (var v = 0u; v < cellCount; v++) {
        if (cellIds[v] == h) { duplicate = true; break; }
      }
      if (duplicate || cells[h].stamp != sim.stamp) { continue; }
      cellIds[cellCount] = h;
      cellCount++;
      totalCandidates += cells[h].end - cells[h].start;
    }
    // One deterministic stride over the whole neighborhood: unbiased sampling, bounded work.
    let budget = max(1u, min(sim.cellCandidates * 8u, u32(ceil(f32(sim.neighborLimit) * 6.5))));
    if (totalCandidates > budget) {
      stride = (totalCandidates + budget - 1u) / budget;
      atomicAdd(&stats[0], 1u);
    }
    var phase = 0u;
    if (stride > 1u) { phase = index % stride; }
    let neighborCap = sim.neighborLimit * 2u;
    var running = 0u;
    var limited = false;
    for (var c = 0u; c < cellCount && !limited; c++) {
      let cell = cells[cellIds[c]];
      let first = (stride - ((running + phase) % stride)) % stride;
      running += cell.end - cell.start;
      for (var k = cell.start + first; k < cell.end; k += stride) {
        let other = vals[k];
        if (other == index) { continue; }
        let q = stateIn[other];
        let offset = q.pos - p.pos;
        let d2 = dot(offset, offset);
        if (d2 > maxRadius2 || d2 < 1e-12) { continue; }
        if (neighborCount >= neighborCap) { limited = true; break; }
        neighborCount++;
        let dist = sqrt(d2);
        for (var r = 0u; r < ruleCount; r++) {
          let op = block.ops[ruleIdx[r]];
          if (op.selection >= 0.0 && ((mask >> u32(op.selection)) & 1u) == 0u) { continue; }
          if (d2 > op.f3 * op.f3) { continue; }
          let mode = u32(op.f6);
          if (mode == 1u && q.group != p.group) { continue; }
          if (mode == 2u && q.group == p.group) { continue; }
          if (op.f5 > -0.999 && dot(p.fwd, offset) / dist < op.f5) { continue; }
          sums[r * 3u] += vec4f(q.pos, 1.0);
          sums[r * 3u + 1u] += vec4f(q.vel, 0.0);
          if (dist < op.f4) {
            let w = (1.0 - dist / op.f4) / dist;
            sums[r * 3u + 2u] -= vec4f(offset * w, 0.0);
          }
        }
      }
    }
    if (limited) { atomicAdd(&stats[1], 1u); }
    for (var r = 0u; r < ruleCount; r++) {
      let count = sums[r * 3u].w;
      if (count == 0.0) { continue; }
      let op = block.ops[ruleIdx[r]];
      acc += (sums[r * 3u].xyz / count - p.pos) * op.f0 * COHESION_GAIN
        + (sums[r * 3u + 1u].xyz / count - p.vel) * op.f2 * ALIGNMENT_GAIN
        + sums[r * 3u + 2u].xyz * op.f1 * SEPARATION_GAIN * f32(stride);
    }
  }

  acc += fieldForces(sim, p, mask);
  acc += avoidance(sim, p.pos);

  let accLength = length(acc);
  if (accLength > sim.maxAccel && accLength > 0.0) { acc = acc * (sim.maxAccel / accLength); }
  var velocity = p.vel + acc * sim.dt;
  if (sim.planar == 1u) { velocity[sim.planarAxis] = 0.0; }
  var speed = length(velocity);
  if (speed > sim.maxSpeed && speed > 0.0) {
    velocity = velocity * (sim.maxSpeed / speed);
  } else if (speed < sim.minSpeed) {
    if (speed > 1e-5) {
      velocity = velocity * (sim.minSpeed / speed);
    } else {
      velocity = p.fwd * sim.minSpeed;
      if (sim.planar == 1u) { velocity[sim.planarAxis] = 0.0; }
    }
  }
  var position = p.pos + velocity * sim.dt;
  if (sim.planar == 1u) { position[sim.planarAxis] = 0.0; }

  // Hard constraints
  for (var o = 0u; o < sim.obstacleCount; o++) {
    let sdf = obstacleSdf(block.obstacles[o], position);
    if (sdf.distance >= 0.0) { continue; }
    position -= sdf.normal * sdf.distance;
    let inward = dot(velocity, sdf.normal);
    if (inward < 0.0) { velocity -= sdf.normal * inward * 1.5; }
  }
  if (sim.boundaryMode >= 1u && sim.boundaryMode <= 3u) {
    let c = sim.boundaryCenter;
    if (sim.boundaryShape == 1u) {
      let h = sim.boundarySize * 0.5;
      var offsets = position - c;
      for (var axis = 0u; axis < 3u; axis++) {
        let ha = h[axis];
        if (abs(offsets[axis]) <= ha) { continue; }
        if (sim.boundaryMode == 3u) {
          p.age = -1.0;
          stateOut[index] = p;
          return;
        }
        if (sim.boundaryMode == 1u) {
          let span = ha * 2.0;
          let shifted = offsets[axis] + ha;
          offsets[axis] = shifted - span * floor(shifted / span) - ha;
        } else {
          offsets[axis] = sign(offsets[axis]) * ha;
          velocity[axis] = -velocity[axis];
        }
      }
      position = c + offsets;
    } else {
      let d = position - c;
      let radius = length(d);
      let limit = sim.boundarySize.x;
      if (radius > limit) {
        if (sim.boundaryMode == 3u) {
          p.age = -1.0;
          stateOut[index] = p;
          return;
        }
        let n = d / radius;
        if (sim.boundaryMode == 1u) {
          position = c - n * limit * 0.98;
        } else {
          position = c + n * limit;
          let outward = dot(velocity, n);
          if (outward > 0.0) { velocity -= 2.0 * outward * n; }
        }
      }
    }
  }
  let checksum = position.x + position.y + position.z + velocity.x + velocity.y + velocity.z;
  if (!(abs(checksum) < 3.0e38)) {
    position = e.center;
    velocity = vec3f(0.0);
  }

  speed = length(velocity);
  var targetDir = p.fwd;
  if (speed > 1e-5) { targetDir = velocity / speed; }
  let blend = 1.0 - exp(-sim.turnRate * sim.dt);
  var forward = p.fwd + (targetDir - p.fwd) * blend;
  let fl = length(forward);
  if (fl > 0.0) { forward = forward / fl; } else { forward = vec3f(0.0, 0.0, 1.0); }

  p.pos = position;
  p.vel = velocity;
  p.fwd = forward;
  p.age = age + sim.dt;
  p.neighbors = f32(neighborCount);
  stateOut[index] = p;
  atomicAdd(&stats[2], 1u);
}
`;

export const FLOCK_TRAIL_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}

struct TrailParams { ringIndex: u32, samples: u32, slotCount: u32, pad0: u32, };

@group(0) @binding(0) var<storage, read> trailState: array<Particle>;
@group(0) @binding(1) var<storage, read> slots: array<u32>;
@group(0) @binding(2) var<storage, read_write> ring: array<vec4f>;
@group(0) @binding(3) var<uniform> tp: TrailParams;

@compute @workgroup_size(256)
fn trailWrite(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s >= tp.slotCount) { return; }
  let p = trailState[slots[s]];
  var tag = 0.0;
  if (p.age >= 0.0) { tag = p.gen; }
  ring[s * tp.samples + tp.ringIndex] = vec4f(p.pos, tag);
}
`;

export const FLOCK_LINKS_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}
${FLOCK_WGSL_MATH}
${WIND_FORCE_WGSL}

struct LinkParams {
  radius: f32, fraction: f32, cellSize: f32, pad0: f32,
  salt: u32, perParticle: u32, count: u32, tableMask: u32,
  stamp: u32, range: u32, candidates: u32, pad1: u32,
};

@group(0) @binding(0) var<storage, read> linkState: array<Particle>;
@group(0) @binding(1) var<storage, read> vals: array<u32>;
@group(0) @binding(2) var<storage, read> cells: array<Cell>;
@group(0) @binding(3) var<storage, read_write> links: array<u32>;
@group(0) @binding(4) var<uniform> lp: LinkParams;

@compute @workgroup_size(128)
fn buildLinks(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= lp.count) { return; }
  let base = i * lp.perParticle;
  for (var s = 0u; s < lp.perParticle; s++) { links[base + s] = 0u; }
  let p = linkState[i];
  if (p.age < 0.0 || flockHash01(i, lp.salt) >= lp.fraction) { return; }
  let r2 = lp.radius * lp.radius;
  let center = vec3i(floor(p.pos / lp.cellSize));
  let range = i32(lp.range);
  var visited = array<u32, 125>();
  var visitedCount = 0u;
  var found = 0u;
  for (var dz = -range; dz <= range && found < lp.perParticle; dz++) {
    for (var dy = -range; dy <= range && found < lp.perParticle; dy++) {
      for (var dx = -range; dx <= range && found < lp.perParticle; dx++) {
        let h = cellHash(center + vec3i(dx, dy, dz)) & lp.tableMask;
        var duplicate = false;
        for (var v = 0u; v < visitedCount; v++) {
          if (visited[v] == h) { duplicate = true; break; }
        }
        if (duplicate) { continue; }
        visited[visitedCount] = h;
        visitedCount++;
        let cell = cells[h];
        if (cell.stamp != lp.stamp) { continue; }
        let count = cell.end - cell.start;
        var stride = 1u;
        if (count > lp.candidates) { stride = (count + lp.candidates - 1u) / lp.candidates; }
        for (var k = cell.start; k < cell.end && found < lp.perParticle; k += stride) {
          let j = vals[k];
          if (j == i || j >= lp.count) { continue; }
          if (j < i && flockHash01(j, lp.salt) < lp.fraction) { continue; }
          let q = linkState[j];
          if (q.age < 0.0) { continue; }
          let d = q.pos - p.pos;
          if (dot(d, d) >= r2) { continue; }
          links[base + found] = j + 1u;
          found++;
        }
      }
    }
  }
}
`;
