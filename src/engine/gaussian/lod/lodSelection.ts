import type { SplatGraphOperation } from '../../../types/splatGraph';

/**
 * Level-of-detail choice for streamed splat packages, modelled on PlayCanvas' streamed LOD:
 * level k covers distances from 3^(k-1) to 3^k (in units of a global distance scale), leaves behind
 * the camera count as `behindPenalty` times farther, and the scale is searched so the chosen levels
 * fill the splat budget as closely as possible without exceeding it.
 */
export interface LodLeafView {
  /** Distance from the camera to the (displaced) leaf, in scan-local units. */
  distance: number;
  /** Splats per level; 0 where the leaf has no splats on that level. */
  counts: readonly number[];
}

export function lodLevelForDistance(distance: number, scale: number, levels: number): number {
  const d = distance * scale;
  if (!(d >= 1)) return 0;
  return Math.min(levels - 1, Math.floor(Math.log(d) / Math.log(3)) + 1);
}

/** Per-leaf levels plus whether even the coarsest level overflows the budget. */
export function selectLodLevels(leaves: readonly LodLeafView[], levels: number, budget: number) {
  const total = (scale: number) => leaves.reduce((sum, leaf) => sum + leaf.counts[lodLevelForDistance(leaf.distance, scale, levels)], 0);
  const pick = (scale: number) => Int8Array.from(leaves, leaf => lodLevelForDistance(leaf.distance, scale, levels));
  if (total(1e-9) <= budget) return { levels: pick(1e-9), overBudget: false, splats: total(1e-9) };
  let lo = Math.log(1e-9); let hi = Math.log(1e9);
  if (total(Math.exp(hi)) > budget) return { levels: pick(Math.exp(hi)), overBudget: true, splats: total(Math.exp(hi)) };
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (total(Math.exp(mid)) <= budget) hi = mid; else lo = mid;
  }
  return { levels: pick(Math.exp(hi)), overBudget: false, splats: total(Math.exp(hi)) };
}

/**
 * CPU mirror of the graph operations that relocate whole regions (Conveyor wrap and Ring Bend), so
 * detail follows the content to where it is drawn. Particles, noise and Release flights are local
 * motion and keep the source position.
 */
export function displaceLodPoint(point: [number, number, number], operations: readonly SplatGraphOperation[], time: number): [number, number, number] {
  const p: [number, number, number] = [point[0], point[1], point[2]];
  for (const op of operations) {
    const v = op.values;
    if (op.kind === 'conveyor') {
      const axis = Math.min(Math.max(Math.trunc(v[0]), 0), 2); const span = Math.max(v[3], 0.0001);
      const shifted = p[axis] - v[2] + time * v[1] + (v[4] ?? 0);
      p[axis] = v[2] + shifted - Math.floor(shifted / span) * span;
    } else if (op.kind === 'ring-bend') {
      const axis = Math.min(Math.max(Math.trunc(v[0]), 0), 2); const bend = Math.min(Math.max(v[5] ?? 1, 0), 1);
      if (v[2] === 0 || bend <= 0 || axis === 1) continue;
      const radius = Math.abs(v[2]) / Math.max(bend, 0.0001); const up = Math.sign(v[2]);
      const theta = (p[axis] - v[1]) / radius; const r = radius - (p[1] - v[3]) * up;
      p[axis] = v[1] + r * Math.sin(theta); p[1] = v[3] + up * (radius - r * Math.cos(theta));
    }
  }
  return p;
}

/** Camera position and forward direction in the scan's local space. */
export function localCamera(viewMatrix: Float32Array, inverseWorld: Float32Array) {
  const v = viewMatrix;
  const eye = [-(v[0] * v[12] + v[1] * v[13] + v[2] * v[14]), -(v[4] * v[12] + v[5] * v[13] + v[6] * v[14]), -(v[8] * v[12] + v[9] * v[13] + v[10] * v[14])];
  const forward = [-v[2], -v[6], -v[10]];
  const m = inverseWorld;
  const position: [number, number, number] = [0, 1, 2].map(r => m[r] * eye[0] + m[4 + r] * eye[1] + m[8 + r] * eye[2] + m[12 + r]) as [number, number, number];
  const dir = [0, 1, 2].map(r => m[r] * forward[0] + m[4 + r] * forward[1] + m[8 + r] * forward[2]);
  const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return { position, forward: dir.map(c => c / length) as [number, number, number] };
}

/** Distance used for the level choice: to the leaf's sphere, with leaves behind the camera penalised. */
export function lodLeafDistance(center: readonly number[], radius: number, camera: ReturnType<typeof localCamera>, behindPenalty = 5): number {
  const dx = center[0] - camera.position[0]; const dy = center[1] - camera.position[1]; const dz = center[2] - camera.position[2];
  const distance = Math.max(Math.hypot(dx, dy, dz) - radius, 0.0001);
  const ahead = dx * camera.forward[0] + dy * camera.forward[1] + dz * camera.forward[2];
  return ahead < -radius ? distance * behindPenalty : distance;
}
