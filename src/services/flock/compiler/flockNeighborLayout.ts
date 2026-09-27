import type { FlockProgram } from './flockProgramTypes';
import { nextPowerOfTwo } from './flockCompilerSupport';

/** Only boid rules and neighbor-link rendering consume the hashed grid. */
export function flockNeighborLayout(program: Pick<FlockProgram, 'capacity' | 'ops' | 'branches'>) {
  const required = program.ops.some(op => op.kind === 'rules')
    || program.branches.some(branch => branch.kind === 'links');
  // The shared simulation layout still needs valid storage bindings when its
  // neighbor loop is unused. Tiny buffers avoid separate shader variants.
  const sortCount = required ? nextPowerOfTwo(Math.max(2, program.capacity)) : 2;
  const tableSize = required ? nextPowerOfTwo(Math.max(4096, program.capacity * 2)) : 1;
  return { required, sortCount, tableSize, bytes: sortCount * 8 + tableSize * 16 };
}
