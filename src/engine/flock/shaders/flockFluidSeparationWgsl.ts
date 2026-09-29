import type { FlockParticleLayout } from '../shared/flockParticleLayout';
import { flockWgslStructs, FLOCK_WGSL_MATH } from './flockWgslShared';
import { flockIdentityWgsl } from './flockIdentityWgsl';
import { FLOCK_FLUID_PARAMS_WGSL } from './flockFluidWgsl';
import { FLOCK_FLUID_REGULARIZATION_WGSL } from './flockFluidRegularizationWgsl';

export function flockFluidSeparationWgsl(layout: FlockParticleLayout = 'full64'): string {
  return /* wgsl */ `
${flockWgslStructs(layout)}
${FLOCK_WGSL_MATH}
${FLOCK_FLUID_PARAMS_WGSL}
${FLOCK_FLUID_REGULARIZATION_WGSL}
struct Pair { key: u32, identity: u32, };
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read> pairs: array<Pair>;
@group(0) @binding(2) var<storage, read_write> ranges: array<u32>;
@group(0) @binding(3) var<storage, read_write> corrections: array<vec4f>;
${flockIdentityWgsl(4)}
@group(0) @binding(5) var<uniform> fp: FluidParams;
fn indexOf(gid: vec3u) -> u32 { return gid.x + gid.y * fp.dispatchWidth; }
fn cellsCount() -> u32 { return fp.dims.x * fp.dims.y * fp.dims.z; }

@compute @workgroup_size(256)
fn clearRanges(@builtin(global_invocation_id) gid: vec3u) {
  let index = indexOf(gid);
  if (index < cellsCount() * 2u) { ranges[index] = 0u; }
}
@compute @workgroup_size(256)
fn buildRanges(@builtin(global_invocation_id) gid: vec3u) {
  let index = indexOf(gid);
  if (index >= fp.count) { return; }
  // Snapshot positions in cell order once, instead of mapping and gathering
  // them for every neighbor. The second half fits even the 32-byte workspace.
  let position = particles[particleSlot(pairs[index].identity)];
  corrections[fp.count + index] = vec4f(position.pos, position.age);
  let key = pairs[index].key;
  if (key >= cellsCount()) { return; }
  if (index == 0u) { ranges[key] = index; }
  else if (pairs[index - 1u].key != key) { ranges[key] = index; }
  if (index + 1u == fp.count) { ranges[cellsCount() + key] = index + 1u; }
  else if (pairs[index + 1u].key != key) { ranges[cellsCount() + key] = index + 1u; }
}
@compute @workgroup_size(256)
fn computeCorrections(@builtin(global_invocation_id) gid: vec3u) {
  let sortedIndex = indexOf(gid);
  if (sortedIndex >= fp.count) { return; }
  // Adjacent lanes query the same cell neighborhood. Identity-order dispatch
  // scatters those gathers across the entire particle buffer after advection.
  let identity = pairs[sortedIndex].identity;
  corrections[identity] = vec4f(0.0);
  let p = corrections[fp.count + sortedIndex];
  if (p.w < 0.0) { return; }
  let radius = clamp(fp.separationDistance, 0.0, 0.5) * fp.cellSize;
  let low = max(vec3i(0), vec3i(floor((p.xyz - fp.origin - vec3f(radius)) / fp.cellSize)));
  let high = min(vec3i(fp.dims) - vec3i(1), vec3i(floor((p.xyz - fp.origin + vec3f(radius)) / fp.cellSize)));
  var localCells: array<u32, 27>;
  var cellLength = 0u;
  var candidates = 0u;
  for (var z = low.z; z <= high.z; z++) {
    for (var y = low.y; y <= high.y; y++) {
      for (var x = low.x; x <= high.x; x++) {
        let cell = u32(x) + fp.dims.x * (u32(y) + fp.dims.y * u32(z));
        localCells[cellLength] = cell; cellLength++;
        candidates += ranges[cellsCount() + cell] - ranges[cell];
      }
    }
  }
  let stride = max(1u, (candidates + 63u) / 64u);
  let phase = hashU32(identity) % stride;
  var running = 0u;
  var neighbors = 0u;
  var correction = vec3f(0.0);
  for (var c = 0u; c < cellLength; c++) {
    let cell = localCells[c];
    let start = ranges[cell]; let end = ranges[cellsCount() + cell];
    let first = (stride - ((running + phase) % stride)) % stride;
    running += end - start;
    for (var index = start + first; index < end; index += stride) {
      if (index == sortedIndex) { continue; }
      let delta = p.xyz - corrections[fp.count + index].xyz;
      let distance = length(delta);
      if (distance >= radius) { continue; }
      let other = pairs[index].identity;
      var direction = fluidPairDirection(identity, other);
      if (distance > fp.cellSize * 1e-7) { direction = delta / distance; }
      correction += direction * (radius - distance); neighbors++;
    }
  }
  let relaxation = clamp(fp.separationStrength * fp.dt * 60.0, 0.0, 0.5);
  corrections[identity] = vec4f(correction * (0.5 * relaxation / f32(max(1u, neighbors))), 0.0);
}
@compute @workgroup_size(256)
fn applyCorrections(@builtin(global_invocation_id) gid: vec3u) {
  let slot = indexOf(gid);
  if (slot >= fp.count) { return; }
  let identity = particleIdentity(slot);
  if (particles[slot].age < 0.0) { return; }
  let low = fp.origin + vec3f(fp.cellSize * 0.01);
  let high = fp.origin + (vec3f(fp.dims) - vec3f(0.01)) * fp.cellSize;
  particles[slot].pos = clamp(particles[slot].pos + corrections[identity].xyz, low, high);
}
`;
}

export const FLOCK_FLUID_SEPARATION_WGSL = flockFluidSeparationWgsl();
