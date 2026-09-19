import type { CablePoint } from './cablePhysics';

/** Positive Z points toward a virtual camera two composition heights away. */
export function projectCableDepth(point: CablePoint, aspect: number) {
  const z = point.z ?? 0;
  if (![point.x, point.y, z, aspect].every(Number.isFinite) || aspect <= 0) return null;
  // Preserve ordinary perspective up to Z=1, then smoothly approach 4x.
  // Long, wind-driven ropes must not disappear when a node passes the camera.
  const depth = z <= 1 ? z : 1 + 0.5 * (1 - Math.exp(-2 * (z - 1)));
  const scale = 2 / (2 - depth);
  return { x: 0.5 + (point.x / aspect - 0.5) * scale, y: 0.5 + (point.y - 0.5) * scale, scale };
}
/** Deterministic gusts, independent of playback order and frame scheduling. */
export function cableWindAtTime(strength: number, gusts: number, time: number): number {
  const variation = (Math.sin(time * Math.PI * 1.2) + 0.35 * Math.sin(time * Math.PI * 2.7)) / 1.35;
  return strength * (1 + gusts * variation);
}
