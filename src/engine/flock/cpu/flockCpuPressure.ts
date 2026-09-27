import type { FlockVec3 } from '../../../types/flock';
import {
  flockPressureLevels, FLOCK_PRESSURE_ABSOLUTE_TOLERANCE, FLOCK_PRESSURE_RELATIVE_TOLERANCE,
  FLOCK_PRESSURE_COARSE_SWEEPS, type FlockPressureLevel,
} from '../shared/flockPressureLayout';

interface Level extends FlockPressureLevel {
  /** Diagonal followed by the three positive-direction edge weights. */
  matrix: Float64Array;
  rhs: Float64Array;
  x: Float64Array;
  temporary: Float64Array;
}

/**
 * Deterministic MGPCG reference. Piecewise-constant prolongation P and restriction
 * P^T give the Galerkin coarse operator P^T A P. Thus thin/disconnected fluid and
 * solid-wall/air boundaries retain a symmetric positive (semi)definite operator.
 * Two damped-Jacobi sweeps before AND after correction make the V-cycle symmetric.
 */
export class FlockCpuPressure {
  private readonly levels: Level[];
  private readonly residual: Float64Array;
  private readonly direction: Float64Array;
  private readonly product: Float64Array;
  iterations = 0;
  relativeResidual = 0;

  constructor(dims: FlockVec3) {
    this.levels = flockPressureLevels(dims).map(level => ({ ...level,
      matrix: new Float64Array(level.count * 4), rhs: new Float64Array(level.count),
      x: new Float64Array(level.count), temporary: new Float64Array(level.count),
    }));
    const count = this.levels[0].count;
    this.residual = new Float64Array(count); this.direction = new Float64Array(count); this.product = new Float64Array(count);
  }

  private neighbors(level: Level, i: number, visit: (neighbor: number, axis: number, positive: boolean) => void): void {
    const [nx, ny, nz] = level.dims, x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    if (x > 0) visit(i - 1, 0, false); if (x + 1 < nx) visit(i + 1, 0, true);
    if (y > 0) visit(i - nx, 1, false); if (y + 1 < ny) visit(i + nx, 1, true);
    if (z > 0) visit(i - nx * ny, 2, false); if (z + 1 < nz) visit(i + nx * ny, 2, true);
  }

  private parent(fine: Level, coarse: Level, i: number): number {
    const [nx, ny] = fine.dims;
    return Math.floor((i % nx) / 2) + coarse.dims[0] * (Math.floor((Math.floor(i / nx) % ny) / 2)
      + coarse.dims[1] * Math.floor(Math.floor(i / (nx * ny)) / 2));
  }

  private build(counts: Uint32Array): void {
    const fine = this.levels[0]; fine.matrix.fill(0);
    for (let i = 0; i < fine.count; i++) {
      if (!counts[i]) continue;
      this.neighbors(fine, i, (j, axis, positive) => {
        fine.matrix[i * 4]++; // In-domain air contributes a zero-pressure boundary.
        if (positive && counts[j]) fine.matrix[i * 4 + axis + 1] = 1;
      });
    }
    for (let l = 1; l < this.levels.length; l++) {
      const child = this.levels[l - 1], coarse = this.levels[l]; coarse.matrix.fill(0);
      for (let i = 0; i < child.count; i++) {
        const p = this.parent(child, coarse, i);
        coarse.matrix[p * 4] += child.matrix[i * 4];
        this.neighbors(child, i, (j, axis, positive) => {
          if (!positive) return;
          const edge = child.matrix[i * 4 + axis + 1];
          if (p === this.parent(child, coarse, j)) coarse.matrix[p * 4] -= 2 * edge;
          else coarse.matrix[p * 4 + axis + 1] += edge;
        });
      }
    }
  }

  private apply(level: Level, values: Float64Array, i: number): number {
    let sum = level.matrix[i * 4] * values[i];
    this.neighbors(level, i, (j, axis, positive) => {
      sum -= level.matrix[(positive ? i : j) * 4 + axis + 1] * values[j];
    });
    return sum;
  }

  private smooth(level: Level, sweeps: number): void {
    for (let sweep = 0; sweep < sweeps; sweep++) {
      for (let i = 0; i < level.count; i++) {
        const diagonal = level.matrix[i * 4];
        level.temporary[i] = diagonal > 0 ? level.x[i] + (2 / 3) * (level.rhs[i] - this.apply(level, level.x, i)) / diagonal : 0;
      }
      [level.x, level.temporary] = [level.temporary, level.x];
    }
  }

  private cycle(l: number): void {
    const fine = this.levels[l]; fine.x.fill(0);
    if (l + 1 === this.levels.length) { this.smooth(fine, FLOCK_PRESSURE_COARSE_SWEEPS); return; }
    this.smooth(fine, 2);
    const coarse = this.levels[l + 1]; coarse.rhs.fill(0);
    for (let i = 0; i < fine.count; i++) coarse.rhs[this.parent(fine, coarse, i)] += fine.rhs[i] - this.apply(fine, fine.x, i);
    this.cycle(l + 1);
    for (let i = 0; i < fine.count; i++) if (fine.matrix[i * 4] > 0) fine.x[i] += coarse.x[this.parent(fine, coarse, i)];
    this.smooth(fine, 2);
  }

  /** Solves A p = -divergence. Output pressure starts at zero every substep. */
  solve(counts: Uint32Array, divergence: Float64Array, pressure: Float64Array, maxIterations: number): void {
    this.build(counts); pressure.fill(0); this.direction.fill(0);
    let initial = 0;
    for (let i = 0; i < pressure.length; i++) {
      const r = counts[i] ? -divergence[i] : 0; this.residual[i] = r; initial += r * r;
    }
    const threshold = Math.max(initial * FLOCK_PRESSURE_RELATIVE_TOLERANCE ** 2, FLOCK_PRESSURE_ABSOLUTE_TOLERANCE ** 2);
    let norm = initial, rhoOld = 0; this.iterations = 0;
    const fine = this.levels[0];
    while (this.iterations < maxIterations && norm > threshold) {
      fine.rhs.set(this.residual); this.cycle(0);
      let rho = 0;
      for (let i = 0; i < pressure.length; i++) rho += this.residual[i] * fine.x[i];
      if (!(rho > 0)) break;
      const beta = rhoOld > 0 ? rho / rhoOld : 0;
      for (let i = 0; i < pressure.length; i++) this.direction[i] = fine.x[i] + beta * this.direction[i];
      let denominator = 0;
      for (let i = 0; i < pressure.length; i++) { this.product[i] = this.apply(fine, this.direction, i); denominator += this.direction[i] * this.product[i]; }
      if (!(denominator > 0)) break;
      const alpha = rho / denominator; norm = 0;
      for (let i = 0; i < pressure.length; i++) {
        pressure[i] += alpha * this.direction[i]; this.residual[i] -= alpha * this.product[i]; norm += this.residual[i] ** 2;
      }
      rhoOld = rho; this.iterations++;
    }
    this.relativeResidual = initial > 0 ? Math.sqrt(norm / initial) : 0;
  }
}
