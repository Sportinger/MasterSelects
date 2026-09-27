/** Density and affine-velocity bounds for deterministic, overflow-safe P2G sums. */
export const FLOCK_FLUID_TRANSFER_BOUNDS_WGSL = /* wgsl */ `
@compute @workgroup_size(256)
fn fluidTransferBounds(@builtin(global_invocation_id) gid: vec3u) {
  let index = fluidIndex(gid);
  if (index >= fp.count) { return; }
  let p = particles[index];
  if (p.age < 0.0) { return; }
  let cell = vec3i(floor((p.pos - fp.origin) / fp.cellSize));
  if (inCells(cell)) { atomicAdd(&counts[cellIndex(vec3u(cell))], 1u); }
  // Outside particles can still contribute to boundary faces. Include them in
  // the nearest cell's bounds without marking that cell as liquid.
  let clamped = vec3u(clamp(cell, vec3i(0), vec3i(fp.dims) - vec3i(1)));
  let ci = cellIndex(clamped);
  let nC = cellCountTotal();
  atomicAdd(&counts[nC + ci], 1u);
  for (var axis = 0u; axis < 3u; axis++) {
    let row = abs(affineRow(particleIdentity(index), axis, p.age));
    // Every trilinear corner is at most one cell away along each axis.
    let bound = abs(p.vel[axis]) + fp.cellSize * (row.x + row.y + row.z);
    atomicMax(&counts[(2u + axis) * nC + ci], bitcast<u32>(bound));
  }
}

fn transferScale(base: f32, contributors: f32, magnitude: f32) -> f32 {
  // Half of int32's positive range leaves room for per-contribution rounding
  // and floating-point bound arithmetic, even at the planned 64M capacity.
  let safe = 1073741824.0 / max(contributors, 1.0) / max(magnitude, 1.0);
  return min(base, exp2(floor(log2(safe))));
}

@compute @workgroup_size(256)
fn fluidTransferScales(@builtin(global_invocation_id) gid: vec3u) {
  let fi = fluidIndex(gid);
  let nF = totalFaces();
  if (fi >= nF) { return; }
  let face = decodeFace(fi);
  let axis = face.w;
  // A MAC face receives particles from two cells along its normal and three
  // along each tangent. Restrict the range before looping, so wall cells are
  // counted only once. Clamped outside particles are covered by the same range.
  let lo = max(vec3i(face.xyz) - vec3i(1), vec3i(0));
  var hi = min(vec3i(face.xyz) + vec3i(1), vec3i(fp.dims) - vec3i(1));
  hi[axis] = min(i32(face[axis]), i32(fp.dims[axis]) - 1);
  let nC = cellCountTotal();
  var contributors = 0u;
  var magnitude = 0.0;
  for (var z = lo.z; z <= hi.z; z++) {
    for (var y = lo.y; y <= hi.y; y++) {
      for (var x = lo.x; x <= hi.x; x++) {
        let ci = cellIndex(vec3u(u32(x), u32(y), u32(z)));
        contributors += atomicLoad(&counts[nC + ci]);
        magnitude = max(magnitude, bitcast<f32>(atomicLoad(&counts[(2u + axis) * nC + ci])));
      }
    }
  }
  // Extrapolation scratch is unused until after normalization; no additional
  // per-face allocation is needed. All transfer dispatches share these scales.
  faces[2u * nF + fi] = transferScale(VS, f32(contributors), magnitude);
  faces[3u * nF + fi] = transferScale(WS, f32(contributors), 1.0);
}
`;
