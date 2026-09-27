import { FLOCK_WGSL_STRUCTS } from './flockWgslShared';

/**
 * FLIP liquid on a staggered (MAC) grid, run after the particle step each
 * substep: particle-to-grid transfer with fixed-point atomics (order
 * independent, so deterministic), fluid-cell marking, divergence, MGPCG
 * pressure projection and grid-to-particle PIC/FLIP
 * transfer with position correction. Domain walls are solid.
 *
 * Face layout (global face index f): U faces (nx+1)*ny*nz, then V faces
 * nx*(ny+1)*nz, then W faces nx*ny*(nz+1). `acc` holds fixed-point velocity
 * sums [0, nF) and weights [nF, 2nF). `faces` holds projected velocity
 * [0, nF), pre-projection velocity [nF, 2nF) and validity [2nF, 3nF).
 * `cells` holds divergence [0, nC) and pressure [nC, 2nC).
 * Mirrors engine/flock/cpu/flockCpuFluid.ts.
 */

export const FLOCK_FLUID_VELOCITY_SCALE = 8192;
export const FLOCK_FLUID_WEIGHT_SCALE = 65536;
export const FLOCK_FLUID_PARAMS_STRIDE = 256;
export const FLOCK_FLUID_WORKGROUP = 256;

export const FLOCK_FLUID_COMMON_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}

struct FluidParams {
  origin: vec3f, cellSize: f32,
  dims: vec3u, count: u32,
  flipRatio: f32, dt: f32, dispatchWidth: u32, pad1: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> acc: array<atomic<i32>>;
@group(0) @binding(2) var<storage, read_write> faces: array<f32>;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cells: array<f32>;
@group(0) @binding(5) var<uniform> fp: FluidParams;

const VS: f32 = ${FLOCK_FLUID_VELOCITY_SCALE}.0;
const WS: f32 = ${FLOCK_FLUID_WEIGHT_SCALE}.0;

fn faceDims(axis: u32) -> vec3u {
  var d = fp.dims;
  d[axis] = d[axis] + 1u;
  return d;
}

fn faceCount(axis: u32) -> u32 {
  let d = faceDims(axis);
  return d.x * d.y * d.z;
}

fn faceOffset(axis: u32) -> u32 {
  if (axis == 0u) { return 0u; }
  if (axis == 1u) { return faceCount(0u); }
  return faceCount(0u) + faceCount(1u);
}

fn totalFaces() -> u32 {
  return faceCount(0u) + faceCount(1u) + faceCount(2u);
}

fn cellCountTotal() -> u32 {
  return fp.dims.x * fp.dims.y * fp.dims.z;
}

fn faceIndex(axis: u32, c: vec3u) -> u32 {
  let d = faceDims(axis);
  return faceOffset(axis) + c.x + d.x * (c.y + d.y * c.z);
}

fn cellIndex(c: vec3u) -> u32 {
  return c.x + fp.dims.x * (c.y + fp.dims.y * c.z);
}

fn inCells(c: vec3i) -> bool {
  return all(c >= vec3i(0)) && all(c < vec3i(fp.dims));
}

fn isFluid(c: vec3i) -> bool {
  return inCells(c) && atomicLoad(&counts[cellIndex(vec3u(c))]) > 0u;
}

/** Grid coordinate of a face-centered sample for one velocity component. */
fn sampleCoord(pos: vec3f, axis: u32) -> vec3f {
  var s = (pos - fp.origin) / fp.cellSize - vec3f(0.5);
  s[axis] = s[axis] + 0.5;
  return s;
}

fn fluidIndex(gid: vec3u) -> u32 { return gid.x + gid.y * fp.dispatchWidth; }
`;

export const FLOCK_FLUID_WGSL = /* wgsl */ `
${FLOCK_FLUID_COMMON_WGSL}

@compute @workgroup_size(${FLOCK_FLUID_WORKGROUP})
fn fluidClear(@builtin(global_invocation_id) gid: vec3u) {
  let i = fluidIndex(gid);
  let nF = totalFaces();
  if (i < nF * 2u) { atomicStore(&acc[i], 0); }
  let nC = cellCountTotal();
  if (i < nC) {
    atomicStore(&counts[i], 0u);
    cells[i] = 0.0;
    cells[nC + i] = 0.0;
  }
}

@compute @workgroup_size(${FLOCK_FLUID_WORKGROUP})
fn fluidP2G(@builtin(global_invocation_id) gid: vec3u) {
  let index = fluidIndex(gid);
  if (index >= fp.count) { return; }
  let p = particles[index];
  if (p.age < 0.0) { return; }
  let g = (p.pos - fp.origin) / fp.cellSize;
  let cell = vec3i(floor(g));
  if (inCells(cell)) { atomicAdd(&counts[cellIndex(vec3u(cell))], 1u); }
  let nF = totalFaces();
  for (var axis = 0u; axis < 3u; axis++) {
    let s = sampleCoord(p.pos, axis);
    let base = vec3i(floor(s));
    let f = s - floor(s);
    let d = vec3i(faceDims(axis));
    for (var corner = 0u; corner < 8u; corner++) {
      let o = vec3i(i32(corner & 1u), i32((corner >> 1u) & 1u), i32((corner >> 2u) & 1u));
      let c = base + o;
      if (any(c < vec3i(0)) || any(c >= d)) { continue; }
      let wv = mix(1.0 - f, f, vec3f(o));
      let w = wv.x * wv.y * wv.z;
      if (w <= 0.0) { continue; }
      let fi = faceIndex(axis, vec3u(c));
      atomicAdd(&acc[fi], i32(round(p.vel[axis] * w * VS)));
      atomicAdd(&acc[nF + fi], i32(round(w * WS)));
    }
  }
}

/** Decodes a global face index into (axis, face coordinate). */
fn decodeFace(fIn: u32) -> vec4u {
  var f = fIn;
  var axis = 0u;
  if (f >= faceCount(0u)) { f -= faceCount(0u); axis = 1u; }
  if (axis == 1u && f >= faceCount(1u)) { f -= faceCount(1u); axis = 2u; }
  let d = faceDims(axis);
  let x = f % d.x;
  let y = (f / d.x) % d.y;
  let z = f / (d.x * d.y);
  return vec4u(x, y, z, axis);
}

fn isWallFace(face: vec4u) -> bool {
  let axis = face.w;
  let coord = face[axis];
  return coord == 0u || coord == fp.dims[axis];
}

@compute @workgroup_size(${FLOCK_FLUID_WORKGROUP})
fn fluidNormalize(@builtin(global_invocation_id) gid: vec3u) {
  let f = fluidIndex(gid);
  let nF = totalFaces();
  if (f >= nF) { return; }
  let face = decodeFace(f);
  let weight = f32(atomicLoad(&acc[nF + f])) / WS;
  var value = 0.0;
  var valid = 0.0;
  if (isWallFace(face)) {
    valid = 1.0;
  } else if (weight > 1e-6) {
    value = (f32(atomicLoad(&acc[f])) / VS) / weight;
    valid = 1.0;
  }
  faces[f] = value;
  faces[nF + f] = value;
  faces[nF * 2u + f] = valid;
}

@compute @workgroup_size(${FLOCK_FLUID_WORKGROUP})
fn fluidDivergence(@builtin(global_invocation_id) gid: vec3u) {
  let ci = fluidIndex(gid);
  let nC = cellCountTotal();
  if (ci >= nC) { return; }
  if (atomicLoad(&counts[ci]) == 0u) { cells[ci] = 0.0; return; }
  let c = vec3u(ci % fp.dims.x, (ci / fp.dims.x) % fp.dims.y, ci / (fp.dims.x * fp.dims.y));
  var div = 0.0;
  for (var axis = 0u; axis < 3u; axis++) {
    var hi = c;
    hi[axis] = hi[axis] + 1u;
    div += faces[faceIndex(axis, hi)] - faces[faceIndex(axis, c)];
  }
  cells[ci] = div;
}

@compute @workgroup_size(${FLOCK_FLUID_WORKGROUP})
fn fluidProject(@builtin(global_invocation_id) gid: vec3u) {
  let f = fluidIndex(gid);
  let nF = totalFaces();
  if (f >= nF) { return; }
  let face = decodeFace(f);
  if (isWallFace(face)) { return; }
  let axis = face.w;
  let hi = vec3i(face.xyz);
  var lo = hi;
  lo[axis] = lo[axis] - 1;
  let fluidLo = isFluid(lo);
  let fluidHi = isFluid(hi);
  if (!fluidLo && !fluidHi) { return; }
  let nC = cellCountTotal();
  var pLo = 0.0;
  var pHi = 0.0;
  if (fluidLo) { pLo = cells[nC + cellIndex(vec3u(lo))]; }
  if (fluidHi) { pHi = cells[nC + cellIndex(vec3u(hi))]; }
  faces[f] = faces[f] - (pHi - pLo);
  faces[nF * 2u + f] = 1.0;
}

struct FaceSample { value: vec3f, previous: vec3f, weight: vec3f, };

fn sampleFaces(pos: vec3f) -> FaceSample {
  var out: FaceSample;
  let nF = totalFaces();
  for (var axis = 0u; axis < 3u; axis++) {
    let s = sampleCoord(pos, axis);
    let base = vec3i(floor(s));
    let f = s - floor(s);
    let d = vec3i(faceDims(axis));
    var value = 0.0;
    var previous = 0.0;
    var weight = 0.0;
    for (var corner = 0u; corner < 8u; corner++) {
      let o = vec3i(i32(corner & 1u), i32((corner >> 1u) & 1u), i32((corner >> 2u) & 1u));
      let c = base + o;
      if (any(c < vec3i(0)) || any(c >= d)) { continue; }
      let fi = faceIndex(axis, vec3u(c));
      if (faces[nF * 2u + fi] < 0.5) { continue; }
      let wv = mix(1.0 - f, f, vec3f(o));
      let w = wv.x * wv.y * wv.z;
      value += faces[fi] * w;
      previous += faces[nF + fi] * w;
      weight += w;
    }
    out.value[axis] = value;
    out.previous[axis] = previous;
    out.weight[axis] = weight;
  }
  return out;
}

@compute @workgroup_size(${FLOCK_FLUID_WORKGROUP})
fn fluidG2P(@builtin(global_invocation_id) gid: vec3u) {
  let index = fluidIndex(gid);
  if (index >= fp.count) { return; }
  var p = particles[index];
  if (p.age < 0.0) { return; }
  let s = sampleFaces(p.pos);
  let vStar = p.vel;
  var v = vStar;
  for (var axis = 0u; axis < 3u; axis++) {
    if (s.weight[axis] <= 1e-6) { continue; }
    let pic = s.value[axis] / s.weight[axis];
    let flip = vStar[axis] + (s.value[axis] - s.previous[axis]) / s.weight[axis];
    v[axis] = mix(pic, flip, fp.flipRatio);
  }
  var pos = p.pos + (v - vStar) * fp.dt;
  let lo = fp.origin + vec3f(fp.cellSize * 0.01);
  let hi = fp.origin + vec3f(fp.dims) * fp.cellSize - vec3f(fp.cellSize * 0.01);
  for (var axis = 0u; axis < 3u; axis++) {
    if (pos[axis] < lo[axis]) { pos[axis] = lo[axis]; v[axis] = max(v[axis], 0.0); }
    if (pos[axis] > hi[axis]) { pos[axis] = hi[axis]; v[axis] = min(v[axis], 0.0); }
  }
  p.pos = pos;
  p.vel = v;
  particles[index] = p;
}
`;
