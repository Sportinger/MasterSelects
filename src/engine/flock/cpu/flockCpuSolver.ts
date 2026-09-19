import type { FlockEvaluationContext } from '../../../services/flock/compiler/flockParamEvaluation';
import { resolveFlockStep } from '../../../services/flock/compiler/flockParamEvaluation';
import { nextPowerOfTwo, selectTrailSlots } from '../../../services/flock/compiler/flockCompilerSupport';
import {
  FLOCK_PARTICLE_STRIDE,
  P_AGE,
  P_EMITTER,
  P_FWD,
  P_GEN,
  P_GROUP,
  P_LIFE,
  P_NEIGHBORS,
  P_POS,
  P_VEL,
  type FlockProgram,
} from '../../../services/flock/compiler/flockProgramTypes';
import { buildInitialFlockState } from '../shared/flockInitialState';
import { NEIGHBOR_CELL_ORDER, cellHash, mixKey, neighborCandidateBudget, rand01 } from '../shared/flockMath';
import {
  accumulateAvoidance,
  accumulateFieldForces,
  applyHardConstraints,
  evaluateSelections,
} from './flockCpuForces';
import { prepareCpuStepParams, type CpuEmitter, type CpuStepParams } from './flockCpuStepParams';

/** Gains shared with the WGSL step shader. */
export const FLOCK_COHESION_GAIN = 0.6;
export const FLOCK_ALIGNMENT_GAIN = 0.9;
export const FLOCK_SEPARATION_GAIN = 45;

export interface FlockCpuCheckpoint {
  step: number;
  state: Float32Array;
  previous: Float32Array;
  trails: Float32Array[];
}

export interface FlockCpuStats {
  alive: number;
  occupiedCells: number;
  maxCellCount: number;
  saturatedCells: number;
  /** Particles whose neighborhood exceeded the candidate budget and was stride-sampled. */
  sampledParticles: number;
  neighborLimited: number;
}

/**
 * Deterministic reference implementation of the flock step. It defines the
 * semantics the GPU solver mirrors, backs unit tests, thumbnails and the
 * explicitly limited low-count fallback path.
 */
export class FlockCpuSolver {
  readonly program: FlockProgram;
  readonly capacity: number;
  state: Float32Array;
  previous: Float32Array;
  step = 0;
  readonly trailSlots: Uint32Array[];
  readonly trailRings: Float32Array[];
  stats: FlockCpuStats = { alive: 0, occupiedCells: 0, maxCellCount: 0, saturatedCells: 0, sampledParticles: 0, neighborLimited: 0 };

  private readonly tableMask: number;
  private readonly cellStart: Int32Array;
  private readonly cellEnd: Int32Array;
  private readonly cellCursor: Int32Array;
  private readonly keys: Uint32Array;
  private readonly sorted: Uint32Array;

  constructor(program: FlockProgram) {
    this.program = program;
    this.capacity = program.capacity;
    this.state = new Float32Array(this.capacity * FLOCK_PARTICLE_STRIDE);
    this.previous = new Float32Array(this.capacity * FLOCK_PARTICLE_STRIDE);
    const tableSize = nextPowerOfTwo(Math.max(4096, this.capacity * 2));
    this.tableMask = tableSize - 1;
    this.cellStart = new Int32Array(tableSize);
    this.cellEnd = new Int32Array(tableSize);
    this.cellCursor = new Int32Array(tableSize);
    this.keys = new Uint32Array(this.capacity);
    this.sorted = new Uint32Array(this.capacity);
    this.trailSlots = program.trails.map((trail) => selectTrailSlots(this.capacity, trail.sampleFraction, trail.slotCount, trail.salt));
    this.trailRings = program.trails.map((trail, index) => new Float32Array(this.trailSlots[index].length * trail.samples * 4));
    this.reset();
  }

  reset(): void {
    this.step = 0;
    buildInitialFlockState(this.program, this.state);
    this.previous.set(this.state);
    for (const ring of this.trailRings) ring.fill(0);
  }

  checkpoint(): FlockCpuCheckpoint {
    return {
      step: this.step,
      state: this.state.slice(),
      previous: this.previous.slice(),
      trails: this.trailRings.map((ring) => ring.slice()),
    };
  }

  restore(checkpoint: FlockCpuCheckpoint): void {
    this.step = checkpoint.step;
    this.state.set(checkpoint.state);
    this.previous.set(checkpoint.previous);
    checkpoint.trails.forEach((ring, index) => this.trailRings[index]?.set(ring));
  }

  advanceTo(targetStep: number, context: FlockEvaluationContext): void {
    while (this.step < targetStep) {
      this.advance(prepareCpuStepParams(resolveFlockStep(this.program, this.step, context)));
    }
  }

  advance(params: CpuStepParams): void {
    const read = this.state;
    const write = this.previous;
    write.set(read);
    this.buildGrid(read, params.cellSize, this.program.simulation.cellCandidates);

    const selected = new Uint8Array(Math.max(1, params.selections.length));
    const acc = new Float64Array(3);
    const position = new Float64Array(3);
    const velocity = new Float64Array(3);
    const visited = new Int32Array(27);
    const ruleCount = params.rules.length;
    const sums = new Float64Array(ruleCount * 10);
    let maxRadius = 0;
    for (const rule of params.rules) maxRadius = Math.max(maxRadius, rule.radius, rule.separationRadius);
    const maxRadius2 = maxRadius * maxRadius;
    const inverseCell = 1 / params.cellSize;
    const neighborCap = this.program.simulation.neighborLimit * 2;
    const candidateBudget = neighborCandidateBudget(this.program.simulation.neighborLimit, this.program.simulation.cellCandidates);
    let alive = 0;
    let neighborLimited = 0;
    let sampledParticles = 0;

    for (let index = 0; index < this.capacity; index += 1) {
      const base = index * FLOCK_PARTICLE_STRIDE;
      const emitter = params.emitters[read[base + P_EMITTER]] as CpuEmitter | undefined;
      if (!emitter) continue;
      const local = index - emitter.offset;
      const active = (local + 0.5) / emitter.count <= emitter.activeFraction;
      let age = read[base + P_AGE];
      const generation = read[base + P_GEN];

      if (age >= 0 && (!active || (read[base + P_LIFE] > 0 && age >= read[base + P_LIFE]))) {
        age = -1;
        write[base + P_AGE] = -1;
        if (active && emitter.respawn) {
          this.spawn(write, index, emitter, generation, params);
          alive += 1;
          continue;
        }
      }
      if (age < 0) {
        const birthTime = emitter.birthMode === 1 ? (local / emitter.count) * emitter.stagger : 0;
        if (active && params.simTime >= birthTime && (generation === 0 || emitter.respawn)) {
          this.spawn(write, index, emitter, generation, params);
          alive += 1;
        } else {
          write[base + P_AGE] = -1;
        }
        continue;
      }

      const px = read[base + P_POS];
      const py = read[base + P_POS + 1];
      const pz = read[base + P_POS + 2];
      const vx = read[base + P_VEL];
      const vy = read[base + P_VEL + 1];
      const vz = read[base + P_VEL + 2];
      const fx = read[base + P_FWD];
      const fy = read[base + P_FWD + 1];
      const fz = read[base + P_FWD + 2];
      const group = read[base + P_GROUP];
      evaluateSelections(params.selections, read, index, selected);
      acc[0] = 0;
      acc[1] = 0;
      acc[2] = 0;

      let neighborCount = 0;
      let stride = 1;
      if (ruleCount > 0 && maxRadius > 0) {
        sums.fill(0);
        const ix = Math.floor(px * inverseCell);
        const iy = Math.floor(py * inverseCell);
        const iz = Math.floor(pz * inverseCell);
        // Pass 1: occupied, de-duplicated cells nearest first, and their candidate total.
        let cellCount = 0;
        let totalCandidates = 0;
        for (const offset of NEIGHBOR_CELL_ORDER) {
          const hash = cellHash(ix + offset[0], iy + offset[1], iz + offset[2], this.tableMask);
          let duplicate = false;
          for (let v = 0; v < cellCount; v += 1) {
            if (visited[v] === hash) { duplicate = true; break; }
          }
          if (duplicate || this.cellStart[hash] < 0) continue;
          visited[cellCount] = hash;
          cellCount += 1;
          totalCandidates += this.cellEnd[hash] - this.cellStart[hash];
        }
        // Pass 2: one deterministic stride over the whole neighborhood, so dense
        // regions are sampled without spatial bias and work stays bounded.
        stride = totalCandidates > candidateBudget ? Math.ceil(totalCandidates / candidateBudget) : 1;
        if (stride > 1) sampledParticles += 1;
        const phase = stride > 1 ? index % stride : 0;
        let running = 0;
        let limited = false;
        for (let c = 0; c < cellCount && !limited; c += 1) {
          const start = this.cellStart[visited[c]];
          const end = this.cellEnd[visited[c]];
          const first = (stride - ((running + phase) % stride)) % stride;
          running += end - start;
          for (let k = start + first; k < end; k += stride) {
            const other = this.sorted[k];
            if (other === index) continue;
            const ob = other * FLOCK_PARTICLE_STRIDE;
            const ox = read[ob + P_POS] - px;
            const oy = read[ob + P_POS + 1] - py;
            const oz = read[ob + P_POS + 2] - pz;
            const d2 = ox * ox + oy * oy + oz * oz;
            if (d2 > maxRadius2 || d2 < 1e-12) continue;
            if (neighborCount >= neighborCap) { limited = true; break; }
            neighborCount += 1;
            const distance = Math.sqrt(d2);
            const otherGroup = read[ob + P_GROUP];
            for (let r = 0; r < ruleCount; r += 1) {
              const rule = params.rules[r];
              if (rule.selection >= 0 && selected[rule.selection] !== 1) continue;
              if (d2 > rule.radius * rule.radius) continue;
              if (rule.groupMode === 1 && otherGroup !== group) continue;
              if (rule.groupMode === 2 && otherGroup === group) continue;
              if (rule.cosHalfFov > -0.999 && (fx * ox + fy * oy + fz * oz) / distance < rule.cosHalfFov) continue;
              const s = r * 10;
              sums[s] += 1;
              sums[s + 1] += read[ob + P_POS];
              sums[s + 2] += read[ob + P_POS + 1];
              sums[s + 3] += read[ob + P_POS + 2];
              sums[s + 4] += read[ob + P_VEL];
              sums[s + 5] += read[ob + P_VEL + 1];
              sums[s + 6] += read[ob + P_VEL + 2];
              if (distance < rule.separationRadius) {
                const weight = (1 - distance / rule.separationRadius) / distance;
                sums[s + 7] -= ox * weight;
                sums[s + 8] -= oy * weight;
                sums[s + 9] -= oz * weight;
              }
            }
          }
        }
        if (limited) neighborLimited += 1;
        for (let r = 0; r < ruleCount; r += 1) {
          const s = r * 10;
          const count = sums[s];
          if (count === 0) continue;
          const rule = params.rules[r];
          // Averages are unbiased under sampling; the separation sum is scaled back up by the stride.
          const separationScale = rule.separation * FLOCK_SEPARATION_GAIN * stride;
          acc[0] += (sums[s + 1] / count - px) * rule.cohesion * FLOCK_COHESION_GAIN
            + (sums[s + 4] / count - vx) * rule.alignment * FLOCK_ALIGNMENT_GAIN
            + sums[s + 7] * separationScale;
          acc[1] += (sums[s + 2] / count - py) * rule.cohesion * FLOCK_COHESION_GAIN
            + (sums[s + 5] / count - vy) * rule.alignment * FLOCK_ALIGNMENT_GAIN
            + sums[s + 8] * separationScale;
          acc[2] += (sums[s + 3] / count - pz) * rule.cohesion * FLOCK_COHESION_GAIN
            + (sums[s + 6] / count - vz) * rule.alignment * FLOCK_ALIGNMENT_GAIN
            + sums[s + 9] * separationScale;
        }
      }

      accumulateFieldForces(params, read, index, selected, acc);
      accumulateAvoidance(params, px, py, pz, acc);

      const accLength = Math.sqrt(acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2]);
      if (accLength > params.maxAcceleration && accLength > 0) {
        const scale = params.maxAcceleration / accLength;
        acc[0] *= scale;
        acc[1] *= scale;
        acc[2] *= scale;
      }
      velocity[0] = vx + acc[0] * params.dt;
      velocity[1] = vy + acc[1] * params.dt;
      velocity[2] = vz + acc[2] * params.dt;
      if (params.planar) velocity[params.planarAxis] = 0;
      let speed = Math.sqrt(velocity[0] * velocity[0] + velocity[1] * velocity[1] + velocity[2] * velocity[2]);
      if (speed > params.maxSpeed && speed > 0) {
        const scale = params.maxSpeed / speed;
        velocity[0] *= scale;
        velocity[1] *= scale;
        velocity[2] *= scale;
        speed = params.maxSpeed;
      } else if (speed < params.minSpeed) {
        if (speed > 1e-5) {
          const scale = params.minSpeed / speed;
          velocity[0] *= scale;
          velocity[1] *= scale;
          velocity[2] *= scale;
        } else {
          velocity[0] = fx * params.minSpeed;
          velocity[1] = fy * params.minSpeed;
          velocity[2] = fz * params.minSpeed;
          if (params.planar) velocity[params.planarAxis] = 0;
        }
      }
      position[0] = px + velocity[0] * params.dt;
      position[1] = py + velocity[1] * params.dt;
      position[2] = pz + velocity[2] * params.dt;
      if (params.planar) position[params.planarAxis] = 0;

      if (!applyHardConstraints(params, position, velocity)) {
        write[base + P_AGE] = -1;
        continue;
      }
      if (!Number.isFinite(position[0] + position[1] + position[2] + velocity[0] + velocity[1] + velocity[2])) {
        position[0] = emitter.center[0];
        position[1] = emitter.center[1];
        position[2] = emitter.center[2];
        velocity[0] = 0;
        velocity[1] = 0;
        velocity[2] = 0;
      }

      speed = Math.sqrt(velocity[0] * velocity[0] + velocity[1] * velocity[1] + velocity[2] * velocity[2]);
      let tx = fx;
      let ty = fy;
      let tz = fz;
      if (speed > 1e-5) {
        tx = velocity[0] / speed;
        ty = velocity[1] / speed;
        tz = velocity[2] / speed;
      }
      const blend = 1 - Math.exp(-params.turnRate * params.dt);
      let nfx = fx + (tx - fx) * blend;
      let nfy = fy + (ty - fy) * blend;
      let nfz = fz + (tz - fz) * blend;
      const forwardLength = Math.sqrt(nfx * nfx + nfy * nfy + nfz * nfz) || 1;
      nfx /= forwardLength;
      nfy /= forwardLength;
      nfz /= forwardLength;

      write[base + P_POS] = position[0];
      write[base + P_POS + 1] = position[1];
      write[base + P_POS + 2] = position[2];
      write[base + P_VEL] = velocity[0];
      write[base + P_VEL + 1] = velocity[1];
      write[base + P_VEL + 2] = velocity[2];
      write[base + P_FWD] = nfx;
      write[base + P_FWD + 1] = nfy;
      write[base + P_FWD + 2] = nfz;
      write[base + P_AGE] = age + params.dt;
      write[base + P_NEIGHBORS] = neighborCount;
      alive += 1;
    }

    this.previous = read;
    this.state = write;
    this.step += 1;
    this.stats = { ...this.stats, alive, neighborLimited, sampledParticles };
    this.writeTrails();
  }

  private spawn(target: Float32Array, index: number, emitter: CpuEmitter, generation: number, params: CpuStepParams): void {
    const base = index * FLOCK_PARTICLE_STRIDE;
    const nextGeneration = generation + 1;
    const key = (channel: number) => mixKey(emitter.seed, nextGeneration, channel);
    const u1 = rand01(index, key(1));
    const u2 = rand01(index, key(2));
    const u3 = rand01(index, key(3));
    let ox = 0;
    let oy = 0;
    let oz = 0;
    const sphereDirection = (a: number, b: number): [number, number, number] => {
      const z = a * 2 - 1;
      const phi = b * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      return [r * Math.cos(phi), r * Math.sin(phi), z];
    };
    switch (emitter.shape) {
      case 0:
      case 1: {
        const [dx, dy, dz] = sphereDirection(u1, u2);
        const radius = emitter.shape === 1 ? 1 : Math.cbrt(u3);
        ox = dx * radius * emitter.size[0];
        oy = dy * radius * emitter.size[1];
        oz = dz * radius * emitter.size[2];
        break;
      }
      case 2:
        ox = (u1 - 0.5) * emitter.size[0];
        oy = (u2 - 0.5) * emitter.size[1];
        oz = (u3 - 0.5) * emitter.size[2];
        break;
      case 3: {
        const angle = u1 * Math.PI * 2;
        const radius = Math.sqrt(u2);
        ox = Math.cos(angle) * radius * emitter.size[0];
        oy = (u3 - 0.5) * emitter.size[1] * 0.05;
        oz = Math.sin(angle) * radius * emitter.size[2];
        break;
      }
      case 5:
        ox = (u1 - 0.5) * emitter.size[0];
        oy = (u1 - 0.5) * emitter.size[1];
        oz = (u1 - 0.5) * emitter.size[2];
        break;
      default:
        break;
    }
    const [rx, ry, rz] = sphereDirection(rand01(index, key(4)), rand01(index, key(5)));
    const dirLength = Math.hypot(emitter.direction[0], emitter.direction[1], emitter.direction[2]);
    let hx = rx;
    let hy = ry;
    let hz = rz;
    if (dirLength > 1e-6) {
      hx = emitter.direction[0] / dirLength * (1 - emitter.spread) + rx * emitter.spread;
      hy = emitter.direction[1] / dirLength * (1 - emitter.spread) + ry * emitter.spread;
      hz = emitter.direction[2] / dirLength * (1 - emitter.spread) + rz * emitter.spread;
    }
    if (params.planar) {
      if (params.planarAxis === 0) { hx = 0; ox = 0; }
      if (params.planarAxis === 1) { hy = 0; oy = 0; }
      if (params.planarAxis === 2) { hz = 0; oz = 0; }
    }
    const headingLength = Math.hypot(hx, hy, hz) || 1;
    hx /= headingLength;
    hy /= headingLength;
    hz /= headingLength;
    const lifetime = emitter.lifetime > 0
      ? emitter.lifetime * (1 + emitter.lifetimeVariance * (rand01(index, key(6)) * 2 - 1))
      : 0;
    target[base + P_POS] = emitter.center[0] + ox;
    target[base + P_POS + 1] = emitter.center[1] + oy;
    target[base + P_POS + 2] = emitter.center[2] + oz;
    if (params.planar) target[base + P_POS + params.planarAxis] = 0;
    target[base + P_AGE] = 0;
    target[base + P_VEL] = hx * emitter.initialSpeed;
    target[base + P_VEL + 1] = hy * emitter.initialSpeed;
    target[base + P_VEL + 2] = hz * emitter.initialSpeed;
    target[base + P_LIFE] = Math.max(0, lifetime);
    target[base + P_FWD] = hx;
    target[base + P_FWD + 1] = hy;
    target[base + P_FWD + 2] = hz;
    target[base + P_GEN] = nextGeneration;
    target[base + P_NEIGHBORS] = 0;
  }

  private buildGrid(state: Float32Array, cellSize: number, candidates: number): void {
    const inverse = 1 / cellSize;
    this.cellStart.fill(-1);
    this.cellCursor.fill(0);
    const counts = this.cellCursor;
    let aliveCount = 0;
    for (let index = 0; index < this.capacity; index += 1) {
      const base = index * FLOCK_PARTICLE_STRIDE;
      if (state[base + P_AGE] < 0) {
        this.keys[index] = 0xffffffff;
        continue;
      }
      const hash = cellHash(
        Math.floor(state[base + P_POS] * inverse),
        Math.floor(state[base + P_POS + 1] * inverse),
        Math.floor(state[base + P_POS + 2] * inverse),
        this.tableMask,
      );
      this.keys[index] = hash;
      counts[hash] += 1;
      aliveCount += 1;
    }
    let offset = 0;
    let occupied = 0;
    let maxCellCount = 0;
    let saturated = 0;
    for (let hash = 0; hash <= this.tableMask; hash += 1) {
      const count = counts[hash];
      if (count === 0) continue;
      this.cellStart[hash] = offset;
      this.cellEnd[hash] = offset + count;
      counts[hash] = offset;
      offset += count;
      occupied += 1;
      maxCellCount = Math.max(maxCellCount, count);
      if (count > candidates) saturated += 1;
    }
    for (let index = 0; index < this.capacity; index += 1) {
      const hash = this.keys[index];
      if (hash === 0xffffffff) continue;
      this.sorted[counts[hash]] = index;
      counts[hash] += 1;
    }
    this.stats = { ...this.stats, occupiedCells: occupied, maxCellCount, saturatedCells: saturated, alive: aliveCount };
  }

  private writeTrails(): void {
    this.program.trails.forEach((trail, trailIndex) => {
      if (this.step % trail.interval !== 0) return;
      const ringIndex = Math.floor(this.step / trail.interval) % trail.samples;
      const slots = this.trailSlots[trailIndex];
      const ring = this.trailRings[trailIndex];
      for (let slot = 0; slot < slots.length; slot += 1) {
        const base = slots[slot] * FLOCK_PARTICLE_STRIDE;
        const out = (slot * trail.samples + ringIndex) * 4;
        ring[out] = this.state[base + P_POS];
        ring[out + 1] = this.state[base + P_POS + 1];
        ring[out + 2] = this.state[base + P_POS + 2];
        ring[out + 3] = this.state[base + P_AGE] >= 0 ? this.state[base + P_GEN] : 0;
      }
    });
  }
}
