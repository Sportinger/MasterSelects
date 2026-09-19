import {
  FLOCK_PARTICLE_STRIDE,
  P_AGE,
  P_EMITTER,
  P_FWD,
  P_GROUP,
  P_RND,
  type FlockProgram,
} from '../../../services/flock/compiler/flockProgramTypes';
import { IDENTITY_SALT } from './flockCodes';
import { mixKey, rand01 } from './flockMath';

/** Unborn particles with stable identity attributes (group, identity random, emitter). */
export function buildInitialFlockState(program: Pick<FlockProgram, 'capacity' | 'emitters'>, target?: Float32Array): Float32Array {
  const state = target ?? new Float32Array(program.capacity * FLOCK_PARTICLE_STRIDE);
  for (const emitter of program.emitters) {
    const seed = emitter.params.integers.seed ?? 1;
    const group = emitter.params.integers.group ?? 0;
    for (let local = 0; local < emitter.count; local += 1) {
      const index = emitter.offset + local;
      const base = index * FLOCK_PARTICLE_STRIDE;
      state.fill(0, base, base + FLOCK_PARTICLE_STRIDE);
      state[base + P_AGE] = -1;
      state[base + P_FWD + 2] = 1;
      state[base + P_GROUP] = group;
      state[base + P_RND] = rand01(index, mixKey(seed, 0, IDENTITY_SALT));
      state[base + P_EMITTER] = emitter.index;
    }
  }
  return state;
}
