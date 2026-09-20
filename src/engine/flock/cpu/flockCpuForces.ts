import { windForce } from '../../../services/operators/wind';
import {
  FLOCK_PARTICLE_STRIDE,
  P_AGE,
  P_GROUP,
  P_POS,
  P_RND,
  P_VEL,
} from '../../../services/flock/compiler/flockProgramTypes';
import { flockHash01 } from '../../../services/flock/compiler/flockCompilerSupport';
import {
  FLOCK_PATH_SAMPLES,
  evaluatePath,
  falloffWeight,
  isClosedPath,
  rotateInverse,
  rotate,
  valueNoise1,
  valueNoise3,
  type Vec3,
} from '../shared/flockMath';
import type { CpuBoundary, CpuFieldOp, CpuObstacle, CpuSelection, CpuStepParams } from './flockCpuStepParams';

/** Evaluates every selection for particle `index` into `out` (in index order; combine reads earlier entries). */
export function evaluateSelections(
  selections: CpuSelection[],
  state: Float32Array,
  index: number,
  out: Uint8Array,
): void {
  const base = index * FLOCK_PARTICLE_STRIDE;
  for (let s = 0; s < selections.length; s += 1) {
    const selection = selections[s];
    let selected = false;
    switch (selection.kind) {
      case 1:
        selected = state[base + P_GROUP] === selection.f[0];
        break;
      case 2:
        selected = flockHash01(index, selection.f[1]) < selection.f[0];
        break;
      case 3: {
        const dx = state[base + P_POS] - selection.v0[0];
        const dy = state[base + P_POS + 1] - selection.v0[1];
        const dz = state[base + P_POS + 2] - selection.v0[2];
        selected = selection.shape === 1
          ? Math.abs(dx) <= selection.v1[0] * 0.5 && Math.abs(dy) <= selection.v1[1] * 0.5 && Math.abs(dz) <= selection.v1[2] * 0.5
          : dx * dx + dy * dy + dz * dz <= selection.v1[0] * selection.v1[0];
        break;
      }
      case 4: {
        const vx = state[base + P_VEL];
        const vy = state[base + P_VEL + 1];
        const vz = state[base + P_VEL + 2];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        selected = speed >= selection.f[0] && speed <= selection.f[1];
        break;
      }
      case 5: {
        const age = state[base + P_AGE];
        selected = age >= selection.f[0] && age <= selection.f[1];
        break;
      }
      case 6: {
        const a = selection.a >= 0 && selection.a < s ? out[selection.a] === 1 : false;
        const b = selection.b >= 0 && selection.b < s ? out[selection.b] === 1 : false;
        selected = selection.f[0] === 1 ? a || b : selection.f[0] === 2 ? a !== b : a && b;
        break;
      }
    }
    out[s] = (selected !== selection.invert) ? 1 : 0;
  }
}

function nearestPathPoint(op: CpuFieldOp, x: number, y: number, z: number): { point: Vec3; u: number } {
  const path = op.path!;
  let bestU = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestPoint: Vec3 = path.center;
  const closed = isClosedPath(path.shape);
  const sampleCount = closed ? FLOCK_PATH_SAMPLES : FLOCK_PATH_SAMPLES + 1;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const u = sample / FLOCK_PATH_SAMPLES;
    const point = evaluatePath(path, u);
    const dx = point[0] - x;
    const dy = point[1] - y;
    const dz = point[2] - z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestU = u;
      bestPoint = point;
    }
  }
  return { point: bestPoint, u: bestU };
}

/** Adds all non-neighbor forces for one particle to `acc`. */
export function accumulateFieldForces(
  params: CpuStepParams,
  state: Float32Array,
  index: number,
  selected: Uint8Array,
  acc: Float64Array,
): void {
  const base = index * FLOCK_PARTICLE_STRIDE;
  const px = state[base + P_POS];
  const py = state[base + P_POS + 1];
  const pz = state[base + P_POS + 2];
  const vx = state[base + P_VEL];
  const vy = state[base + P_VEL + 1];
  const vz = state[base + P_VEL + 2];
  const rnd = state[base + P_RND];

  for (const op of params.fields) {
    if (op.selection >= 0 && selected[op.selection] !== 1) continue;
    const f = op.f;
    switch (op.kind) {
      case 2: {
        const dx = op.v0[0] - px;
        const dy = op.v0[1] - py;
        const dz = op.v0[2] - pz;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < 1e-5) break;
        const weight = falloffWeight(f[2], distance / f[1]) * f[0] * f[3] / distance;
        acc[0] += dx * weight;
        acc[1] += dy * weight;
        acc[2] += dz * weight;
        break;
      }
      case 3: {
        const rx = px - op.v0[0];
        const ry = py - op.v0[1];
        const rz = pz - op.v0[2];
        const along = rx * op.v1[0] + ry * op.v1[1] + rz * op.v1[2];
        const qx = rx - op.v1[0] * along;
        const qy = ry - op.v1[1] * along;
        const qz = rz - op.v1[2] * along;
        const radial = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (radial < 1e-5) break;
        const weight = falloffWeight(f[3], radial / f[1]) * f[0];
        if (weight === 0) break;
        // tangent = axis x radial
        const tx = op.v1[1] * qz - op.v1[2] * qy;
        const ty = op.v1[2] * qx - op.v1[0] * qz;
        const tz = op.v1[0] * qy - op.v1[1] * qx;
        const tangentLength = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        acc[0] += (tx / tangentLength) * weight - (qx / radial) * f[2] * weight;
        acc[1] += (ty / tangentLength) * weight - (qy / radial) * f[2] * weight;
        acc[2] += (tz / tangentLength) * weight - (qz / radial) * f[2] * weight;
        break;
      }
      case 4: {
        const x = px * f[1] + f[2];
        const y = py * f[1];
        const z = pz * f[1];
        acc[0] += (valueNoise3(x, y, z, 1) * 2 - 1) * f[0];
        acc[1] += (valueNoise3(x, y, z, 2) * 2 - 1) * f[0];
        acc[2] += (valueNoise3(x, y, z, 3) * 2 - 1) * f[0];
        break;
      }
      case 5:
        acc[0] -= vx * f[0];
        acc[1] -= vy * f[0];
        acc[2] -= vz * f[0];
        break;
      case 6: {
        const force = windForce(op.v0, f[0], f[1], valueNoise1(f[2] * 0.5 + rnd * 10, 7) * 2 - 1, true);
        acc[0] += force[0]; acc[1] += force[1]; acc[2] += force[2];
        break;
      }
      case 7: {
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (speed < 1e-5) break;
        const scale = ((f[0] - speed) * f[1]) / speed;
        acc[0] += vx * scale;
        acc[1] += vy * scale;
        acc[2] += vz * scale;
        break;
      }
      case 8: {
        const clusterCount = f[0];
        const cluster = f[5] === 1
          ? state[base + P_GROUP] % clusterCount
          : Math.floor(rnd * clusterCount);
        const ax = op.v0[0] + f[1] * (valueNoise1(f[2] + cluster * 13.1, 11) * 2 - 1);
        const ay = op.v0[1] + f[1] * (valueNoise1(f[2] + cluster * 7.7 + 50, 12) * 2 - 1);
        const az = op.v0[2] + f[1] * (valueNoise1(f[2] + cluster * 3.3 + 100, 13) * 2 - 1);
        const dx = ax - px;
        const dy = ay - py;
        const dz = az - pz;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < 1e-5) break;
        const weight = (f[3] * Math.min(1, distance / f[4])) / distance;
        acc[0] += dx * weight;
        acc[1] += dy * weight;
        acc[2] += dz * weight;
        break;
      }
      case 9: {
        if (!op.path) break;
        const nearest = nearestPathPoint(op, px, py, pz);
        const ahead = evaluatePath(op.path, nearest.u + f[2] * f[3]);
        const tx = ahead[0] - nearest.point[0];
        const ty = ahead[1] - nearest.point[1];
        const tz = ahead[2] - nearest.point[2];
        const tangentLength = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tangentLength > 1e-5) {
          acc[0] += (tx / tangentLength) * f[0];
          acc[1] += (ty / tangentLength) * f[0];
          acc[2] += (tz / tangentLength) * f[0];
        }
        const dx = nearest.point[0] - px;
        const dy = nearest.point[1] - py;
        const dz = nearest.point[2] - pz;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance > f[1] && distance > 1e-5) {
          const pull = (f[0] * Math.min(2, (distance - f[1]) / Math.max(f[1], 1))) / distance;
          acc[0] += dx * pull;
          acc[1] += dy * pull;
          acc[2] += dz * pull;
        }
        break;
      }
    }
  }
}

export interface SignedDistance {
  distance: number;
  normal: Vec3;
}

export function obstacleDistance(obstacle: CpuObstacle, x: number, y: number, z: number): SignedDistance {
  const [lx, ly, lz] = rotateInverse(obstacle.rotation, x - obstacle.center[0], y - obstacle.center[1], z - obstacle.center[2]);
  let distance: number;
  let local: Vec3;
  switch (obstacle.shape) {
    case 1: {
      const hx = obstacle.size[0] * 0.5;
      const hy = obstacle.size[1] * 0.5;
      const hz = obstacle.size[2] * 0.5;
      const qx = Math.abs(lx) - hx;
      const qy = Math.abs(ly) - hy;
      const qz = Math.abs(lz) - hz;
      const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2);
      distance = outside + Math.min(Math.max(qx, qy, qz), 0);
      if (qx >= qy && qx >= qz) local = [Math.sign(lx) || 1, 0, 0];
      else if (qy >= qz) local = [0, Math.sign(ly) || 1, 0];
      else local = [0, 0, Math.sign(lz) || 1];
      if (outside > 0) {
        local = [Math.max(qx, 0) * (Math.sign(lx) || 1), Math.max(qy, 0) * (Math.sign(ly) || 1), Math.max(qz, 0) * (Math.sign(lz) || 1)];
      }
      break;
    }
    case 2: {
      const half = obstacle.size[1] * 0.5;
      const cy = Math.max(-half, Math.min(half, ly));
      const dx = lx;
      const dy = ly - cy;
      const dz = lz;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      distance = length - obstacle.size[0];
      local = length > 1e-6 ? [dx, dy, dz] : [1, 0, 0];
      break;
    }
    case 3:
      distance = ly;
      local = [0, 1, 0];
      break;
    default: {
      const length = Math.sqrt(lx * lx + ly * ly + lz * lz);
      distance = length - obstacle.size[0];
      local = length > 1e-6 ? [lx, ly, lz] : [0, 1, 0];
    }
  }
  const world = rotate(obstacle.rotation, local[0], local[1], local[2]);
  const normalLength = Math.sqrt(world[0] * world[0] + world[1] * world[1] + world[2] * world[2]) || 1;
  return { distance, normal: [world[0] / normalLength, world[1] / normalLength, world[2] / normalLength] };
}

/** Soft steering away from obstacles plus contain-boundary pressure. */
export function accumulateAvoidance(params: CpuStepParams, x: number, y: number, z: number, acc: Float64Array): void {
  for (const obstacle of params.obstacles) {
    if (obstacle.avoidDistance <= 0) continue;
    const { distance, normal } = obstacleDistance(obstacle, x, y, z);
    if (distance >= obstacle.avoidDistance) continue;
    const weight = obstacle.strength * (1 - Math.max(0, distance) / obstacle.avoidDistance);
    acc[0] += normal[0] * weight;
    acc[1] += normal[1] * weight;
    acc[2] += normal[2] * weight;
  }
  const boundary = params.boundary;
  if (boundary && boundary.mode === 0) {
    const excess = boundaryExcess(boundary, x, y, z);
    if (excess.amount > 0) {
      const weight = boundary.strength * Math.min(4, excess.amount / boundary.softness);
      acc[0] -= excess.direction[0] * weight;
      acc[1] -= excess.direction[1] * weight;
      acc[2] -= excess.direction[2] * weight;
    }
  }
}

function boundaryExcess(boundary: CpuBoundary, x: number, y: number, z: number): { amount: number; direction: Vec3 } {
  const dx = x - boundary.center[0];
  const dy = y - boundary.center[1];
  const dz = z - boundary.center[2];
  if (boundary.shape === 1) {
    const ex = Math.abs(dx) - (boundary.size[0] * 0.5 - boundary.softness);
    const ey = Math.abs(dy) - (boundary.size[1] * 0.5 - boundary.softness);
    const ez = Math.abs(dz) - (boundary.size[2] * 0.5 - boundary.softness);
    const amount = Math.max(ex, ey, ez, 0);
    const direction: Vec3 = [ex > 0 ? Math.sign(dx) : 0, ey > 0 ? Math.sign(dy) : 0, ez > 0 ? Math.sign(dz) : 0];
    return { amount, direction };
  }
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const amount = radius - (boundary.size[0] - boundary.softness);
  return { amount, direction: radius > 1e-6 ? [dx / radius, dy / radius, dz / radius] : [0, 1, 0] };
}

/**
 * Hard constraints after integration: obstacle push-out and boundary wrap /
 * reflect / kill. Returns false when the particle must die.
 */
export function applyHardConstraints(params: CpuStepParams, position: Float64Array, velocity: Float64Array): boolean {
  for (const obstacle of params.obstacles) {
    const { distance, normal } = obstacleDistance(obstacle, position[0], position[1], position[2]);
    if (distance >= 0) continue;
    position[0] -= normal[0] * distance;
    position[1] -= normal[1] * distance;
    position[2] -= normal[2] * distance;
    const inward = velocity[0] * normal[0] + velocity[1] * normal[1] + velocity[2] * normal[2];
    if (inward < 0) {
      velocity[0] -= normal[0] * inward * 1.5;
      velocity[1] -= normal[1] * inward * 1.5;
      velocity[2] -= normal[2] * inward * 1.5;
    }
  }
  const boundary = params.boundary;
  if (!boundary || boundary.mode === 0) return true;
  const dx = position[0] - boundary.center[0];
  const dy = position[1] - boundary.center[1];
  const dz = position[2] - boundary.center[2];
  if (boundary.shape === 1) {
    const half = [boundary.size[0] * 0.5, boundary.size[1] * 0.5, boundary.size[2] * 0.5];
    const offsets = [dx, dy, dz];
    for (let axis = 0; axis < 3; axis += 1) {
      const h = half[axis];
      if (Math.abs(offsets[axis]) <= h) continue;
      if (boundary.mode === 3) return false;
      if (boundary.mode === 1) {
        const span = h * 2;
        offsets[axis] = ((((offsets[axis] + h) % span) + span) % span) - h;
      } else {
        offsets[axis] = Math.sign(offsets[axis]) * h;
        velocity[axis] = -velocity[axis];
      }
      position[axis] = boundary.center[axis] + offsets[axis];
    }
    return true;
  }
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const limit = boundary.size[0];
  if (radius <= limit) return true;
  if (boundary.mode === 3) return false;
  const nx = dx / radius;
  const ny = dy / radius;
  const nz = dz / radius;
  if (boundary.mode === 1) {
    position[0] = boundary.center[0] - nx * limit * 0.98;
    position[1] = boundary.center[1] - ny * limit * 0.98;
    position[2] = boundary.center[2] - nz * limit * 0.98;
    return true;
  }
  position[0] = boundary.center[0] + nx * limit;
  position[1] = boundary.center[1] + ny * limit;
  position[2] = boundary.center[2] + nz * limit;
  const outward = velocity[0] * nx + velocity[1] * ny + velocity[2] * nz;
  if (outward > 0) {
    velocity[0] -= 2 * outward * nx;
    velocity[1] -= 2 * outward * ny;
    velocity[2] -= 2 * outward * nz;
  }
  return true;
}
