import type { FlockBranchSpec, FlockEmitterSpec, FlockResolvedNode, FlockResolvedRender } from '../../../services/flock/compiler/flockProgramTypes';
import type { FlockVec3 } from '../../../types/flock';

/**
 * Key light and shadow-map framing for flock scenes. A Room branch defines the
 * light; lit points alone use a default top-front light. The shadow camera is
 * orthographic in simulation space and frames the room (or the emitters with a
 * margin for motion), so shading and shadow lookups share one space.
 */

export const FLOCK_SHADOW_MAP_SIZE = 2048;
export const LIGHT_PARAMS_FLOATS = 24;

const DEFAULT_LIGHT_DIRECTION: FlockVec3 = [-0.35, 0.8, 0.55];
const EMITTER_MARGIN = 1.6;

export interface FlockLightSetup {
  enabled: boolean;
  directionSim: FlockVec3;
  ambient: number;
  shadowStrength: number;
  boundsMin: FlockVec3;
  boundsMax: FlockVec3;
}

function normalize(v: FlockVec3): FlockVec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-9 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 1, 0];
}

function cross(a: FlockVec3, b: FlockVec3): FlockVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: FlockVec3, b: FlockVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function findRoomBranch(render: FlockResolvedRender): FlockResolvedNode<FlockBranchSpec> | undefined {
  return render.branches.find((branch) => branch.spec.kind === 'room');
}

function emitterBounds(emitters: FlockEmitterSpec[]): { min: FlockVec3; max: FlockVec3 } {
  const min: FlockVec3 = [Infinity, Infinity, Infinity];
  const max: FlockVec3 = [-Infinity, -Infinity, -Infinity];
  for (const emitter of emitters) {
    const center = emitter.params.vectors.center?.base ?? [0, 0, 0];
    const size = emitter.params.vectors.size?.base ?? [80, 80, 80];
    const reach = Math.max(size[0], size[1], size[2]) * 0.5 * EMITTER_MARGIN;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], center[axis] - reach);
      max[axis] = Math.max(max[axis], center[axis] + reach);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [-100, -100, -100], max: [100, 100, 100] };
  return { min, max };
}

export function resolveFlockLight(render: FlockResolvedRender, emitters: FlockEmitterSpec[]): FlockLightSetup {
  const room = findRoomBranch(render);
  const litPoints = render.branches.some((branch) => branch.spec.kind === 'points' && branch.p.e.shading === 'lit');
  if (room) {
    const center = room.p.v.center ?? [0, 0, -60];
    const size = room.p.v.size ?? [360, 210, 150];
    const frame = Math.max(0, room.p.n.frame ?? 0);
    return {
      enabled: room.p.b.shadows !== false || litPoints,
      directionSim: normalize(room.p.v.lightDirection ?? DEFAULT_LIGHT_DIRECTION),
      ambient: room.p.n.ambient ?? 0.45,
      shadowStrength: room.p.b.shadows === false ? 0 : room.p.n.shadowStrength ?? 0.75,
      boundsMin: [center[0] - size[0] / 2 - frame, center[1] - size[1] / 2 - frame, center[2] - size[2] / 2],
      boundsMax: [center[0] + size[0] / 2 + frame, center[1] + size[1] / 2 + frame, center[2] + size[2] / 2 + size[2]],
    };
  }
  const bounds = emitterBounds(emitters);
  return {
    enabled: litPoints,
    directionSim: normalize(DEFAULT_LIGHT_DIRECTION),
    ambient: 0.45,
    shadowStrength: 0.7,
    boundsMin: bounds.min,
    boundsMax: bounds.max,
  };
}

/** Column-major orthographic light view-projection (simulation space -> clip, depth 0..1). */
export function flockLightViewProj(light: FlockLightSetup): Float32Array {
  const d = light.directionSim;
  const center: FlockVec3 = [
    (light.boundsMin[0] + light.boundsMax[0]) / 2,
    (light.boundsMin[1] + light.boundsMax[1]) / 2,
    (light.boundsMin[2] + light.boundsMax[2]) / 2,
  ];
  const helper: FlockVec3 = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const right = normalize(cross(helper, d));
  const up = cross(d, right);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (let corner = 0; corner < 8; corner += 1) {
    const p: FlockVec3 = [
      corner & 1 ? light.boundsMax[0] : light.boundsMin[0],
      corner & 2 ? light.boundsMax[1] : light.boundsMin[1],
      corner & 4 ? light.boundsMax[2] : light.boundsMin[2],
    ];
    const rel: FlockVec3 = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    const x = dot(rel, right); const y = dot(rel, up); const z = dot(rel, d);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const sx = 2 / Math.max(maxX - minX, 1e-3);
  const sy = 2 / Math.max(maxY - minY, 1e-3);
  // Points closer to the light (larger z along d) get smaller depth.
  const sz = 1 / Math.max(maxZ - minZ, 1e-3);
  const tx = -(minX + maxX) / 2;
  const ty = -(minY + maxY) / 2;
  const m = new Float32Array(16);
  // x' = sx * (dot(p - c, right) + tx), y' = sy * (dot(p - c, up) + ty), z' = (maxZ - dot(p - c, d)) * sz
  const cx = dot(center, right); const cy = dot(center, up); const cz = dot(center, d);
  m[0] = sx * right[0]; m[4] = sx * right[1]; m[8] = sx * right[2]; m[12] = sx * (tx - cx);
  m[1] = sy * up[0]; m[5] = sy * up[1]; m[9] = sy * up[2]; m[13] = sy * (ty - cy);
  m[2] = -sz * d[0]; m[6] = -sz * d[1]; m[10] = -sz * d[2]; m[14] = sz * (maxZ + cz);
  m[15] = 1;
  return m;
}

function transformDirection(world: Float32Array, v: FlockVec3): FlockVec3 {
  return normalize([
    world[0] * v[0] + world[4] * v[1] + world[8] * v[2],
    world[1] * v[0] + world[5] * v[1] + world[9] * v[2],
    world[2] * v[0] + world[6] * v[1] + world[10] * v[2],
  ]);
}

/** Writes `LightParams` (see flockRenderCommonWgsl.ts) at float offset `o`. */
export function packFlockLight(f: Float32Array, o: number, light: FlockLightSetup, world: Float32Array): void {
  f.set(flockLightViewProj(light), o);
  const dir = transformDirection(world, light.directionSim);
  f[o + 16] = dir[0];
  f[o + 17] = dir[1];
  f[o + 18] = dir[2];
  f[o + 19] = light.enabled ? 1 : 0;
  f[o + 20] = light.ambient;
  f[o + 21] = light.shadowStrength;
  f[o + 22] = 1 / FLOCK_SHADOW_MAP_SIZE;
  f[o + 23] = 0.002;
}
