import { FLOCK_FLUID_COMMON_WGSL } from './flockFluidWgsl';

/** Fixed-point sums preserve the reference P2G result exactly, including rounding. */
export const FLOCK_FLUID_BLOCK_TRANSFER_WGSL = /* wgsl */ `
${FLOCK_FLUID_COMMON_WGSL}
var<workgroup> faceKeys: array<atomic<u32>, 512>;
var<workgroup> velocities: array<atomic<i32>, 512>;
var<workgroup> weights: array<atomic<i32>, 512>;
const EMPTY_FACE: u32 = 0xffffffffu;

fn addFace(face: u32, velocity: i32, weight: i32) {
  var slot = (face * 2654435761u) & 511u;
  // Bounded probing also covers sparse/unsorted populations. Never drop a
  // contribution if the workgroup table fills or weak compare-exchange fails.
  for (var attempt = 0u; attempt < 16u; attempt++) {
    let old = atomicCompareExchangeWeak(&faceKeys[slot], EMPTY_FACE, face);
    if (old.exchanged || old.old_value == face) {
      atomicAdd(&velocities[slot], velocity);
      atomicAdd(&weights[slot], weight);
      return;
    }
    if (old.old_value != EMPTY_FACE) { slot = (slot + 1u) & 511u; }
  }
  atomicAdd(&acc[face], velocity);
  atomicAdd(&acc[totalFaces() + face], weight);
}

@compute @workgroup_size(256)
fn fluidP2GBlock(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  for (var slot = lane; slot < 512u; slot += 256u) {
    atomicStore(&faceKeys[slot], EMPTY_FACE);
    atomicStore(&velocities[slot], 0);
    atomicStore(&weights[slot], 0);
  }
  workgroupBarrier();
  let index = fluidIndex(gid);
  if (index < fp.count) {
    let p = particles[index];
    if (p.age >= 0.0) {
      for (var axis = 0u; axis < 3u; axis++) {
        let row = affineRow(particleIdentity(index), axis, p.age);
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
          let velocity = p.vel[axis] + dot(row, (vec3f(o) - f) * fp.cellSize);
          if (w > 0.0) {
            let fi = faceIndex(axis, vec3u(c));
            let nF = totalFaces();
            addFace(fi, i32(round(velocity * w * faces[2u * nF + fi])), i32(round(w * faces[3u * nF + fi])));
          }
        }
      }
    }
  }
  workgroupBarrier();
  for (var slot = lane; slot < 512u; slot += 256u) {
    let face = atomicLoad(&faceKeys[slot]);
    if (face != EMPTY_FACE) {
      atomicAdd(&acc[face], atomicLoad(&velocities[slot]));
      atomicAdd(&acc[totalFaces() + face], atomicLoad(&weights[slot]));
    }
  }
}
`;
