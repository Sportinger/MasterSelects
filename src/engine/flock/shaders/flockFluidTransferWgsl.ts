import type { FlockParticleLayout } from '../shared/flockParticleLayout';
import { flockFluidCommonWgsl } from './flockFluidWgsl';

/** Workgroup accumulation slots of the block transfer (3 x 4 bytes each, 12 KiB < the 16 KiB spec minimum). */
export const FLOCK_FLUID_BLOCK_SLOTS = 1024;

/**
 * Particle-to-grid transfer with workgroup-local accumulation. Fixed-point sums
 * preserve the reference `fluidP2G` result exactly, including rounding: every
 * contribution is the same integer, added either to a workgroup slot (flushed
 * once) or straight to the global sum.
 *
 * Slots are claimed with `atomicMin` in a separate phase (the smallest face that
 * hashes to a slot owns it) instead of a compare-exchange hash table, so the claim
 * order no longer depends on scheduling. Shipping Safari's Metal compiler rejected
 * the earlier block transfer (production 2026-10-29, compiler line truncated). The
 * old `atomicCompareExchangeWeak` claim on workgroup memory was valid WGSL (WGSL
 * atomic built-ins allow the workgroup address space) and within the default
 * limits; its WebKit MSL codegen (`__wgslAtomicCompareExchangeWeak`, since changed
 * in WebKit trunk) is the most likely cause, a strong inference, not confirmed.
 */
export function flockFluidBlockTransferWgsl(layout: FlockParticleLayout = 'full64'): string {
  return /* wgsl */ `
${flockFluidCommonWgsl(layout)}
const BLOCK_SLOTS: u32 = ${FLOCK_FLUID_BLOCK_SLOTS}u;
const EMPTY_FACE: u32 = 0xffffffffu;
var<workgroup> faceKeys: array<atomic<u32>, ${FLOCK_FLUID_BLOCK_SLOTS}>;
var<workgroup> velocities: array<atomic<i32>, ${FLOCK_FLUID_BLOCK_SLOTS}>;
var<workgroup> weights: array<atomic<i32>, ${FLOCK_FLUID_BLOCK_SLOTS}>;

// An odd multiplier permutes the low bits, so any 1024 consecutive faces (a
// spatially sorted workgroup) map to distinct slots.
fn blockSlot(face: u32) -> u32 { return (face * 2654435761u) & (BLOCK_SLOTS - 1u); }

fn cornerOffset(corner: u32) -> vec3i {
  return vec3i(i32(corner & 1u), i32((corner >> 1u) & 1u), i32((corner >> 2u) & 1u));
}

fn claimFaces(pos: vec3f) {
  for (var axis = 0u; axis < 3u; axis++) {
    let s = sampleCoord(pos, axis);
    let base = vec3i(floor(s));
    let f = s - floor(s);
    let d = vec3i(faceDims(axis));
    for (var corner = 0u; corner < 8u; corner++) {
      let o = cornerOffset(corner);
      let c = base + o;
      if (any(c < vec3i(0)) || any(c >= d)) { continue; }
      let wv = mix(1.0 - f, f, vec3f(o));
      if (wv.x * wv.y * wv.z > 0.0) {
        let face = faceIndex(axis, vec3u(c));
        atomicMin(&faceKeys[blockSlot(face)], face);
      }
    }
  }
}

fn addFace(face: u32, velocity: i32, weight: i32) {
  let slot = blockSlot(face);
  if (atomicLoad(&faceKeys[slot]) == face) {
    atomicAdd(&velocities[slot], velocity);
    atomicAdd(&weights[slot], weight);
    return;
  }
  // The slot belongs to another face: this contribution goes straight to the grid.
  atomicAdd(&acc[face], velocity);
  atomicAdd(&acc[totalFaces() + face], weight);
}

@compute @workgroup_size(256)
fn fluidP2GBlock(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  for (var slot = lane; slot < BLOCK_SLOTS; slot += 256u) {
    atomicStore(&faceKeys[slot], EMPTY_FACE);
    atomicStore(&velocities[slot], 0);
    atomicStore(&weights[slot], 0);
  }
  let index = fluidIndex(gid);
  var live = index < fp.count;
  var p: Particle;
  if (live) {
    p = particles[index];
    live = p.age >= 0.0;
  }
  workgroupBarrier();
  if (live) { claimFaces(p.pos); }
  workgroupBarrier();
  if (live) {
    for (var axis = 0u; axis < 3u; axis++) {
      let row = affineRow(particleIdentity(index), axis, p.age);
      let s = sampleCoord(p.pos, axis);
      let base = vec3i(floor(s));
      let f = s - floor(s);
      let d = vec3i(faceDims(axis));
      for (var corner = 0u; corner < 8u; corner++) {
        let o = cornerOffset(corner);
        let c = base + o;
        if (any(c < vec3i(0)) || any(c >= d)) { continue; }
        let wv = mix(1.0 - f, f, vec3f(o));
        let w = wv.x * wv.y * wv.z;
        let velocity = p.vel[axis] + dot(row, (vec3f(o) - f) * fp.cellSize);
        if (w > 0.0) {
          let fi = faceIndex(axis, vec3u(c));
          let nF = totalFaces();
          addFace(fi, i32(round(velocity * w * faces[2u * nF + fi])), i32(round(w * faces[3u * nF + fi])));
        }
      }
    }
  }
  workgroupBarrier();
  for (var slot = lane; slot < BLOCK_SLOTS; slot += 256u) {
    let face = atomicLoad(&faceKeys[slot]);
    if (face != EMPTY_FACE) {
      atomicAdd(&acc[face], atomicLoad(&velocities[slot]));
      atomicAdd(&acc[totalFaces() + face], atomicLoad(&weights[slot]));
    }
  }
}
`;
}

export const FLOCK_FLUID_BLOCK_TRANSFER_WGSL = flockFluidBlockTransferWgsl();
