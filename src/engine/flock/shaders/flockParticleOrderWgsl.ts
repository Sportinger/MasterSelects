import { FLOCK_WGSL_STRUCTS } from './flockWgslShared';

export const FLOCK_PARTICLE_ORDER_WGSL = /* wgsl */ `
${FLOCK_WGSL_STRUCTS}
struct Pair { key: u32, identity: u32, };
struct Params {
  origin: vec3f, cellSize: f32,
  dims: vec3u, count: u32,
  dispatchWidth: u32, pad0: u32, pad1: u32, pad2: u32,
};
@group(0) @binding(0) var<storage, read> source: array<Particle>;
@group(0) @binding(1) var<storage, read_write> destination: array<Particle>;
@group(0) @binding(2) var<storage, read_write> mapping: array<u32>;
@group(0) @binding(3) var<storage, read_write> permutation: array<Pair>;
@group(0) @binding(4) var<uniform> params: Params;
fn indexOf(gid: vec3u) -> u32 { return gid.x + gid.y * params.dispatchWidth; }
fn slotOf(identity: u32) -> u32 { return mapping[1u + params.count + identity]; }

@compute @workgroup_size(256)
fn keys(@builtin(global_invocation_id) gid: vec3u) {
  let identity = indexOf(gid);
  if (identity >= params.count) { return; }
  let p = source[slotOf(identity)];
  let cell = vec3i(floor((p.pos - params.origin) / params.cellSize));
  var key = params.dims.x * params.dims.y * params.dims.z;
  if (p.age >= 0.0 && all(cell >= vec3i(0)) && all(cell < vec3i(params.dims))) {
    let c = vec3u(cell);
    key = c.x + params.dims.x * (c.y + params.dims.y * c.z);
  }
  permutation[identity] = Pair(key, identity);
}

@compute @workgroup_size(256)
fn reorder(@builtin(global_invocation_id) gid: vec3u) {
  let slot = indexOf(gid);
  if (slot < params.count) { destination[slot] = source[slotOf(permutation[slot].identity)]; }
}

@compute @workgroup_size(256)
fn canonical(@builtin(global_invocation_id) gid: vec3u) {
  let identity = indexOf(gid);
  if (identity < min(params.count, arrayLength(&destination))) { destination[identity] = source[slotOf(identity)]; }
}

@compute @workgroup_size(256)
fn updateMapping(@builtin(global_invocation_id) gid: vec3u) {
  let slot = indexOf(gid);
  if (slot >= params.count) { return; }
  let identity = permutation[slot].identity;
  mapping[1u + slot] = identity;
  mapping[1u + params.count + identity] = slot;
}

@compute @workgroup_size(256)
fn resetMapping(@builtin(global_invocation_id) gid: vec3u) {
  let slot = indexOf(gid);
  if (slot == 0u) { mapping[0] = params.count; }
  if (slot >= params.count) { return; }
  mapping[1u + slot] = slot;
  mapping[1u + params.count + slot] = slot;
}
`;
