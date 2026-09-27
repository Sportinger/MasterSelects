/** Requires hashU32 from FLOCK_WGSL_MATH. Mirrors shared/flockFluidRegularization.ts. */
export const FLOCK_FLUID_REGULARIZATION_WGSL = /* wgsl */ `
fn fluidSignedNoise(key: u32) -> f32 {
  return f32(hashU32(key) >> 8u) / 8388608.0 - 1.0;
}
fn fluidJitter(identity: u32, generation: u32, step: u32) -> vec3f {
  let key = identity ^ hashU32(generation) ^ hashU32(step);
  return vec3f(fluidSignedNoise(key ^ 0x9e3779b9u),
    fluidSignedNoise(key ^ 0x3c6ef372u), fluidSignedNoise(key ^ 0xdaa66d2bu));
}
fn fluidPairDirection(identity: u32, other: u32) -> vec3f {
  let key = min(identity, other) ^ hashU32(max(identity, other));
  let direction = vec3f(fluidSignedNoise(key ^ 0x9e3779b9u),
    fluidSignedNoise(key ^ 0x3c6ef372u), fluidSignedNoise(key ^ 0xdaa66d2bu));
  return direction * select(-1.0, 1.0, identity < other) / max(length(direction), 1e-12);
}
`;
