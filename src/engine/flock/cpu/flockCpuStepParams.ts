import type { FlockResolvedStep } from '../../../services/flock/compiler/flockProgramTypes';
import {
  BIRTH_MODE_CODES,
  BOUNDARY_MODE_CODES,
  BOUNDARY_SHAPE_CODES,
  CLUSTER_ASSIGN_CODES,
  COMBINE_MODE_CODES,
  EMITTER_SHAPE_CODES,
  GROUP_MODE_CODES,
  OBSTACLE_SHAPE_CODES,
  OP_KIND_CODES,
  PLANAR_AXIS_CODES,
  SELECTION_KIND_CODES,
  code,
} from '../shared/flockCodes';
import {
  FALLOFF_CODES,
  PATH_SHAPE_CODES,
  rotationMatrixDegrees,
  type PathParams,
  type Vec3,
} from '../shared/flockMath';

export interface CpuEmitter {
  offset: number;
  count: number;
  shape: number;
  birthMode: number;
  group: number;
  seed: number;
  center: Vec3;
  size: Vec3;
  stagger: number;
  activeFraction: number;
  lifetime: number;
  lifetimeVariance: number;
  respawn: boolean;
  initialSpeed: number;
  direction: Vec3;
  spread: number;
}

export interface CpuRules {
  selection: number;
  cohesion: number;
  separation: number;
  alignment: number;
  radius: number;
  separationRadius: number;
  cosHalfFov: number;
  groupMode: number;
}

export interface CpuFieldOp {
  kind: number;
  selection: number;
  /** Numeric slots per kind (see flockCpuForces). */
  f: Float64Array;
  v0: Vec3;
  v1: Vec3;
  path: PathParams | null;
}

export interface CpuSelection {
  kind: number;
  invert: boolean;
  a: number;
  b: number;
  f: Float64Array;
  v0: Vec3;
  v1: Vec3;
  shape: number;
}

export interface CpuObstacle {
  shape: number;
  center: Vec3;
  size: Vec3;
  rotation: Float64Array;
  avoidDistance: number;
  strength: number;
}

export interface CpuBoundary {
  shape: number;
  mode: number;
  center: Vec3;
  size: Vec3;
  softness: number;
  strength: number;
}

export interface CpuStepParams {
  step: number;
  time: number;
  dt: number;
  /** Simulation clock from the first (warm-up) step, used for births. */
  simTime: number;
  maxSpeed: number;
  minSpeed: number;
  maxAcceleration: number;
  turnRate: number;
  planar: boolean;
  planarAxis: number;
  cellSize: number;
  emitters: CpuEmitter[];
  rules: CpuRules[];
  fields: CpuFieldOp[];
  selections: CpuSelection[];
  obstacles: CpuObstacle[];
  boundary: CpuBoundary | null;
}

const vec = (value: Vec3 | undefined, fallback: Vec3 = [0, 0, 0]): Vec3 => value ? [value[0], value[1], value[2]] : fallback;

export function toCpuSelections(resolved: FlockResolvedStep['selections']): CpuSelection[] {
  return resolved.map(({ spec, p }) => {
    const f = new Float64Array(4);
    switch (spec.kind) {
      case 'group': f[0] = spec.params.integers.group ?? 0; break;
      case 'fraction': f[0] = p.n.fraction ?? 0; f[1] = spec.params.integers.salt ?? 1; break;
      case 'speed':
      case 'age': f[0] = p.n.min ?? 0; f[1] = p.n.max ?? 0; break;
      case 'combine': f[0] = code(COMBINE_MODE_CODES, p.e.mode); break;
    }
    return {
      kind: code(SELECTION_KIND_CODES, spec.kind),
      invert: p.b.invert === true,
      a: spec.a,
      b: spec.b,
      f,
      v0: vec(p.v.center),
      v1: vec(p.v.size, [60, 60, 60]),
      shape: p.e.shape === 'box' ? 1 : 0,
    };
  });
}

export function prepareCpuStepParams(resolved: FlockResolvedStep): CpuStepParams {
  const sim = resolved.sim;
  const paths: PathParams[] = resolved.paths.map(({ p }) => ({
    shape: code(PATH_SHAPE_CODES, p.e.shape),
    center: vec(p.v.center),
    radius: p.n.radius ?? 90,
    height: p.n.height ?? 40,
    turns: p.n.turns ?? 2,
    rotation: rotationMatrixDegrees(vec(p.v.rotation)),
    points: [vec(p.v.p0), vec(p.v.p1), vec(p.v.p2), vec(p.v.p3)],
  }));

  const rules: CpuRules[] = [];
  const fields: CpuFieldOp[] = [];
  for (const { spec, p } of resolved.ops) {
    const weight = p.n.weight ?? 1;
    if (spec.kind === 'rules') {
      rules.push({
        selection: spec.selection,
        cohesion: (p.n.cohesion ?? 1) * weight,
        separation: (p.n.separation ?? 1) * weight,
        alignment: (p.n.alignment ?? 1) * weight,
        radius: Math.max(0.001, p.n.neighborRadius ?? 12),
        separationRadius: Math.max(0.001, p.n.separationRadius ?? 4),
        cosHalfFov: Math.cos(((Math.min(360, Math.max(1, p.n.fov ?? 300))) * Math.PI) / 360),
        groupMode: code(GROUP_MODE_CODES, p.e.groupMode),
      });
      continue;
    }
    const f = new Float64Array(8);
    let v0: Vec3 = [0, 0, 0];
    let v1: Vec3 = [0, 1, 0];
    switch (spec.kind) {
      case 'attractor':
        v0 = vec(p.v.position);
        f[0] = p.n.strength ?? 0;
        f[1] = Math.max(0.001, p.n.radius ?? 1);
        f[2] = code(FALLOFF_CODES, p.e.falloff, 2);
        f[3] = p.e.mode === 'repel' ? -1 : 1;
        break;
      case 'vortex': {
        v0 = vec(p.v.center);
        const axis = vec(p.v.axis, [0, 1, 0]);
        const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
        v1 = [axis[0] / length, axis[1] / length, axis[2] / length];
        f[0] = p.n.strength ?? 0;
        f[1] = Math.max(0.001, p.n.radius ?? 1);
        f[2] = p.n.inwardPull ?? 0;
        f[3] = code(FALLOFF_CODES, p.e.falloff, 2);
        break;
      }
      case 'turbulence':
        f[0] = p.n.strength ?? 0;
        f[1] = p.n.frequency ?? 0.02;
        f[2] = (p.n.evolution ?? 0) * resolved.time;
        break;
      case 'drag':
        f[0] = p.n.amount ?? 0;
        break;
      case 'wind': {
        const direction = vec(p.v.direction, [1, 0, 0]);
        const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
        v0 = [direction[0] / length, direction[1] / length, direction[2] / length];
        f[0] = p.n.strength ?? 0;
        f[1] = p.n.gust ?? 0;
        f[2] = resolved.time;
        break;
      }
      case 'cruise':
        f[0] = p.n.speed ?? 25;
        f[1] = p.n.strength ?? 1;
        break;
      case 'cluster':
        v0 = vec(p.v.center);
        f[0] = Math.max(1, spec.params.integers.clusters ?? 6);
        f[1] = p.n.spread ?? 0;
        f[2] = (p.n.wander ?? 0) * resolved.time;
        f[3] = p.n.strength ?? 0;
        f[4] = Math.max(0.001, p.n.radius ?? 60);
        f[5] = code(CLUSTER_ASSIGN_CODES, p.e.assign);
        break;
      case 'follow-path':
        f[0] = p.n.strength ?? 0;
        f[1] = p.n.tubeRadius ?? 0;
        f[2] = p.n.lookahead ?? 0.04;
        f[3] = p.e.direction === 'backward' ? -1 : 1;
        break;
    }
    fields.push({
      kind: code(OP_KIND_CODES, spec.kind),
      selection: spec.selection,
      f,
      v0,
      v1,
      path: spec.kind === 'follow-path' && spec.pathIndex >= 0 ? paths[spec.pathIndex] ?? null : null,
    });
  }

  const selections = toCpuSelections(resolved.selections);

  return {
    step: resolved.step,
    time: resolved.time,
    dt: resolved.dt,
    simTime: resolved.step * resolved.dt,
    maxSpeed: Math.max(0, sim.n.maxSpeed ?? 45),
    minSpeed: Math.max(0, Math.min(sim.n.minSpeed ?? 0, sim.n.maxSpeed ?? 45)),
    maxAcceleration: Math.max(0, sim.n.maxAcceleration ?? 120),
    turnRate: Math.max(0.01, sim.n.turnRate ?? 6),
    planar: sim.b.planar === true,
    planarAxis: code(PLANAR_AXIS_CODES, sim.e.planarAxis, 2),
    cellSize: resolved.cellSize,
    emitters: resolved.emitters.map(({ spec, p }) => ({
      offset: spec.offset,
      count: spec.count,
      shape: code(EMITTER_SHAPE_CODES, p.e.shape),
      birthMode: code(BIRTH_MODE_CODES, p.e.birthMode),
      group: spec.params.integers.group ?? 0,
      seed: spec.params.integers.seed ?? 1,
      center: vec(p.v.center),
      size: vec(p.v.size, [80, 80, 80]),
      stagger: Math.max(0, p.n.stagger ?? 0),
      activeFraction: Math.max(0, Math.min(1, p.n.activeFraction ?? 1)),
      lifetime: Math.max(0, p.n.lifetime ?? 0),
      lifetimeVariance: Math.max(0, Math.min(1, p.n.lifetimeVariance ?? 0)),
      respawn: p.b.respawn !== false,
      initialSpeed: p.n.initialSpeed ?? 0,
      direction: vec(p.v.direction, [0, 0, 1]),
      spread: Math.max(0, Math.min(1, p.n.spread ?? 1)),
    })),
    rules: rules.slice(0, 2),
    fields,
    selections,
    obstacles: resolved.obstacles.map(({ p }) => ({
      shape: code(OBSTACLE_SHAPE_CODES, p.e.shape),
      center: vec(p.v.center),
      size: vec(p.v.size, [25, 25, 25]),
      rotation: rotationMatrixDegrees(vec(p.v.rotation)),
      avoidDistance: Math.max(0, p.n.avoidDistance ?? 0),
      strength: Math.max(0, p.n.strength ?? 0),
    })),
    boundary: resolved.boundary
      ? {
          shape: code(BOUNDARY_SHAPE_CODES, resolved.boundary.p.e.shape),
          mode: code(BOUNDARY_MODE_CODES, resolved.boundary.p.e.mode),
          center: vec(resolved.boundary.p.v.center),
          size: vec(resolved.boundary.p.v.size, [160, 160, 160]),
          softness: Math.max(0.001, resolved.boundary.p.n.softness ?? 30),
          strength: Math.max(0, resolved.boundary.p.n.strength ?? 40),
        }
      : null,
  };
}
