import type { RodSpec } from './rodProgram';
import type { RodRest } from './rodRest';
import { RodContacts } from './rodContacts';
import { buildRodTopology, type RodTopology } from './rodTopology';
import { airVelocity, windVelocity } from './simulationForces';

/** Fixed simulation steps per second of source time; substeps subdivide each step. */
export const ROD_STEP_RATE = 60;
const CHECKPOINT_INTERVAL = 30;
const CHECKPOINT_LIMIT = 120;
/** Simulation never runs past ten minutes of source time; later frames hold that state. */
export const ROD_STEP_LIMIT = ROD_STEP_RATE * 600;
/** Air drag of a thin rod (per second), across its axis only. */
export const ROD_AIR_DRAG = 1;
/** No node travels more than this share of the radius per substep, so rods cannot pass through each other. */
export const ROD_MAX_TRAVEL = 0.5;

/**
 * Stiffness 0..1 to material moduli for a rod of unit linear density: stretch EA from 10 (rubber
 * band) to 1e7 (nearly inextensible), bend EI from 1e-4 (limp thread) to 10 (wire).
 */
export const rodStretchModulus = (stiffness: number) => 10 ** (1 + 6 * stiffness);
export const rodBendModulus = (stiffness: number) => 10 ** (-4 + 5 * stiffness);
export const rodPullEase = (value: number) => value <= 0 ? 0 : value >= 1 ? 1 : value * value * (3 - 2 * value);
/** Inverse mass of a node: pinned nodes are kinematic, a lone node weighs one diameter. */
export const rodInverseMass = (mass: number, pinned: boolean, radius: number) => pinned ? 0 : 1 / (mass > 0 ? mass : 2 * radius);

/**
 * Elastic rods with XPBD in small steps (Macklin et al. 2019): stretch along each segment, isotropic
 * bending toward straight and capsule contacts with friction, one pass per substep, double
 * precision, no randomness. Stretch and bend constraints are solved colour by colour
 * (rodTopology.ts), contacts as one averaged Jacobi pass, so the GPU solver (RodGpuSolver.ts) runs
 * the same scheme in parallel. With a straight rest shape and position-only pins, twist does not
 * move the centre line (Bergou et al. 2008), so the rods carry no frames. The same rest, spec and
 * step always give the same state, whether reached by playback or from a checkpoint.
 */
export class RodSimulation {
  private readonly spec: RodSpec;
  private readonly rest: RodRest;
  private readonly positions: Float64Array;
  private readonly velocities: Float64Array;
  private readonly predicted: Float64Array;
  private readonly inverseMass: Float64Array;
  private readonly topology: RodTopology;
  private readonly stretchCompliance: Float64Array;
  private readonly bendCompliance: Float64Array;
  private readonly contacts: RodContacts;
  private readonly air = new Float64Array(3);
  private readonly checkpoints = new Map<number, Float64Array>();
  private interval = CHECKPOINT_INTERVAL;
  private step = 0;

  constructor(spec: RodSpec, rest: RodRest) {
    this.spec = spec; this.rest = rest;
    const count = rest.positions.length / 3;
    this.positions = Float64Array.from(rest.positions);
    this.velocities = new Float64Array(count * 3);
    this.predicted = new Float64Array(count * 3);
    this.topology = buildRodTopology(rest);
    const stretch = rodStretchModulus(spec.stretch), bend = rodBendModulus(spec.bend);
    this.stretchCompliance = this.topology.segments.rest.map(length => length / stretch);
    // C = e2/l2 - e1/l1 is about the curvature times the node's length, so E = EI/2 · |C|² / l.
    this.bendCompliance = this.topology.bends.length.map(length => length / bend);
    this.inverseMass = this.topology.mass.map((value, node) => rodInverseMass(value, rest.pinned[node] === 1, spec.radius));
    this.contacts = new RodContacts(this.topology.segments, spec.radius);
    this.contacts.update(this.positions);
    this.checkpoints.set(0, this.snapshot());
  }

  /** Positions, velocities and the positions the contact candidates were built from. */
  private snapshot(): Float64Array {
    const size = this.positions.length, state = new Float64Array(size * 3);
    state.set(this.positions); state.set(this.velocities, size); state.set(this.contacts.state(), size * 2);
    return state;
  }

  private restore(state: Float64Array) {
    const size = this.positions.length;
    this.positions.set(state.subarray(0, size));
    this.velocities.set(state.subarray(size, size * 2));
    this.contacts.restore(state.subarray(size * 2));
  }

  /** Node positions after `target` steps: advances, or resumes from the latest checkpoint before it. */
  positionsAt(target: number): Float64Array {
    target = Math.max(0, Math.min(ROD_STEP_LIMIT, Math.floor(target)));
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
    const { spec, positions, velocities, predicted, inverseMass, rest, air } = this, { before, after } = this.topology;
    const time = this.step / ROD_STEP_RATE - spec.preroll, wind = windVelocity(spec, time);
    const dt = 1 / (ROD_STEP_RATE * spec.substeps), damping = Math.exp(-(spec.damping + spec.drag) * dt);
    const pull = 1 - Math.exp(-ROD_AIR_DRAG * dt), limit = ROD_MAX_TRAVEL * spec.radius / dt, count = inverseMass.length;
    for (let substep = 0; substep < spec.substeps; substep++) {
      // Pins follow their pull from source time 0; the rest moves under gravity, air and damping.
      const reach = spec.pull * rodPullEase((time + (substep + 1) * dt) / spec.pullTime);
      for (let node = 0; node < count; node++) {
        const base = node * 3;
        if (inverseMass[node] === 0) {
          for (let axis = 0; axis < 3; axis++) predicted[base + axis] = rest.positions[base + axis] + rest.pull[base + axis] * reach;
          continue;
        }
        const i = before[node] * 3, j = after[node] * 3;
        let ax = positions[j] - positions[i], ay = positions[j + 1] - positions[i + 1], az = positions[j + 2] - positions[i + 2];
        const size = Math.sqrt(ax * ax + ay * ay + az * az);
        if (size > 0) { ax /= size; ay /= size; az /= size; }
        airVelocity(spec, wind, time, positions[base], positions[base + 1], positions[base + 2], air, 0);
        // Air drag across the rod: the relative air speed loses its component along the axis.
        let rx = air[0] - velocities[base], ry = air[1] - velocities[base + 1], rz = air[2] - velocities[base + 2];
        const along = rx * ax + ry * ay + rz * az;
        rx -= along * ax; ry -= along * ay; rz -= along * az;
        let vx = (velocities[base] + rx * pull) * damping;
        let vy = (velocities[base + 1] + ry * pull - spec.gravity * dt) * damping;
        let vz = (velocities[base + 2] + rz * pull) * damping;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed > limit) { const scale = limit / speed; vx *= scale; vy *= scale; vz *= scale; }
        velocities[base] = vx; velocities[base + 1] = vy; velocities[base + 2] = vz;
        predicted[base] = positions[base] + vx * dt; predicted[base + 1] = positions[base + 1] + vy * dt; predicted[base + 2] = positions[base + 2] + vz * dt;
      }
      this.contacts.update(predicted);
      this.solveStretch(dt);
      this.solveBend(dt);
      this.contacts.solve(predicted, positions, inverseMass, spec.friction);
      if (spec.floor) this.solveFloor();
      for (let index = 0; index < positions.length; index++) {
        velocities[index] = (predicted[index] - positions[index]) / dt;
        positions[index] = predicted[index];
      }
    }
  }

  private solveStretch(dt: number) {
    const { predicted: p, inverseMass: w, stretchCompliance } = this, { a, b, rest } = this.topology.segments, inverseDt2 = 1 / (dt * dt);
    for (const color of this.topology.stretchColors) for (const c of color) {
      const i = a[c], j = b[c], wi = w[i], wj = w[j], weight = wi + wj;
      if (weight === 0) continue;
      const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length < 1e-12) continue;
      const scale = (length - rest[c]) / (weight + stretchCompliance[c] * inverseDt2) / length;
      p[i * 3] += wi * scale * dx; p[i * 3 + 1] += wi * scale * dy; p[i * 3 + 2] += wi * scale * dz;
      p[j * 3] -= wj * scale * dx; p[j * 3 + 1] -= wj * scale * dy; p[j * 3 + 2] -= wj * scale * dz;
    }
  }

  /** Vector bend C = (x_next - x_mid) / l2 - (x_mid - x_prev) / l1, zero on a straight rod at rest length. */
  private solveBend(dt: number) {
    const { predicted: p, inverseMass: w, bendCompliance: compliance } = this, { prev, mid, next, inverse1, inverse2 } = this.topology.bends;
    const inverseDt2 = 1 / (dt * dt);
    for (const color of this.topology.bendColors) for (const k of color) {
      const i = prev[k] * 3, m = mid[k] * 3, j = next[k] * 3, g1 = inverse1[k], g2 = inverse2[k], gm = g1 + g2;
      const wi = w[prev[k]], wm = w[mid[k]], wj = w[next[k]];
      const weight = wi * g1 * g1 + wm * gm * gm + wj * g2 * g2;
      if (weight === 0) continue;
      const scale = -1 / (weight + compliance[k] * inverseDt2);
      for (let axis = 0; axis < 3; axis++) {
        const constraint = (p[j + axis] - p[m + axis]) * g2 - (p[m + axis] - p[i + axis]) * g1, lambda = constraint * scale;
        p[i + axis] += wi * g1 * lambda; p[m + axis] -= wm * gm * lambda; p[j + axis] += wj * g2 * lambda;
      }
    }
  }

  /** Floor plane at floorHeight (+Y up): nodes rest on it with the same positional friction. */
  private solveFloor() {
    const { predicted: p, positions: x, inverseMass: w, spec } = this, ground = spec.floorHeight + spec.radius;
    for (let node = 0; node < w.length; node++) {
      const base = node * 3;
      if (w[node] === 0 || p[base + 1] >= ground) continue;
      const depth = ground - p[base + 1];
      p[base + 1] = ground;
      const dx = p[base] - x[base], dz = p[base + 2] - x[base + 2], slide = Math.sqrt(dx * dx + dz * dz);
      if (slide < 1e-15) continue;
      const keep = slide < spec.friction * depth ? 0 : 1 - Math.min(1, 0.8 * spec.friction * depth / slide);
      p[base] = x[base] + dx * keep; p[base + 2] = x[base + 2] + dz * keep;
    }
  }
}
