import { FLOCK_PARTICLE_BYTES, FLOCK_PARTICLE_STRIDE } from '../../../services/flock/compiler/flockProgramTypes';

/** Fluid kernels only consume position, age, velocity and respawn generation. */
export type FlockParticleLayout = 'full64' | 'fluid32';
export const FLOCK_FLUID_PARTICLE_BYTES = 32;
export const FLOCK_FLUID_PARTICLE_STRIDE = 8;

export function flockParticleBytes(layout: FlockParticleLayout): number {
  return layout === 'fluid32' ? FLOCK_FLUID_PARTICLE_BYTES : FLOCK_PARTICLE_BYTES;
}

/** Extracts the fluid core. Emitter/lifetime/orientation metadata is not encoded. */
export function packFlockFluidState(full: Float32Array): Float32Array {
  if (full.length % FLOCK_PARTICLE_STRIDE !== 0) throw new Error('Invalid full particle state length');
  const count = full.length / FLOCK_PARTICLE_STRIDE;
  const result = new Float32Array(count * FLOCK_FLUID_PARTICLE_STRIDE);
  for (let i = 0; i < count; i++) {
    const source = i * FLOCK_PARTICLE_STRIDE, target = i * FLOCK_FLUID_PARTICLE_STRIDE;
    result.set(full.subarray(source, source + 7), target);
    result[target + 7] = full[source + 13];
  }
  return result;
}
