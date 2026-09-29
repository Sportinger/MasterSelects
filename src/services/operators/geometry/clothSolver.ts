import { periodicWindModulation, windForce } from '../wind';
import type { ClothSpec } from './clothProgram';

/** Fixed simulation steps per second of source time; substeps subdivide each step. */
export const CLOTH_STEP_RATE = 60;
/** Exact states are kept every half second, so scrubbing resumes from the nearest one. */
const CHECKPOINT_INTERVAL = 30;
const CHECKPOINT_LIMIT = 120;
/**
 * Air drag of a light fabric (per second): the sheet's motion across its normal relaxes toward the
 * air speed within about a quarter second, so wind moves it smoothly instead of plucking a spring.
 */
const AIR_DRAG = 4;
/** Simulation never runs past ten minutes of source time; later frames hold that state. */
export const CLOTH_STEP_LIMIT = CLOTH_STEP_RATE * 600;

/**
 * Stiffness 0..1 to XPBD compliance: stretch spans 1e-2 (rubber) to 1e-8 (nearly inextensible),
 * bend spans 1 (limp) to 1e-5 (card).
 */
const stretchCompliance = (stiffness: number) => 10 ** (-2 - 6 * stiffness);
const bendCompliance = (stiffness: number) => 10 ** (-5 * stiffness);

/** Compression compliance multiplier for stretch and shear links: woven fabric buckles instead of pushing back. */
const COMPRESSION_SOFTNESS = 1e4;
interface Constraints { a: Uint32Array; b: Uint32Array; rest: Float64Array; compliance: Float64Array; stretch: Uint8Array }

/**
 * XPBD cloth on a regular grid (Macklin et al. 2016, small steps 2019): one Gauss-Seidel pass per
 * substep in a fixed order, double precision, no randomness. The same spec and step always give
 * the same state, whether reached by playback or from a checkpoint.
 */
export class ClothSimulation {
  readonly columns: number;
  readonly rows: number;
  private readonly positions: Float64Array;
  private readonly velocities: Float64Array;
  private readonly predicted: Float64Array;
  private readonly normals: Float64Array;
  private readonly air: Float64Array;
  private readonly inverseMass: Float64Array;
  private readonly constraints: Constraints;
  private readonly checkpoints = new Map<number, Float64Array>();
  private interval = CHECKPOINT_INTERVAL;
  private step = 0;
  private readonly spec: ClothSpec;

  constructor(spec: ClothSpec) {
    this.spec = spec;
    this.columns = spec.columns; this.rows = spec.rows;
    const count = (spec.columns + 1) * (spec.rows + 1);
    this.positions = new Float64Array(count * 3);
    this.velocities = new Float64Array(count * 3);
    this.predicted = new Float64Array(count * 3);
    this.normals = new Float64Array(count * 3);
    this.air = new Float64Array(count * 3);
    this.inverseMass = new Float64Array(count).fill(1);
    for (let j = 0; j <= spec.rows; j++) {
      for (let i = 0; i <= spec.columns; i++) {
        const index = this.index(i, j);
        this.positions[index * 3] = (i / spec.columns - 0.5) * spec.width;
        this.positions[index * 3 + 1] = (j / spec.rows - 0.5) * spec.height;
        const top = j === spec.rows, corner = (i === 0 || i === spec.columns) && (top || j === 0);
        const pinned = [false, top, i === 0, top && (i === 0 || i === spec.columns), corner][spec.pin];
        if (pinned) this.inverseMass[index] = 0;
      }
    }
    this.constraints = this.buildConstraints();
    this.checkpoints.set(0, this.snapshot());
  }

  private index(i: number, j: number) { return j * (this.columns + 1) + i; }

  /** Structural, shear and bend links in a fixed order; rest lengths from the flat sheet. */
  private buildConstraints(): Constraints {
    const pairs: Array<[number, number, number, number]> = [];
    const stretch = stretchCompliance(this.spec.stretch), bend = bendCompliance(this.spec.bend);
    const link = (i0: number, j0: number, i1: number, j1: number, compliance: number) => {
      if (i1 <= this.columns && j1 <= this.rows && i1 >= 0) pairs.push([this.index(i0, j0), this.index(i1, j1), compliance, compliance === stretch ? 1 : 0]);
    };
    for (let j = 0; j <= this.rows; j++) {
      for (let i = 0; i <= this.columns; i++) {
        link(i, j, i + 1, j, stretch); link(i, j, i, j + 1, stretch);
        link(i, j, i + 1, j + 1, stretch); link(i, j, i - 1, j + 1, stretch);
        link(i, j, i + 2, j, bend); link(i, j, i, j + 2, bend);
      }
    }
    const constraints: Constraints = { a: new Uint32Array(pairs.length), b: new Uint32Array(pairs.length),
      rest: new Float64Array(pairs.length), compliance: new Float64Array(pairs.length), stretch: new Uint8Array(pairs.length) };
    pairs.forEach(([a, b, compliance, stretch], index) => {
      constraints.a[index] = a; constraints.b[index] = b; constraints.compliance[index] = compliance; constraints.stretch[index] = stretch;
      constraints.rest[index] = Math.hypot(this.positions[b * 3] - this.positions[a * 3], this.positions[b * 3 + 1] - this.positions[a * 3 + 1]);
    });
    return constraints;
  }

  private snapshot(): Float64Array {
    const state = new Float64Array(this.positions.length * 2);
    state.set(this.positions); state.set(this.velocities, this.positions.length);
    return state;
  }

  private restore(state: Float64Array) {
    this.positions.set(state.subarray(0, this.positions.length));
    this.velocities.set(state.subarray(this.positions.length));
  }

  /** Grid positions after `target` steps: advances, or resumes from the latest checkpoint before it. */
  positionsAt(target: number): Float64Array {
    target = Math.max(0, Math.min(CLOTH_STEP_LIMIT, Math.floor(target)));
    let best = 0;
    for (const step of this.checkpoints.keys()) if (step <= target && step > best) best = step;
    if (target < this.step || best > this.step) {
      this.restore(this.checkpoints.get(best)!);
      this.step = best;
    }
    while (this.step < target) {
      this.advance();
      this.step++;
      if (this.step % this.interval === 0 && !this.checkpoints.has(this.step)) this.remember();
    }
    return this.positions;
  }

  /** Bounded memory: when full, keep every other checkpoint and double the spacing. */
  private remember() {
    if (this.checkpoints.size >= CHECKPOINT_LIMIT) {
      this.interval *= 2;
      for (const step of [...this.checkpoints.keys()]) if (step % this.interval !== 0) this.checkpoints.delete(step);
      if (this.step % this.interval !== 0) return;
    }
    this.checkpoints.set(this.step, this.snapshot());
  }

  private advance() {
    const { spec, positions, velocities, predicted, inverseMass, air, normals } = this;
    const time = this.step / CLOTH_STEP_RATE - spec.preroll;
    this.updateNormals();
    this.updateAir(time);
    const dt = 1 / (CLOTH_STEP_RATE * spec.substeps), damping = Math.exp(-(spec.damping + spec.drag) * dt);
    const pull = 1 - Math.exp(-AIR_DRAG * dt);
    const count = inverseMass.length, { a, b, rest, compliance, stretch } = this.constraints;
    for (let substep = 0; substep < spec.substeps; substep++) {
      for (let vertex = 0; vertex < count; vertex++) {
        const base = vertex * 3;
        if (inverseMass[vertex] === 0) { predicted[base] = positions[base]; predicted[base + 1] = positions[base + 1]; predicted[base + 2] = positions[base + 2]; continue; }
        // Air drag across the sheet: its normal speed relaxes toward the air speed (drag and lift of a thin sheet).
        const nx = normals[base], ny = normals[base + 1], nz = normals[base + 2];
        const across = ((air[base] - velocities[base]) * nx + (air[base + 1] - velocities[base + 1]) * ny + (air[base + 2] - velocities[base + 2]) * nz) * pull;
        velocities[base] = (velocities[base] + across * nx) * damping;
        velocities[base + 1] = (velocities[base + 1] + across * ny - spec.gravity * dt) * damping;
        velocities[base + 2] = (velocities[base + 2] + across * nz) * damping;
        predicted[base] = positions[base] + velocities[base] * dt;
        predicted[base + 1] = positions[base + 1] + velocities[base + 1] * dt;
        predicted[base + 2] = positions[base + 2] + velocities[base + 2] * dt;
      }
      const inverseDt2 = 1 / (dt * dt);
      for (let c = 0; c < a.length; c++) {
        const i = a[c], j = b[c], wi = inverseMass[i], wj = inverseMass[j], w = wi + wj;
        if (w === 0) continue;
        const dx = predicted[j * 3] - predicted[i * 3], dy = predicted[j * 3 + 1] - predicted[i * 3 + 1], dz = predicted[j * 3 + 2] - predicted[i * 3 + 2];
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length < 1e-12) continue;
        const error = length - rest[c], softness = error < 0 && stretch[c] ? COMPRESSION_SOFTNESS : 1;
        const scale = error / (w + compliance[c] * softness * inverseDt2) / length;
        predicted[i * 3] += wi * scale * dx; predicted[i * 3 + 1] += wi * scale * dy; predicted[i * 3 + 2] += wi * scale * dz;
        predicted[j * 3] -= wj * scale * dx; predicted[j * 3 + 1] -= wj * scale * dy; predicted[j * 3 + 2] -= wj * scale * dz;
      }
      for (let index = 0; index < positions.length; index++) {
        velocities[index] = (predicted[index] - positions[index]) / dt;
        positions[index] = predicted[index];
      }
    }
  }

  /** Air velocity per vertex for one step: gusting winds plus animated turbulence at the vertex. */
  private updateAir(time: number) {
    const { spec, positions, air } = this, wind = [0, 0, 0];
    const modulation = periodicWindModulation(time);
    for (const item of spec.winds) windForce(item.direction, item.strength, item.gust, modulation).forEach((value, axis) => { wind[axis] += value; });
    for (let base = 0; base < air.length; base += 3) {
      let ax = wind[0], ay = wind[1], az = wind[2];
      for (const field of spec.turbulence) {
        const f = field.frequency, s = field.strength, x = positions[base], y = positions[base + 1], z = positions[base + 2];
        ax += s * Math.sin(f * y + 1.3 * time); ay += s * Math.sin(f * z + 1.7 * time + 1); az += s * Math.sin(f * x + 1.1 * time + 2);
      }
      air[base] = ax; air[base + 1] = ay; air[base + 2] = az;
    }
  }

  /** Vertex normals from central differences of the grid, oriented like the rest plane (+Z). */
  private updateNormals() {
    const { positions, normals, columns, rows } = this;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) {
        const left = this.index(Math.max(0, i - 1), j), right = this.index(Math.min(columns, i + 1), j);
        const down = this.index(i, Math.max(0, j - 1)), up = this.index(i, Math.min(rows, j + 1));
        const ux = positions[right * 3] - positions[left * 3], uy = positions[right * 3 + 1] - positions[left * 3 + 1], uz = positions[right * 3 + 2] - positions[left * 3 + 2];
        const vx = positions[up * 3] - positions[down * 3], vy = positions[up * 3 + 1] - positions[down * 3 + 1], vz = positions[up * 3 + 2] - positions[down * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz) || 1;
        const base = this.index(i, j) * 3;
        normals[base] = nx / length; normals[base + 1] = ny / length; normals[base + 2] = nz / length;
      }
    }
  }
}
