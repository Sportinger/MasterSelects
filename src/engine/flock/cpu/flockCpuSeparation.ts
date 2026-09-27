import { FLOCK_PARTICLE_STRIDE, P_AGE, type FlockFluidSpec } from '../../../services/flock/compiler/flockProgramTypes';
import { hashU32 } from '../shared/flockMath';
import { fluidPairDirection } from '../shared/flockFluidRegularization';

/** Stable cell lists and Jacobi position corrections, matching the GPU pass. */
export class FlockCpuSeparation {
  private readonly spec: FlockFluidSpec;
  private readonly starts: Uint32Array;
  private readonly ends: Uint32Array;
  private readonly cursors: Uint32Array;
  private readonly keys: Uint32Array;
  private readonly identities: Uint32Array;
  private readonly corrections: Float32Array;

  constructor(spec: FlockFluidSpec, capacity: number) {
    this.spec = spec;
    const cells = spec.dims[0] * spec.dims[1] * spec.dims[2];
    this.starts = new Uint32Array(cells);
    this.ends = new Uint32Array(cells);
    this.cursors = new Uint32Array(cells);
    this.keys = new Uint32Array(capacity);
    this.identities = new Uint32Array(capacity);
    this.corrections = new Float32Array(capacity * 3);
  }

  step(state: Float32Array, capacity: number, strength: number, distance: number, dt: number): void {
    const { origin, dims, cellSize: h } = this.spec;
    const radius = Math.min(0.5, Math.max(0, distance)) * h;
    const relaxation = Math.min(0.5, Math.max(0, strength * dt * 60));
    if (radius <= 0 || relaxation <= 0) return;
    const cellCount = this.starts.length;
    this.ends.fill(0);
    this.keys.fill(cellCount);
    this.corrections.fill(0);
    for (let id = 0; id < capacity; id++) {
      const base = id * FLOCK_PARTICLE_STRIDE;
      if (state[base + P_AGE] < 0) continue;
      const x = Math.floor((state[base] - origin[0]) / h);
      const y = Math.floor((state[base + 1] - origin[1]) / h);
      const z = Math.floor((state[base + 2] - origin[2]) / h);
      if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) continue;
      const key = x + dims[0] * (y + dims[1] * z);
      this.keys[id] = key;
      this.ends[key]++;
    }
    let offset = 0;
    for (let cell = 0; cell < cellCount; cell++) {
      this.starts[cell] = offset;
      offset += this.ends[cell];
      this.ends[cell] = offset;
    }
    this.cursors.set(this.starts);
    for (let id = 0; id < capacity; id++) {
      const key = this.keys[id];
      if (key < cellCount) this.identities[this.cursors[key]++] = id;
    }

    // A radius <= half a cell intersects at most two cells per axis, except
    // exact boundaries where an extra cell contains only zero-force pairs.
    const cells = new Uint32Array(27);
    for (let id = 0; id < capacity; id++) {
      if (this.keys[id] === cellCount) continue;
      const base = id * FLOCK_PARTICLE_STRIDE;
      const lo = [0, 1, 2].map(axis => Math.max(0, Math.floor((state[base + axis] - origin[axis] - radius) / h)));
      const hi = [0, 1, 2].map(axis => Math.min(dims[axis] - 1, Math.floor((state[base + axis] - origin[axis] + radius) / h)));
      let cellLength = 0, candidates = 0;
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
        const cell = x + dims[0] * (y + dims[1] * z);
        cells[cellLength++] = cell;
        candidates += this.ends[cell] - this.starts[cell];
      }
      const stride = Math.max(1, Math.ceil(candidates / 64));
      const phase = hashU32(id) % stride;
      let running = 0, neighbors = 0, sx = 0, sy = 0, sz = 0;
      for (let c = 0; c < cellLength; c++) {
        const cell = cells[c], start = this.starts[cell], end = this.ends[cell];
        const first = (stride - ((running + phase) % stride)) % stride;
        running += end - start;
        for (let index = start + first; index < end; index += stride) {
          const other = this.identities[index];
          if (other === id) continue;
          const otherBase = other * FLOCK_PARTICLE_STRIDE;
          let dx = state[base] - state[otherBase];
          let dy = state[base + 1] - state[otherBase + 1];
          let dz = state[base + 2] - state[otherBase + 2];
          const length = Math.hypot(dx, dy, dz);
          if (length >= radius) continue;
          if (length <= h * 1e-7) [dx, dy, dz] = fluidPairDirection(id, other);
          else { dx /= length; dy /= length; dz /= length; }
          const weight = radius - length;
          sx += dx * weight; sy += dy * weight; sz += dz * weight;
          neighbors++;
        }
      }
      const scale = 0.5 * relaxation / Math.max(1, neighbors);
      this.corrections[id * 3] = sx * scale;
      this.corrections[id * 3 + 1] = sy * scale;
      this.corrections[id * 3 + 2] = sz * scale;
    }
    // No particle writes until every correction has read the same input state.
    for (let id = 0; id < capacity; id++) {
      if (this.keys[id] === cellCount) continue;
      for (let axis = 0; axis < 3; axis++) {
        const index = id * FLOCK_PARTICLE_STRIDE + axis;
        state[index] = Math.min(origin[axis] + (dims[axis] - 0.01) * h,
          Math.max(origin[axis] + 0.01 * h, state[index] + this.corrections[id * 3 + axis]));
      }
    }
  }
}
