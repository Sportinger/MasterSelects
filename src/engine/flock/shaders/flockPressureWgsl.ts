import { FLOCK_PRESSURE_ABSOLUTE_TOLERANCE, FLOCK_PRESSURE_RELATIVE_TOLERANCE, FLOCK_PRESSURE_COARSE_SWEEPS } from '../shared/flockPressureLayout';

/** Galerkin aggregation MGPCG; CPU reference: cpu/flockCpuPressure.ts. */
export const FLOCK_PRESSURE_WGSL = /* wgsl */ `
struct Params {
  dims: vec3u, count: u32,
  offset: u32, fineOffset: u32, coarseOffset: u32, width: u32,
  fineDims: vec3u, total: u32,
  coarseDims: vec3u, partials: u32,
};
@group(0) @binding(0) var<storage, read> counts: array<u32>;
@group(0) @binding(1) var<storage, read_write> cells: array<f32>;
@group(0) @binding(2) var<storage, read_write> matrix: array<vec4f>;
// Multigrid fields: rhs, correction, smoothing scratch, unused.
@group(0) @binding(3) var<storage, read_write> mg: array<vec4f>;
// Header: (rho, beta, alpha, active), (initial norm squared, threshold, iterations, unused).
// Then fine-grid (residual, direction, A*direction, unused) and reduction partials.
@group(0) @binding(4) var<storage, read_write> cg: array<vec4f>;
@group(0) @binding(5) var<uniform> p: Params;
// Only initialization and scalar reductions bind this writable control group.
// Other kernels consume it solely as an indirect argument buffer.
@group(1) @binding(0) var<storage, read_write> dispatch: array<u32>;
var<workgroup> sums: array<vec2f, 256>;
var<workgroup> coarseValues: array<f32, 64>;

fn index(gid: vec3u) -> u32 { return gid.x + gid.y * p.width; }
fn coord(i: u32, dims: vec3u) -> vec3u { return vec3u(i % dims.x, (i / dims.x) % dims.y, i / (dims.x * dims.y)); }
fn linear(c: vec3u, dims: vec3u) -> u32 { return c.x + dims.x * (c.y + dims.y * c.z); }
fn stride(axis: u32, dims: vec3u) -> u32 { return select(select(dims.x * dims.y, dims.x, axis == 1u), 1u, axis == 0u); }

fn stopPressure() {
  cg[0].w = 0.0;
  for (var l = 0u; l < arrayLength(&dispatch) / 4u; l++) { dispatch[l * 4u] = 0u; }
}

fn applyMg(i: u32, dims: vec3u, offset: u32, component: u32) -> f32 {
  let c = coord(i, dims); let at = offset + i;
  var value = matrix[at].x * mg[at][component];
  for (var axis = 0u; axis < 3u; axis++) {
    let s = stride(axis, dims);
    if (c[axis] > 0u) { value -= matrix[at - s][axis + 1u] * mg[at - s][component]; }
    if (c[axis] + 1u < dims[axis]) { value -= matrix[at][axis + 1u] * mg[at + s][component]; }
  }
  return value;
}

fn applyDirection(i: u32) -> f32 {
  let c = coord(i, p.dims); var value = matrix[i].x * cg[2u + i].y;
  for (var axis = 0u; axis < 3u; axis++) {
    let s = stride(axis, p.dims);
    if (c[axis] > 0u) { value -= matrix[i - s][axis + 1u] * cg[2u + i - s].y; }
    if (c[axis] + 1u < p.dims[axis]) { value -= matrix[i][axis + 1u] * cg[2u + i + s].y; }
  }
  return value;
}

@compute @workgroup_size(256)
fn pressureInit(@builtin(global_invocation_id) gid: vec3u) {
  let i = index(gid); if (i >= p.count) { return; }
  if (i == 0u) {
    cg[0] = vec4f(0.0, 0.0, 0.0, 1.0); cg[1] = vec4f(-1.0, 0.0, 0.0, 0.0);
    var dims = p.dims;
    for (var l = 0u; l < arrayLength(&dispatch) / 4u; l++) {
      let groups = (dims.x * dims.y * dims.z + 255u) / 256u; let width = p.width / 256u;
      dispatch[l * 4u] = min(groups, width); dispatch[l * 4u + 1u] = (groups + width - 1u) / width; dispatch[l * 4u + 2u] = 1u;
      dims = (dims + 1u) / 2u;
    }
  }
  let c = coord(i, p.dims); var row = vec4f(0.0);
  if (counts[i] > 0u) {
    for (var axis = 0u; axis < 3u; axis++) {
      if (c[axis] > 0u) { row.x += 1.0; }
      if (c[axis] + 1u < p.dims[axis]) {
        row.x += 1.0;
        row[axis + 1u] = select(0.0, 1.0, counts[i + stride(axis, p.dims)] > 0u);
      }
    }
  }
  matrix[i] = row;
  let rhs = select(0.0, -cells[i], counts[i] > 0u);
  cg[2u + i] = vec4f(rhs, 0.0, 0.0, 0.0); mg[i] = vec4f(rhs, 0.0, 0.0, 0.0);
  cells[p.total + i] = 0.0;
}

@compute @workgroup_size(256)
fn pressureCoarsen(@builtin(global_invocation_id) gid: vec3u) {
  let i = index(gid); if (i >= p.count) { return; }
  let base = coord(i, p.dims) * 2u; var row = vec4f(0.0);
  for (var corner = 0u; corner < 8u; corner++) {
    let c = base + vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    if (any(c >= p.fineDims)) { continue; }
    let child = matrix[p.fineOffset + linear(c, p.fineDims)]; row.x += child.x;
    for (var axis = 0u; axis < 3u; axis++) {
      if ((c[axis] & 1u) == 0u) { row.x -= 2.0 * child[axis + 1u]; }
      else { row[axis + 1u] += child[axis + 1u]; }
    }
  }
  matrix[p.offset + i] = row;
}

fn smoothPressureCell(i: u32, readComponent: u32, writeComponent: u32) {
  if (i >= p.count || cg[0].w < 0.5) { return; }
  let at = p.offset + i; let diagonal = matrix[at].x;
  var value = 0.0;
  if (diagonal > 0.0) { value = mg[at][readComponent] + (2.0 / 3.0) * (mg[at].x - applyMg(i, p.dims, p.offset, readComponent)) / diagonal; }
  mg[at][writeComponent] = value;
}
@compute @workgroup_size(256)
fn pressureSmoothAB(@builtin(global_invocation_id) gid: vec3u) { smoothPressureCell(index(gid), 1u, 2u); }
@compute @workgroup_size(256)
fn pressureSmoothBA(@builtin(global_invocation_id) gid: vec3u) { smoothPressureCell(index(gid), 2u, 1u); }

// The terminal level has <=64 cells. All coarse sweeps fit in one workgroup,
// avoiding sixteen separate dispatches for each preconditioner application.
@compute @workgroup_size(256)
fn pressureCoarseSolve(@builtin(local_invocation_index) lane: u32) {
  if (lane < 64u) { coarseValues[lane] = 0.0; }
  workgroupBarrier();
  var row = vec4f(0.0); var rhs = 0.0;
  if (lane < p.count) { row = matrix[p.offset + lane]; rhs = mg[p.offset + lane].x; }
  for (var sweep = 0u; sweep < ${FLOCK_PRESSURE_COARSE_SWEEPS}u; sweep++) {
    var next = 0.0;
    if (lane < p.count && row.x > 0.0 && cg[0].w > 0.5) {
      let c = coord(lane, p.dims); var product = row.x * coarseValues[lane];
      for (var axis = 0u; axis < 3u; axis++) {
        let s = stride(axis, p.dims);
        if (c[axis] > 0u) { product -= matrix[p.offset + lane - s][axis + 1u] * coarseValues[lane - s]; }
        if (c[axis] + 1u < p.dims[axis]) { product -= row[axis + 1u] * coarseValues[lane + s]; }
      }
      next = coarseValues[lane] + (2.0 / 3.0) * (rhs - product) / row.x;
    }
    workgroupBarrier();
    if (lane < 64u) { coarseValues[lane] = next; }
    workgroupBarrier();
  }
  if (lane < p.count) { mg[p.offset + lane].y = coarseValues[lane]; }
}

@compute @workgroup_size(256)
fn pressureRestrict(@builtin(global_invocation_id) gid: vec3u) {
  let i = index(gid); if (i >= p.count || cg[0].w < 0.5) { return; }
  let base = coord(i, p.dims) * 2u; var rhs = 0.0;
  for (var corner = 0u; corner < 8u; corner++) {
    let c = base + vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    if (any(c >= p.fineDims)) { continue; }
    let j = linear(c, p.fineDims);
    rhs += mg[p.fineOffset + j].x - applyMg(j, p.fineDims, p.fineOffset, 1u);
  }
  mg[p.offset + i] = vec4f(rhs, 0.0, 0.0, 0.0);
}

@compute @workgroup_size(256)
fn pressureProlong(@builtin(global_invocation_id) gid: vec3u) {
  let i = index(gid); if (i >= p.count || cg[0].w < 0.5) { return; }
  if (matrix[p.offset + i].x > 0.0) {
    mg[p.offset + i].y += mg[p.coarseOffset + linear(coord(i, p.dims) / 2u, p.coarseDims)].y;
  }
}

fn reduce(lane: u32, value: vec2f) -> vec2f {
  sums[lane] = value; workgroupBarrier();
  for (var step = 128u; step > 0u; step >>= 1u) {
    if (lane < step) { sums[lane] += sums[lane + step]; }
    workgroupBarrier();
  }
  return sums[0];
}

@compute @workgroup_size(256)
fn pressureRho(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  let i = index(gid); var value = vec2f(0.0);
  if (i < p.count && cg[0].w > 0.5) { let r = cg[2u + i].x; value = vec2f(r * mg[i].y, r * r); }
  let sum = reduce(lane, value);
  if (lane == 0u) { cg[2u + p.total + i / 256u] = vec4f(sum, 0.0, 0.0); }
}

@compute @workgroup_size(256)
fn pressureReduceRho(@builtin(local_invocation_index) lane: u32) {
  var value = vec2f(0.0);
  for (var i = lane; i < p.partials; i += 256u) { value += cg[2u + p.total + i].xy; }
  let sum = reduce(lane, value);
  if (lane == 0u && cg[0].w > 0.5) {
    if (cg[1].x < 0.0) { cg[1].x = sum.y; cg[1].y = max(sum.y * ${FLOCK_PRESSURE_RELATIVE_TOLERANCE ** 2}, ${FLOCK_PRESSURE_ABSOLUTE_TOLERANCE ** 2}); }
    if (sum.y <= cg[1].y || !(sum.x > 0.0 && sum.x < 3.4e38)) { stopPressure(); }
    else {
      var beta = 0.0; if (cg[0].x > 0.0) { beta = sum.x / cg[0].x; }
      cg[0].y = beta; cg[0].x = sum.x;
    }
  }
}

@compute @workgroup_size(256)
fn pressureDirection(@builtin(global_invocation_id) gid: vec3u) {
  let i = index(gid); if (i >= p.count || cg[0].w < 0.5) { return; }
  cg[2u + i].y = mg[i].y + cg[0].y * cg[2u + i].y;
}

@compute @workgroup_size(256)
fn pressureProduct(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  let i = index(gid); var value = vec2f(0.0);
  if (i < p.count && cg[0].w > 0.5) { let q = applyDirection(i); cg[2u + i].z = q; value.x = cg[2u + i].y * q; }
  let sum = reduce(lane, value);
  if (lane == 0u) { cg[2u + p.total + i / 256u] = vec4f(sum, 0.0, 0.0); }
}

@compute @workgroup_size(256)
fn pressureReduceAlpha(@builtin(local_invocation_index) lane: u32) {
  var value = vec2f(0.0);
  for (var i = lane; i < p.partials; i += 256u) { value += cg[2u + p.total + i].xy; }
  let sum = reduce(lane, value);
  if (lane == 0u && cg[0].w > 0.5) {
    if (!(sum.x > 0.0 && sum.x < 3.4e38)) { stopPressure(); }
    else { cg[0].z = cg[0].x / sum.x; cg[1].z += 1.0; }
  }
}

@compute @workgroup_size(256)
fn pressureUpdate(@builtin(global_invocation_id) gid: vec3u) {
  let i = index(gid); if (i >= p.count || cg[0].w < 0.5) { return; }
  cells[p.total + i] += cg[0].z * cg[2u + i].y;
  let r = cg[2u + i].x - cg[0].z * cg[2u + i].z;
  cg[2u + i].x = r; mg[i] = vec4f(r, 0.0, 0.0, 0.0);
}
`;
