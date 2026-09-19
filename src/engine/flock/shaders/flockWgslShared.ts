/**
 * WGSL shared by flock compute and render shaders. Mirrors
 * src/engine/flock/shared/flockMath.ts and the CPU reference solver.
 */

export const FLOCK_WGSL_STRUCTS = /* wgsl */ `
struct Particle {
  pos: vec3f, age: f32,
  vel: vec3f, life: f32,
  fwd: vec3f, group: f32,
  rnd: f32, gen: f32, emitter: f32, neighbors: f32,
};

struct Emitter {
  center: vec3f, offset: f32,
  size: vec3f, count: f32,
  direction: vec3f, spread: f32,
  shape: f32, birthMode: f32, group: f32, seed: f32,
  stagger: f32, activeFraction: f32, lifetime: f32, lifetimeVariance: f32,
  respawn: f32, initialSpeed: f32, pad0: f32, pad1: f32,
};

struct Op {
  kind: f32, selection: f32, pathIndex: f32, pad0: f32,
  f0: f32, f1: f32, f2: f32, f3: f32,
  f4: f32, f5: f32, f6: f32, f7: f32,
  v0: vec3f, pad1: f32,
  v1: vec3f, pad2: f32,
};

struct Selection {
  kind: f32, invert: f32, a: f32, b: f32,
  f0: f32, f1: f32, shape: f32, pad0: f32,
  v0: vec3f, pad1: f32,
  v1: vec3f, pad2: f32,
};

struct Obstacle {
  center: vec3f, shape: f32,
  size: vec3f, avoidDistance: f32,
  rot0: vec3f, strength: f32,
  rot1: vec3f, pad0: f32,
  rot2: vec3f, pad1: f32,
};

struct PathDef {
  center: vec3f, shape: f32,
  radius: f32, height: f32, turns: f32, pad0: f32,
  rot0: vec3f, pad1: f32,
  rot1: vec3f, pad2: f32,
  rot2: vec3f, pad3: f32,
  p0: vec3f, pad4: f32,
  p1: vec3f, pad5: f32,
  p2: vec3f, pad6: f32,
  p3: vec3f, pad7: f32,
};

struct SimParams {
  dt: f32, time: f32, simTime: f32, cellSize: f32,
  maxSpeed: f32, minSpeed: f32, maxAccel: f32, turnRate: f32,
  planar: u32, planarAxis: u32, count: u32, tableMask: u32,
  neighborLimit: u32, cellCandidates: u32, emitterCount: u32, opCount: u32,
  selectionCount: u32, obstacleCount: u32, pathCount: u32, sortCount: u32,
  boundaryShape: u32, boundaryMode: u32, stamp: u32, step: u32,
  boundaryCenter: vec3f, boundarySoftness: f32,
  boundarySize: vec3f, boundaryStrength: f32,
};

struct StepBlock {
  sim: SimParams,
  emitters: array<Emitter, 8>,
  ops: array<Op, 16>,
  selections: array<Selection, 16>,
  obstacles: array<Obstacle, 16>,
  paths: array<PathDef, 4>,
};

struct Cell {
  start: u32, end: u32, stamp: u32, pad0: u32,
};
`;

export const FLOCK_WGSL_MATH = /* wgsl */ `
const TAU: f32 = 6.28318530718;
const U32_MAX: u32 = 0xffffffffu;

fn hashU32(value: u32) -> u32 {
  var s = value * 747796405u + 2891336453u;
  s = (s ^ (s >> 16u)) * 0x45d9f3bu;
  s = (s ^ (s >> 16u)) * 0x45d9f3bu;
  return s ^ (s >> 16u);
}

fn toUnit(value: u32) -> f32 {
  return min(f32(value) / 4294967296.0, 0.99999994);
}

fn rand01(slot: u32, key: u32) -> f32 {
  return toUnit(hashU32(slot ^ hashU32(key)));
}

fn mixKey(seed: u32, generation: u32, channel: u32) -> u32 {
  return (seed * 2654435761u) ^ ((generation + 1u) * 2246822519u) ^ (channel * 3266489917u);
}

fn flockHash01(index: u32, salt: u32) -> f32 {
  var s = index * 747796405u + salt * 2891336453u + 1u;
  s = (s ^ (s >> 16u)) * 0x45d9f3bu;
  s = (s ^ (s >> 16u)) * 0x45d9f3bu;
  s = s ^ (s >> 16u);
  return toUnit(s);
}

fn cellHash(c: vec3i) -> u32 {
  return (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u);
}

fn lattice(c: vec3i, channel: u32) -> f32 {
  return toUnit(hashU32(cellHash(c) ^ ((channel + 1u) * 0x9e3779b9u)));
}

fn fade1(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise3(p: vec3f, channel: u32) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let fr = p - fl;
  let ux = fade1(fr.x);
  let uy = fade1(fr.y);
  let uz = fade1(fr.z);
  let c000 = lattice(i, channel);
  let c100 = lattice(i + vec3i(1, 0, 0), channel);
  let c010 = lattice(i + vec3i(0, 1, 0), channel);
  let c110 = lattice(i + vec3i(1, 1, 0), channel);
  let c001 = lattice(i + vec3i(0, 0, 1), channel);
  let c101 = lattice(i + vec3i(1, 0, 1), channel);
  let c011 = lattice(i + vec3i(0, 1, 1), channel);
  let c111 = lattice(i + vec3i(1, 1, 1), channel);
  let x00 = c000 + (c100 - c000) * ux;
  let x10 = c010 + (c110 - c010) * ux;
  let x01 = c001 + (c101 - c001) * ux;
  let x11 = c011 + (c111 - c011) * ux;
  let y0 = x00 + (x10 - x00) * uy;
  let y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

fn valueNoise1(t: f32, channel: u32) -> f32 {
  let c = f32(channel);
  return valueNoise3(vec3f(t, c * 17.13, c * 5.71), channel);
}

fn falloffWeight(mode: f32, x: f32) -> f32 {
  if (x >= 1.0) { return 0.0; }
  let m = u32(mode);
  if (m == 1u) { return 1.0 - x; }
  if (m == 2u) { return 1.0 - fade1(x); }
  if (m == 3u) { return 1.0 / (1.0 + 16.0 * x * x); }
  return 1.0;
}

fn rotateCols(c0: vec3f, c1: vec3f, c2: vec3f, v: vec3f) -> vec3f {
  return c0 * v.x + c1 * v.y + c2 * v.z;
}

fn rotateColsInverse(c0: vec3f, c1: vec3f, c2: vec3f, v: vec3f) -> vec3f {
  return vec3f(dot(c0, v), dot(c1, v), dot(c2, v));
}

fn catmull(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}

fn pathIsClosed(path: PathDef) -> bool {
  let s = u32(path.shape);
  return s == 0u || s == 1u;
}

fn evaluatePathAt(path: PathDef, uIn: f32) -> vec3f {
  let s = u32(path.shape);
  var t = clamp(uIn, 0.0, 1.0);
  if (pathIsClosed(path)) { t = uIn - floor(uIn); }
  let theta = t * TAU;
  var local = vec3f(path.radius * cos(theta), 0.0, path.radius * sin(theta));
  if (s == 1u) {
    local = vec3f(path.radius * sin(theta), path.height * 0.5 * sin(theta * 2.0), path.radius * sin(theta) * cos(theta));
  } else if (s == 2u) {
    let angle = t * TAU * path.turns;
    local = vec3f(path.radius * cos(angle), path.height * (t - 0.5), path.radius * sin(angle));
  } else if (s == 3u) {
    local = vec3f(path.radius * (t * 2.0 - 1.0), 0.0, 0.0);
  } else if (s == 4u) {
    let scaled = t * 3.0;
    let index = min(2u, u32(floor(scaled)));
    let f = scaled - f32(index);
    var pts = array<vec3f, 4>(path.p0, path.p1, path.p2, path.p3);
    let a = pts[max(0i, i32(index) - 1i)];
    let b = pts[index];
    let c = pts[index + 1u];
    let d = pts[min(3u, index + 2u)];
    return catmull(a, b, c, d, f);
  }
  return rotateCols(path.rot0, path.rot1, path.rot2, local) + path.center;
}
`;

/** Selection evaluation against an array accessor (`block.selections` / `rb.selections`). */
export function flockSelectionWgsl(accessor: string, functionName: string): string {
  return /* wgsl */ `
fn ${functionName}(index: u32, p: Particle, count: u32) -> u32 {
  var mask = 0u;
  for (var s = 0u; s < min(count, 16u); s++) {
    let sel = ${accessor}[s];
    let kind = u32(sel.kind);
    var selected = false;
    if (kind == 1u) {
      selected = p.group == sel.f0;
    } else if (kind == 2u) {
      selected = flockHash01(index, u32(sel.f1)) < sel.f0;
    } else if (kind == 3u) {
      let d = p.pos - sel.v0;
      if (sel.shape > 0.5) {
        selected = all(abs(d) <= sel.v1 * 0.5);
      } else {
        selected = dot(d, d) <= sel.v1.x * sel.v1.x;
      }
    } else if (kind == 4u) {
      let speed = length(p.vel);
      selected = speed >= sel.f0 && speed <= sel.f1;
    } else if (kind == 5u) {
      selected = p.age >= sel.f0 && p.age <= sel.f1;
    } else if (kind == 6u) {
      var a = false;
      var b = false;
      if (sel.a >= 0.0 && u32(sel.a) < s) { a = ((mask >> u32(sel.a)) & 1u) == 1u; }
      if (sel.b >= 0.0 && u32(sel.b) < s) { b = ((mask >> u32(sel.b)) & 1u) == 1u; }
      let mode = u32(sel.f0);
      if (mode == 1u) { selected = a || b; } else if (mode == 2u) { selected = a != b; } else { selected = a && b; }
    }
    if (selected != (sel.invert > 0.5)) {
      mask = mask | (1u << s);
    }
  }
  return mask;
}
`;
}
