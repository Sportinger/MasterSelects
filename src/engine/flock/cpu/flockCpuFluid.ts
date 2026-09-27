import {
  FLOCK_PARTICLE_STRIDE,
  FLOCK_AFFINE_STRIDE,
  P_AGE,
  P_GEN,
  P_POS,
  P_VEL,
  type FlockFluidSpec,
} from '../../../services/flock/compiler/flockProgramTypes';
import { FlockCpuPressure } from './flockCpuPressure';
import { FlockCpuSeparation } from './flockCpuSeparation';
import { fluidJitter, type FlockFluidRegularization } from '../shared/flockFluidRegularization';

/**
 * CPU reference of the APIC substep in shaders/flockFluidWgsl.ts: the same
 * MAC layout, transfer weights, MGPCG pressure solve, projection and affine
 * transfer, in float64 and index order (the GPU uses fixed-point atomics, so
 * results agree closely but not bitwise).
 */
export class FlockCpuFluid {
  readonly spec: FlockFluidSpec;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly faceOffsets: [number, number, number];
  private readonly faceTotal: number;
  private readonly cellTotal: number;
  private readonly sum: Float64Array;
  private readonly weight: Float64Array;
  private readonly velocity: Float64Array;
  /** Packed velocity-gradient rows, indexed by stable particle identity. */
  readonly affine: Float32Array;
  private readonly valid: Uint8Array;
  private readonly counts: Uint32Array;
  private readonly divergence: Float64Array;
  private readonly pressure: Float64Array;
  readonly pressureSolver: FlockCpuPressure;
  private readonly separation: FlockCpuSeparation;

  constructor(spec: FlockFluidSpec, capacity: number) {
    this.spec = spec;
    [this.nx, this.ny, this.nz] = spec.dims;
    const nU = (this.nx + 1) * this.ny * this.nz;
    const nV = this.nx * (this.ny + 1) * this.nz;
    const nW = this.nx * this.ny * (this.nz + 1);
    this.faceOffsets = [0, nU, nU + nV];
    this.faceTotal = nU + nV + nW;
    this.cellTotal = this.nx * this.ny * this.nz;
    this.sum = new Float64Array(this.faceTotal);
    this.weight = new Float64Array(this.faceTotal);
    this.velocity = new Float64Array(this.faceTotal);
    this.affine = new Float32Array(capacity * FLOCK_AFFINE_STRIDE);
    this.valid = new Uint8Array(this.faceTotal);
    this.counts = new Uint32Array(this.cellTotal);
    this.divergence = new Float64Array(this.cellTotal);
    this.pressure = new Float64Array(this.cellTotal);
    this.pressureSolver = new FlockCpuPressure(spec.dims);
    this.separation = new FlockCpuSeparation(spec, capacity);
  }

  private faceDims(axis: number): [number, number, number] {
    return [this.nx + (axis === 0 ? 1 : 0), this.ny + (axis === 1 ? 1 : 0), this.nz + (axis === 2 ? 1 : 0)];
  }

  private faceIndex(axis: number, x: number, y: number, z: number): number {
    const [dx, dy] = this.faceDims(axis);
    return this.faceOffsets[axis] + x + dx * (y + dy * z);
  }

  private cellIndex(x: number, y: number, z: number): number {
    return x + this.nx * (y + this.ny * z);
  }

  private inCells(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  private isFluid(x: number, y: number, z: number): boolean {
    return this.inCells(x, y, z) && this.counts[this.cellIndex(x, y, z)] > 0;
  }

  /** Visits the valid trilinear face corners of one velocity component at `pos`. */
  private forEachCorner(pos: ArrayLike<number>, axis: number, visit: (face: number, weight: number, dx: number, dy: number, dz: number, gx: number, gy: number, gz: number) => void): void {
    const h = this.spec.cellSize;
    const o = this.spec.origin;
    const s = [(pos[0] - o[0]) / h - 0.5, (pos[1] - o[1]) / h - 0.5, (pos[2] - o[2]) / h - 0.5];
    s[axis] += 0.5;
    const bx = Math.floor(s[0]); const by = Math.floor(s[1]); const bz = Math.floor(s[2]);
    const fx = s[0] - bx; const fy = s[1] - by; const fz = s[2] - bz;
    const [dx, dy, dz] = this.faceDims(axis);
    for (let corner = 0; corner < 8; corner += 1) {
      const ox = corner & 1; const oy = (corner >> 1) & 1; const oz = (corner >> 2) & 1;
      const cx = bx + ox; const cy = by + oy; const cz = bz + oz;
      if (cx < 0 || cy < 0 || cz < 0 || cx >= dx || cy >= dy || cz >= dz) continue;
      const wx = ox ? fx : 1 - fx, wy = oy ? fy : 1 - fy, wz = oz ? fz : 1 - fz;
      // Zero-weight corners still contribute derivatives on exact grid facets.
      visit(this.faceIndex(axis, cx, cy, cz), wx * wy * wz,
        (ox - fx) * h, (oy - fy) * h, (oz - fz) * h,
        (ox ? 1 : -1) * wy * wz / h, (oy ? 1 : -1) * wx * wz / h, (oz ? 1 : -1) * wx * wy / h);
    }
  }

  step(state: Float32Array, capacity: number, affineStrength: number, dt: number, regularization?: FlockFluidRegularization): void {
    const h = this.spec.cellSize;
    const o = this.spec.origin;
    this.sum.fill(0);
    this.weight.fill(0);
    this.counts.fill(0);
    this.pressure.fill(0);

    // Particle -> grid.
    for (let index = 0; index < capacity; index += 1) {
      const base = index * FLOCK_PARTICLE_STRIDE;
      if (state[base + P_AGE] < 0) continue;
      const pos = [state[base + P_POS], state[base + P_POS + 1], state[base + P_POS + 2]];
      const cx = Math.floor((pos[0] - o[0]) / h); const cy = Math.floor((pos[1] - o[1]) / h); const cz = Math.floor((pos[2] - o[2]) / h);
      if (this.inCells(cx, cy, cz)) this.counts[this.cellIndex(cx, cy, cz)] += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        const v = state[base + P_VEL + axis];
        const row = index * FLOCK_AFFINE_STRIDE + axis * 3;
        // A respawn is a new particle, even though it reuses the same identity.
        const strength = state[base + P_AGE] > 0 ? affineStrength : 0;
        this.forEachCorner(pos, axis, (face, w, dx, dy, dz) => {
          const local = v + strength * (this.affine[row] * dx + this.affine[row + 1] * dy + this.affine[row + 2] * dz);
          this.sum[face] += local * w;
          this.weight[face] += w;
        });
      }
    }

    // Normalize; domain walls are solid (zero normal velocity).
    for (let axis = 0; axis < 3; axis += 1) {
      const [dx, dy, dz] = this.faceDims(axis);
      const wallMax = axis === 0 ? this.nx : axis === 1 ? this.ny : this.nz;
      for (let z = 0; z < dz; z += 1) {
        for (let y = 0; y < dy; y += 1) {
          for (let x = 0; x < dx; x += 1) {
            const f = this.faceIndex(axis, x, y, z);
            const coord = axis === 0 ? x : axis === 1 ? y : z;
            let value = 0;
            let valid = 0;
            if (coord === 0 || coord === wallMax) {
              valid = 1;
            } else if (this.weight[f] > 1e-6) {
              value = this.sum[f] / this.weight[f];
              valid = 1;
            }
            this.velocity[f] = value;
            this.valid[f] = valid;
          }
        }
      }
    }

    // Complete the interpolation stencil, including derivative-only corners
    // on exact grid facets. P2G sums/weights are now free to serve as scratch.
    for (let layer = 0; layer < 2; layer++) {
      this.sum.set(this.velocity); this.weight.set(this.valid);
      for (let axis = 0; axis < 3; axis++) {
        const dims = this.faceDims(axis);
        for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
          const face = this.faceIndex(axis, x, y, z);
          if (this.valid[face]) continue;
          let sum = 0, samples = 0;
          for (let direction = 0; direction < 3; direction++) for (const side of [-1, 1]) {
            const neighbor = [x, y, z]; neighbor[direction] += side;
            if (neighbor[direction] < 0 || neighbor[direction] >= dims[direction]) continue;
            const other = this.faceIndex(axis, neighbor[0], neighbor[1], neighbor[2]);
            if (this.valid[other]) { sum += this.velocity[other]; samples++; }
          }
          if (samples > 0) { this.sum[face] = sum / samples; this.weight[face] = 1; }
        }
      }
      this.velocity.set(this.sum); this.valid.set(this.weight);
    }

    // Divergence of fluid cells.
    for (let z = 0; z < this.nz; z += 1) {
      for (let y = 0; y < this.ny; y += 1) {
        for (let x = 0; x < this.nx; x += 1) {
          const c = this.cellIndex(x, y, z);
          this.divergence[c] = this.counts[c] === 0 ? 0
            : this.velocity[this.faceIndex(0, x + 1, y, z)] - this.velocity[this.faceIndex(0, x, y, z)]
            + this.velocity[this.faceIndex(1, x, y + 1, z)] - this.velocity[this.faceIndex(1, x, y, z)]
            + this.velocity[this.faceIndex(2, x, y, z + 1)] - this.velocity[this.faceIndex(2, x, y, z)];
        }
      }
    }

    this.pressureSolver.solve(this.counts, this.divergence, this.pressure, this.spec.iterations);

    // Project interior faces next to fluid.
    for (let axis = 0; axis < 3; axis += 1) {
      const [dx, dy, dz] = this.faceDims(axis);
      const wallMax = axis === 0 ? this.nx : axis === 1 ? this.ny : this.nz;
      for (let z = 0; z < dz; z += 1) {
        for (let y = 0; y < dy; y += 1) {
          for (let x = 0; x < dx; x += 1) {
            const coord = axis === 0 ? x : axis === 1 ? y : z;
            if (coord === 0 || coord === wallMax) continue;
            const lx = x - (axis === 0 ? 1 : 0); const ly = y - (axis === 1 ? 1 : 0); const lz = z - (axis === 2 ? 1 : 0);
            const fluidLo = this.isFluid(lx, ly, lz);
            const fluidHi = this.isFluid(x, y, z);
            if (!fluidLo && !fluidHi) continue;
            const pLo = fluidLo ? this.pressure[this.cellIndex(lx, ly, lz)] : 0;
            const pHi = fluidHi ? this.pressure[this.cellIndex(x, y, z)] : 0;
            const f = this.faceIndex(axis, x, y, z);
            this.velocity[f] -= pHi - pLo;
            this.valid[f] = 1;
          }
        }
      }
    }

    // Grid -> particle, position correction, solid domain walls.
    const lo = [o[0] + h * 0.01, o[1] + h * 0.01, o[2] + h * 0.01];
    const hi = [o[0] + this.nx * h - h * 0.01, o[1] + this.ny * h - h * 0.01, o[2] + this.nz * h - h * 0.01];
    for (let index = 0; index < capacity; index += 1) {
      const base = index * FLOCK_PARTICLE_STRIDE;
      if (state[base + P_AGE] < 0) continue;
      const pos = [state[base + P_POS], state[base + P_POS + 1], state[base + P_POS + 2]];
      for (let axis = 0; axis < 3; axis += 1) {
        let value = 0;
        let weight = 0;
        let gx = 0, gy = 0, gz = 0, wx = 0, wy = 0, wz = 0;
        this.forEachCorner(pos, axis, (face, w, _dx, _dy, _dz, dx, dy, dz) => {
          if (!this.valid[face]) return;
          const velocity = this.velocity[face];
          value += velocity * w;
          gx += velocity * dx; gy += velocity * dy; gz += velocity * dz;
          wx += dx; wy += dy; wz += dz;
          weight += w;
        });
        const vStar = state[base + P_VEL + axis];
        let v = vStar;
        const row = index * FLOCK_AFFINE_STRIDE + axis * 3;
        this.affine.fill(0, row, row + 3);
        if (weight > 1e-6) {
          v = value / weight;
          // Derivative of normalized interpolation. In a full stencil sum(dw)
          // is zero; at a truncated wall this preserves a constant velocity.
          this.affine[row] = (gx - v * wx) / weight;
          this.affine[row + 1] = (gy - v * wy) / weight;
          this.affine[row + 2] = (gz - v * wz) / weight;
        }
        let p = pos[axis] + (v - vStar) * dt;
        if (regularization) p += fluidJitter(index, state[base + P_GEN], regularization.step, axis)
          * h * regularization.jitter * Math.sqrt(Math.max(0, dt * 60));
        if (p < lo[axis]) { p = lo[axis]; v = Math.max(v, 0); this.affine.fill(0, row, row + 3); }
        if (p > hi[axis]) { p = hi[axis]; v = Math.min(v, 0); this.affine.fill(0, row, row + 3); }
        state[base + P_POS + axis] = p;
        state[base + P_VEL + axis] = v;
      }
    }
    if (regularization) this.separation.step(state, capacity,
      regularization.separationStrength, regularization.separationDistance, dt);
  }

  /** Largest absolute divergence over fluid cells after the last projection (diagnostics and tests). */
  maxDivergence(): number {
    let max = 0;
    for (let z = 0; z < this.nz; z += 1) {
      for (let y = 0; y < this.ny; y += 1) {
        for (let x = 0; x < this.nx; x += 1) {
          if (this.counts[this.cellIndex(x, y, z)] === 0) continue;
          const div = this.velocity[this.faceIndex(0, x + 1, y, z)] - this.velocity[this.faceIndex(0, x, y, z)]
            + this.velocity[this.faceIndex(1, x, y + 1, z)] - this.velocity[this.faceIndex(1, x, y, z)]
            + this.velocity[this.faceIndex(2, x, y, z + 1)] - this.velocity[this.faceIndex(2, x, y, z)];
          max = Math.max(max, Math.abs(div));
        }
      }
    }
    return max;
  }
}
