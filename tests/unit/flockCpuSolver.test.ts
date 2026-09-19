import { describe, expect, it } from 'vitest';
import type { FlockParamValue } from '../../src/types/flock';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { indexFlockKeyframes } from '../../src/services/flock/compiler/flockParamEvaluation';
import {
  FLOCK_PARTICLE_STRIDE,
  P_AGE,
  P_GEN,
  P_POS,
  P_VEL,
  type FlockProgram,
} from '../../src/services/flock/compiler/flockProgramTypes';
import { FlockCpuSolver } from '../../src/engine/flock/cpu/flockCpuSolver';

const context = { keyframesByProperty: indexFlockKeyframes([]) };

function buildProgram(options: {
  emitter?: Record<string, FlockParamValue>;
  rules?: Record<string, FlockParamValue> | null;
  simulation?: Record<string, FlockParamValue>;
  boundary?: Record<string, FlockParamValue>;
  trails?: Record<string, FlockParamValue>;
}): FlockProgram {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 200, shape: 'sphere', size: [30, 30, 30], ...options.emitter });
  const sim = b.add('flock.simulation', { stepRate: '60', ...options.simulation });
  const points = b.add('flock.render-points');
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', sim, 'spawn').connect(sim, 'particles', points, 'particles').connect(points, 'scene', output, 'scene');
  if (options.rules !== null) {
    const rules = b.add('flock.rules', { ...options.rules });
    b.connect(rules, 'behavior', sim, 'behavior');
  }
  if (options.boundary) {
    const boundary = b.add('flock.boundary', options.boundary);
    b.connect(boundary, 'boundary', sim, 'boundary');
  }
  if (options.trails) {
    const trails = b.add('flock.trails', options.trails);
    const curves = b.add('flock.render-curves');
    b.connect(sim, 'particles', trails, 'particles').connect(trails, 'curves', curves, 'curves').connect(curves, 'scene', output, 'scene');
  }
  const result = compileFlockDefinition(b.build('test'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

function positionOf(solver: FlockCpuSolver, index: number): [number, number, number] {
  const base = index * FLOCK_PARTICLE_STRIDE;
  return [solver.state[base + P_POS], solver.state[base + P_POS + 1], solver.state[base + P_POS + 2]];
}

function setParticle(solver: FlockCpuSolver, index: number, position: [number, number, number], velocity: [number, number, number]) {
  const base = index * FLOCK_PARTICLE_STRIDE;
  solver.state.set(position, base + P_POS);
  solver.state.set(velocity, base + P_VEL);
}

describe('FlockCpuSolver determinism', () => {
  it('seeds and advances identically for identical programs', () => {
    const program = buildProgram({});
    const a = new FlockCpuSolver(program);
    const b = new FlockCpuSolver(program);
    a.advanceTo(90, context);
    b.advanceTo(90, context);
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
  });

  it('replays from a checkpoint to the same state as sequential stepping, repeatedly', () => {
    const program = buildProgram({ trails: { sampleFraction: 0.2, samples: 8, interval: 2 } });
    const sequential = new FlockCpuSolver(program);
    sequential.advanceTo(120, context);

    const seeking = new FlockCpuSolver(program);
    seeking.advanceTo(60, context);
    const checkpoint = seeking.checkpoint();
    seeking.advanceTo(120, context);
    expect(Array.from(seeking.state)).toEqual(Array.from(sequential.state));
    expect(Array.from(seeking.trailRings[0])).toEqual(Array.from(sequential.trailRings[0]));

    seeking.restore(checkpoint);
    seeking.advanceTo(120, context);
    expect(Array.from(seeking.state)).toEqual(Array.from(sequential.state));
  });

  it('changes the swarm when the seed changes', () => {
    const a = new FlockCpuSolver(buildProgram({ emitter: { seed: 1 } }));
    const b = new FlockCpuSolver(buildProgram({ emitter: { seed: 2 } }));
    a.advanceTo(1, context);
    b.advanceTo(1, context);
    expect(positionOf(a, 0)).not.toEqual(positionOf(b, 0));
  });
});

describe('FlockCpuSolver flocking rules', () => {
  const noForces = { minSpeed: 0, maxSpeed: 1000, maxAcceleration: 10_000, turnRate: 6 };

  it('separation pushes close neighbors apart', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 2, initialSpeed: 0 },
      rules: { cohesion: 0, alignment: 0, separation: 1, neighborRadius: 12, separationRadius: 4, fov: 360 },
      simulation: noForces,
    }));
    solver.advanceTo(1, context);
    setParticle(solver, 0, [-1, 0, 0], [0, 0, 0]);
    setParticle(solver, 1, [1, 0, 0], [0, 0, 0]);
    solver.advanceTo(3, context);
    expect(positionOf(solver, 1)[0] - positionOf(solver, 0)[0]).toBeGreaterThan(2);
  });

  it('cohesion pulls separated neighbors together', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 2, initialSpeed: 0 },
      rules: { cohesion: 2, alignment: 0, separation: 0, neighborRadius: 12, separationRadius: 0.1, fov: 360 },
      simulation: noForces,
    }));
    solver.advanceTo(1, context);
    setParticle(solver, 0, [-5, 0, 0], [0, 0, 0]);
    setParticle(solver, 1, [5, 0, 0], [0, 0, 0]);
    solver.advanceTo(10, context);
    expect(positionOf(solver, 1)[0] - positionOf(solver, 0)[0]).toBeLessThan(10);
  });

  it('alignment converges neighbor velocities', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 2, initialSpeed: 0 },
      rules: { cohesion: 0, alignment: 3, separation: 0, neighborRadius: 12, separationRadius: 0.1, fov: 360 },
      simulation: noForces,
    }));
    solver.advanceTo(1, context);
    setParticle(solver, 0, [0, 0, 0], [10, 0, 0]);
    setParticle(solver, 1, [3, 0, 0], [0, 10, 0]);
    solver.advanceTo(30, context);
    const base0 = 0;
    const base1 = FLOCK_PARTICLE_STRIDE;
    const dot = solver.state[base0 + P_VEL] * solver.state[base1 + P_VEL] + solver.state[base0 + P_VEL + 1] * solver.state[base1 + P_VEL + 1];
    const lengths = Math.hypot(solver.state[base0 + P_VEL], solver.state[base0 + P_VEL + 1]) * Math.hypot(solver.state[base1 + P_VEL], solver.state[base1 + P_VEL + 1]);
    expect(dot / lengths).toBeGreaterThan(0.95);
  });

  it('respects speed bounds and never produces NaN for one particle', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 1, initialSpeed: 500 },
      simulation: { maxSpeed: 20, minSpeed: 5 },
    }));
    solver.advanceTo(200, context);
    const speed = Math.hypot(solver.state[P_VEL], solver.state[P_VEL + 1], solver.state[P_VEL + 2]);
    expect(Number.isFinite(speed)).toBe(true);
    expect(speed).toBeLessThanOrEqual(20.0001);
    expect(speed).toBeGreaterThanOrEqual(4.999);
  });
});

describe('FlockCpuSolver population and bounds', () => {
  it('staggers births and respawns expired particles with a new generation', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 100, birthMode: 'stagger', stagger: 1, lifetime: 0.5, lifetimeVariance: 0 },
      rules: null,
    }));
    solver.advanceTo(15, context);
    const aliveEarly = solver.stats.alive;
    expect(aliveEarly).toBeGreaterThan(10);
    expect(aliveEarly).toBeLessThan(100);
    solver.advanceTo(90, context);
    const generations = Array.from({ length: 100 }, (_, index) => solver.state[index * FLOCK_PARTICLE_STRIDE + P_GEN]);
    expect(Math.max(...generations)).toBeGreaterThanOrEqual(2);
  });

  it('keeps work bounded when the entire population collapses into one cell', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 3000, shape: 'point', initialSpeed: 0.01 },
      rules: { neighborRadius: 12 },
      simulation: { cellCandidates: 16, neighborLimit: 8 },
    }));
    const started = performance.now();
    solver.advanceTo(3, context);
    expect(performance.now() - started).toBeLessThan(4000);
    expect(solver.stats.saturatedCells).toBeGreaterThanOrEqual(1);
    expect(solver.state.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('kills particles outside a kill boundary and respawns them', () => {
    const solver = new FlockCpuSolver(buildProgram({
      emitter: { count: 50, size: [5, 5, 5], initialSpeed: 60, spread: 1 },
      rules: null,
      simulation: { minSpeed: 60, maxSpeed: 60 },
      boundary: { shape: 'sphere', size: [10, 10, 10], mode: 'kill' },
    }));
    solver.advanceTo(30, context);
    const generations = Array.from({ length: 50 }, (_, index) => solver.state[index * FLOCK_PARTICLE_STRIDE + P_GEN]);
    expect(Math.max(...generations)).toBeGreaterThan(1);
    for (let index = 0; index < 50; index += 1) {
      const base = index * FLOCK_PARTICLE_STRIDE;
      if (solver.state[base + P_AGE] < 0) continue;
      expect(Math.hypot(solver.state[base], solver.state[base + 1], solver.state[base + 2])).toBeLessThanOrEqual(10.0001);
    }
  });

  it('records trail history rings with generation tags', () => {
    const solver = new FlockCpuSolver(buildProgram({ trails: { sampleFraction: 1, maxTrails: 10, samples: 4, interval: 1 } }));
    solver.advanceTo(6, context);
    const ring = solver.trailRings[0];
    expect(solver.trailSlots[0].length).toBe(10);
    const tags = Array.from({ length: 4 }, (_, sample) => ring[sample * 4 + 3]);
    expect(tags.every((tag) => tag >= 1)).toBe(true);
  });
});
