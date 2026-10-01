import type { RodSpec } from './rodProgram';
import type { RodRest } from './rodRest';
import { RodContacts, type RodSegments } from './rodContacts';
import { airVelocity, windVelocity } from './simulationForces';

/** Fixed simulation steps per second of source time; substeps subdivide each step. */
export const ROD_STEP_RATE = 60;
const CHECKPOINT_INTERVAL = 30;
const CHECKPOINT_LIMIT = 120;
/** Simulation never runs past ten minutes of source time; later frames hold that state. */
export const ROD_STEP_LIMIT = ROD_STEP_RATE * 600;
/** Air drag of a thin rod (per second), across its axis only. */
const AIR_DRAG = 1;
/** No node travels more than this share of the radius per substep, so rods cannot pass through each other. */
const MAX_TRAVEL = 0.5;

/**
 * Stiffness 0..1 to material moduli for a rod of unit linear density: stretch EA from 10 (rubber
 * band) to 1e7 (nearly inextensible), bend EI from 1e-4 (limp thread) to 10 (wire).
 */
const stretchModulus = (stiffness: number) => 10 ** (1 + 6 * stiffness);
const bendModulus = (stiffness: number) => 10 ** (-4 + 5 * stiffness);
const ease = (value: number) => value <= 0 ? 0 : value >= 1 ? 1 : value * value * (3 - 2 * value);

interface Bends { prev: Uint32Array; mid: Uint32Array; next: Uint32Array; inverse1: Float64Array; inverse2: Float64Array; compliance: Float64Array }

/**
 * Elastic rods with XPBD in small steps (Macklin et al. 2019): stretch along each segment, isotropic
 * bending toward straight and capsule contacts with friction, one Gauss-Seidel pass per substep in
 * a fixed order, double precision, no randomness. With a straight rest shape and position-only
 * pins, twist does not move the centre line (Bergou et al. 2008), so the rods carry no frames.
 * The same rest, spec and step always give the same state, whether reached by playback or from a
 * checkpoint.
 */
export class RodSimulation {
  private readonly spec: RodSpec;
  private readonly rest: RodRest;
  private readonly positions: Float64Array;
  private readonly velocities: Float64Array;
  private readonly predicted: Float64Array;
  private readonly inverseMass: Float64Array;
  /** Node neighbours along the rod (themselves at open ends), for the axis of air drag. */
  private readonly before: Uint32Array;
  private readonly after: Uint32Array;
  private readonly segments: RodSegments;
  private readonly stretchCompliance: Float64Array;
  private readonly bends: Bends;
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
    this.before = new Uint32Array(count); this.after = new Uint32Array(count);
    this.segments = this.buildSegments();
    const { a, b, rest: lengths } = this.segments, modulus = stretchModulus(spec.stretch);
    this.stretchCompliance = lengths.map(length => length / modulus);
    // Each node carries the rod length around it (unit linear density); a lone node one diameter.
    const mass = new Float64Array(count);
    for (let c = 0; c < a.length; c++) { mass[a[c]] += lengths[c] / 2; mass[b[c]] += lengths[c] / 2; }
    this.inverseMass = mass.map((value, node) => rest.pinned[node] ? 0 : 1 / (value > 0 ? value : 2 * spec.radius));
    this.bends = this.buildBends();
    this.contacts = new RodContacts(this.segments, spec.radius);
    this.contacts.update(this.positions);
    this.checkpoints.set(0, this.snapshot());
  }

  private buildSegments(): RodSegments {
    const { starts, counts, closed, positions } = this.rest;
    let total = 0;
    for (let rod = 0; rod < counts.length; rod++) total += closed[rod] ? counts[rod] : Math.max(0, counts[rod] - 1);
    const segments: RodSegments = { a: new Uint32Array(total), b: new Uint32Array(total), rest: new Float64Array(total),
      rod: new Uint32Array(total), arc: new Float64Array(total), rodLength: new Float64Array(counts.length), rodClosed: Uint8Array.from(closed) };
    let c = 0;
    for (let rod = 0; rod < counts.length; rod++) {
      const start = starts[rod], count = counts[rod], ring = closed[rod] === 1, links = ring ? count : Math.max(0, count - 1);
      for (let node = 0; node < count; node++) {
        this.before[start + node] = start + (ring ? (node - 1 + count) % count : Math.max(0, node - 1));
        this.after[start + node] = start + (ring ? (node + 1) % count : Math.min(count - 1, node + 1));
      }
      let arc = 0;
      for (let link = 0; link < links; link++, c++) {
        const i = start + link, j = start + (link + 1) % count;
        const length = Math.hypot(positions[j * 3] - positions[i * 3], positions[j * 3 + 1] - positions[i * 3 + 1], positions[j * 3 + 2] - positions[i * 3 + 2]);
        segments.a[c] = i; segments.b[c] = j; segments.rest[c] = length; segments.rod[c] = rod;
        segments.arc[c] = arc + length / 2; arc += length;
      }
      segments.rodLength[rod] = arc;
    }
    return segments;
  }

  /** One bend per interior node (every node of a ring) between its two segments. */
  private buildBends(): Bends {
    const { starts, counts, closed } = this.rest, { rest: lengths } = this.segments, modulus = bendModulus(this.spec.bend);
    const triples: number[][] = [];
    let first = 0;
    for (let rod = 0; rod < counts.length; rod++) {
      const start = starts[rod], count = counts[rod], ring = closed[rod] === 1, links = ring ? count : Math.max(0, count - 1);
      for (let node = ring ? 0 : 1; node < (ring ? count : count - 1); node++) {
        const left = first + (ring ? (node - 1 + count) % count : node - 1), right = first + node;
        triples.push([this.before[start + node], start + node, this.after[start + node], lengths[left], lengths[right]]);
      }
      first += links;
    }
    const bends: Bends = { prev: new Uint32Array(triples.length), mid: new Uint32Array(triples.length), next: new Uint32Array(triples.length),
      inverse1: new Float64Array(triples.length), inverse2: new Float64Array(triples.length), compliance: new Float64Array(triples.length) };
    triples.forEach(([prev, mid, next, l1, l2], index) => {
      bends.prev[index] = prev; bends.mid[index] = mid; bends.next[index] = next;
      bends.inverse1[index] = l1 > 0 ? 1 / l1 : 0; bends.inverse2[index] = l2 > 0 ? 1 / l2 : 0;
      // C = e2/l2 - e1/l1 is about the curvature times the node's length, so E = EI/2 · |C|² / l.
      bends.compliance[index] = (l1 + l2) / 2 / modulus;
    });
    return bends;
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
    const { spec, positions, velocities, predicted, inverseMass, rest, before, after, air } = this;
    const time = this.step / ROD_STEP_RATE - spec.preroll, wind = windVelocity(spec, time);
    const dt = 1 / (ROD_STEP_RATE * spec.substeps), damping = Math.exp(-(spec.damping + spec.drag) * dt);
    const pull = 1 - Math.exp(-AIR_DRAG * dt), limit = MAX_TRAVEL * spec.radius / dt, count = inverseMass.length;
    for (let substep = 0; substep < spec.substeps; substep++) {
      // Pins follow their pull from source time 0; the rest moves under gravity, air and damping.
      const reach = spec.pull * ease((time + (substep + 1) * dt) / spec.pullTime);
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
    const { predicted: p, inverseMass: w, stretchCompliance } = this, { a, b, rest } = this.segments, inverseDt2 = 1 / (dt * dt);
    for (let c = 0; c < a.length; c++) {
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
    const { predicted: p, inverseMass: w } = this, { prev, mid, next, inverse1, inverse2, compliance } = this.bends, inverseDt2 = 1 / (dt * dt);
    for (let k = 0; k < prev.length; k++) {
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
