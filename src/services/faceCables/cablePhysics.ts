export interface CablePoint { x: number; y: number; z?: number }
export const CABLE_NODES = 25;
export const MAX_CABLE_SEGMENTS = 96;
export interface CablePhysicsOptions { lockFrom?: boolean; lockTo?: boolean; stiffness?: number; viscosity?: number; windX?: number; windY?: number; windZ?: number; contact?: (p: CablePoint, previous: CablePoint, radius: number) => void; radius?: number }
export interface CableState { points: CablePoint[]; previous: CablePoint[]; length: number }

export function createCable(a: CablePoint, b: CablePoint, length: number, segments = CABLE_NODES - 1): CableState {
  const count = Math.max(4, Math.min(MAX_CABLE_SEGMENTS, Math.round(segments))) + 1;
  const points = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), sag = Math.sin(t * Math.PI);
    return { x: a.x + (b.x - a.x) * t - sag * length * 0.18,
      y: a.y + (b.y - a.y) * t + sag * length * 0.3,
      ...(a.z !== undefined || b.z !== undefined ? { z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t } : {}) };
  });
  return { points, previous: points.map(p => ({ ...p })), length };
}

/** Position-based rope with pinned ends, in composition-height units. */
export function stepCable(state: CableState, a: CablePoint, b: CablePoint, dt: number, gravity: number, damping: number, options: CablePhysicsOptions = {}): void {
  const p = state.points, old = state.previous, last = p.length - 1;
  const lockFrom = options.lockFrom ?? true, lockTo = options.lockTo ?? true;
  const stiffness = Math.max(0, Math.min(1, options.stiffness ?? 0));
  const weight = (i: number) => (i === 0 && lockFrom) || (i === last && lockTo) ? 0 : 1;
  const decay = Math.exp(-(damping + Math.max(0, Math.min(1, options.viscosity ?? 0)) * 18) * dt);
  for (let i = 0; i <= last; i++) {
    if (!weight(i)) continue;
    const x = p[i].x, y = p[i].y, z = p[i].z ?? 0;
    p[i].x += (x - old[i].x) * decay + (options.windX ?? 0) * dt * dt;
    p[i].y += (y - old[i].y) * decay + (gravity + (options.windY ?? 0)) * dt * dt;
    const nextZ = z + (z - (old[i].z ?? 0)) * decay + (options.windZ ?? 0) * dt * dt;
    if (nextZ || p[i].z !== undefined) p[i].z = nextZ;
    old[i] = { x, y, ...(z || p[i].z !== undefined ? { z } : {}) };
  }
  const segment = Math.max(state.length, (lockFrom && lockTo ? Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)) * 1.002 : 0)) / last;
  const pin = () => { if (lockFrom) p[0] = { ...a }; if (lockTo) p[last] = { ...b }; };
  const constrain = (i: number, j: number, rest: number, strength: number, tensionOnly = false) => {
    const dx = p[j].x - p[i].x, dy = p[j].y - p[i].y, dz = (p[j].z ?? 0) - (p[i].z ?? 0);
    const distance = Math.hypot(dx, dy, dz);
    const wa = weight(i), wb = weight(j);
    if (distance < 1e-10 || wa + wb === 0 || (tensionOnly && distance <= rest)) return;
    const correction = (distance - rest) / distance / (wa + wb) * strength;
    p[i].x += dx * correction * wa; p[i].y += dy * correction * wa;
    if (dz) {
      if (wa) p[i].z = (p[i].z ?? 0) + dz * correction * wa;
      if (wb) p[j].z = (p[j].z ?? 0) - dz * correction * wb;
    }
    p[j].x -= dx * correction * wb; p[j].y -= dy * correction * wb;
  };
  pin();
  const iterations = Math.max(24, last);
  // Longer-range constraints resist bending; segment constraints retain rope length.
  const bendStrength = 1 - Math.pow(1 - stiffness * 0.9, 1 / iterations);
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (stiffness) for (let i = 0; i < last - 1; i++) constrain(i, i + 2, segment * 2, bendStrength);
    for (let j = 0; j < last; j++) {
      const i = iteration % 2 ? last - 1 - j : j;
      // Rope segments pull under tension; they cannot push like rigid rods.
      // Compression during length animation otherwise creates alternating kinks.
      constrain(i, i + 1, segment, 1, true);
    }
    pin();
    if (options.contact) for (let i = 0; i <= last; i++) {
      if (weight(i)) options.contact(p[i], old[i], options.radius ?? 0.002);
    }
  }
  if (lockFrom) old[0] = { ...a }; if (lockTo) old[last] = { ...b };
}
