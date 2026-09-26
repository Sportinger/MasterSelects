import {
  FLOCK_PARTICLE_STRIDE,
  P_AGE,
  P_POS,
  P_VEL,
  type FlockFluidSpec,
} from '../../../services/flock/compiler/flockProgramTypes';

/**
 * CPU reference of the FLIP substep in shaders/flockFluidWgsl.ts: the same
 * MAC layout, transfer weights, Jacobi pressure solve, projection and PIC/FLIP
 * blend, in float64 and index order (the GPU uses fixed-point atomics, so
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
  private readonly previous: Float64Array;
  private readonly valid: Uint8Array;
  private readonly counts: Uint32Array;
  private readonly divergence: Float64Array;
  private pressure: Float64Array;
  private pressureNext: Float64Array;

  constructor(spec: FlockFluidSpec) {
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
    this.previous = new Float64Array(this.faceTotal);
    this.valid = new Uint8Array(this.faceTotal);
    this.counts = new Uint32Array(this.cellTotal);
    this.divergence = new Float64Array(this.cellTotal);
    this.pressure = new Float64Array(this.cellTotal);
    this.pressureNext = new Float64Array(this.cellTotal);
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
  private forEachCorner(pos: ArrayLike<number>, axis: number, visit: (face: number, weight: number) => void): void {
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
      const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
      if (w <= 0) continue;
      visit(this.faceIndex(axis, cx, cy, cz), w);
    }
  }

  step(state: Float32Array, capacity: number, flipRatio: number, dt: number): void {
    const h = this.spec.cellSize;
    const o = this.spec.origin;
    this.sum.fill(0);
    this.weight.fill(0);
    this.counts.fill(0);
    this.pressure.fill(0);
    this.pressureNext.fill(0);

    // Particle -> grid.
    for (let index = 0; index < capacity; index += 1) {
      const base = index * FLOCK_PARTICLE_STRIDE;
      if (state[base + P_AGE] < 0) continue;
      const pos = [state[base + P_POS], state[base + P_POS + 1], state[base + P_POS + 2]];
      const cx = Math.floor((pos[0] - o[0]) / h); const cy = Math.floor((pos[1] - o[1]) / h); const cz = Math.floor((pos[2] - o[2]) / h);
      if (this.inCells(cx, cy, cz)) this.counts[this.cellIndex(cx, cy, cz)] += 1;
      for (let axis = 0; axis < 3; axis += 1) {
        const v = state[base + P_VEL + axis];
        this.forEachCorner(pos, axis, (face, w) => {
          this.sum[face] += v * w;
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
            this.previous[f] = value;
            this.valid[f] = valid;
          }
        }
      }
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

    // Jacobi pressure iterations (pairs, like the GPU ping-pong).
    const neighbors = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
    const iterations = Math.ceil(this.spec.iterations / 2) * 2;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (let z = 0; z < this.nz; z += 1) {
        for (let y = 0; y < this.ny; y += 1) {
          for (let x = 0; x < this.nx; x += 1) {
            const c = this.cellIndex(x, y, z);
            if (this.counts[c] === 0) { this.pressureNext[c] = 0; continue; }
            let sum = 0;
            let n = 0;
            for (const [ox, oy, oz] of neighbors) {
              const nx = x + ox; const ny = y + oy; const nz = z + oz;
              if (!this.inCells(nx, ny, nz)) continue;
              n += 1;
              const ni = this.cellIndex(nx, ny, nz);
              if (this.counts[ni] > 0) sum += this.pressure[ni];
            }
            this.pressureNext[c] = (sum - this.divergence[c]) / Math.max(n, 1);
          }
        }
      }
      [this.pressure, this.pressureNext] = [this.pressureNext, this.pressure];
    }

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
        let previous = 0;
        let weight = 0;
        this.forEachCorner(pos, axis, (face, w) => {
          if (!this.valid[face]) return;
          value += this.velocity[face] * w;
          previous += this.previous[face] * w;
          weight += w;
        });
        const vStar = state[base + P_VEL + axis];
        let v = vStar;
        if (weight > 1e-6) {
          const pic = value / weight;
          const flip = vStar + (value - previous) / weight;
          v = pic + (flip - pic) * flipRatio;
        }
        let p = pos[axis] + (v - vStar) * dt;
        if (p < lo[axis]) { p = lo[axis]; v = Math.max(v, 0); }
        if (p > hi[axis]) { p = hi[axis]; v = Math.min(v, 0); }
        state[base + P_POS + axis] = p;
        state[base + P_VEL + axis] = v;
      }
    }
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
