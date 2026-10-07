/**
 * Pure, deterministic math behind the Smooth Noise, Envelope, Marker Trigger and Two-Bone IK
 * control sources. Every result is a function of its arguments only: no clock, no state.
 */

function hash01(index: number, seed: number): number {
  let h = Math.imul(index | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = hash01(i, seed) * 2 - 1, b = hash01(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

/** Smooth value noise in [-1, 1]; extra octaves add finer detail at half the amplitude each. */
export function smoothNoise(x: number, seed = 0, octaves = 1): number {
  const count = Math.max(1, Math.min(4, Math.round(octaves)));
  let sum = 0, norm = 0, amplitude = 1, frequency = 1;
  for (let octave = 0; octave < count; octave++) {
    sum += amplitude * valueNoise(x * frequency, Math.round(seed) + octave * 1013);
    norm += amplitude; amplitude *= 0.5; frequency *= 2;
  }
  return sum / norm;
}

export type EnvelopeCurve = 'exponential' | 'linear';

/** Attack-hold-decay pulse in [0, 1] for a trigger that happened `age` seconds ago. */
export function envelopeValue(age: number, attack: number, hold: number, decay: number, curve: EnvelopeCurve): number {
  if (!(age >= 0)) return 0;
  if (attack > 0 && age < attack) return age / attack;
  const sustained = age - attack;
  if (sustained < hold) return 1;
  if (decay <= 0) return 0;
  const elapsed = sustained - hold;
  // Exponential decay reaches about 0.7 % at the end of Decay.
  return curve === 'linear' ? Math.max(0, 1 - elapsed / decay) : Math.exp(-5 * elapsed / decay);
}

export interface MarkerSample { time: number; label: string }
export type MarkerTriggerMode = 'since' | 'until' | 'count' | 'progress';

/**
 * Timing derived from the markers matching `label` (all markers when empty). A marker at
 * exactly `time` counts as passed. Missing previous/next markers yield -1 for since/until.
 */
export function markerTriggerValue(markers: readonly MarkerSample[], time: number, label: string, mode: MarkerTriggerMode): number {
  let previous = -Infinity, next = Infinity, count = 0;
  for (const marker of markers) {
    if (label && marker.label !== label) continue;
    if (!Number.isFinite(marker.time)) continue;
    if (marker.time <= time) { count++; if (marker.time > previous) previous = marker.time; }
    else if (marker.time < next) next = marker.time;
  }
  switch (mode) {
    case 'since': return previous === -Infinity ? -1 : time - previous;
    case 'until': return next === Infinity ? -1 : next - time;
    case 'count': return count;
    case 'progress':
      if (previous === -Infinity) return 0;
      if (next === Infinity) return 1;
      return (time - previous) / (next - previous);
  }
}

export interface TwoBoneIkResult {
  /** Absolute direction of the first bone, degrees. */
  angle1: number;
  /** Direction of the second bone relative to the first, degrees in (-180, 180]. */
  angle2: number;
  jointX: number; jointY: number;
  endX: number; endY: number;
  /** Target distance divided by the full chain length, capped at 1. */
  reach: number;
}

const DEG = 180 / Math.PI;
const wrapDegrees = (value: number) => { const wrapped = ((value + 180) % 360 + 360) % 360 - 180; return wrapped === -180 ? 180 : wrapped; };

/**
 * Analytic two-bone IK. Angles follow the parenting convention: a bone at angle θ points along
 * (cos θ, sin θ) in the input space. `aspect` scales X into an isotropic space first (1 keeps the
 * input space, matching parenting in stored transform units). Out-of-reach targets stretch the
 * chain straight toward the target; targets inside the minimum reach fold it.
 */
export function solveTwoBoneIk(rootX: number, rootY: number, targetX: number, targetY: number,
  length1: number, length2: number, bend: 1 | -1, aspect = 1): TwoBoneIkResult {
  if (!(length1 > 0) || !(length2 > 0)) throw new Error('Bone lengths must be greater than zero.');
  if (!(aspect > 0)) throw new Error('X scale must be greater than zero.');
  const dx = (targetX - rootX) * aspect, dy = targetY - rootY;
  const distance = Math.hypot(dx, dy), maxReach = length1 + length2;
  const reach = Math.min(1, distance / maxReach);
  const d = Math.min(Math.max(distance, Math.abs(length1 - length2)), maxReach);
  const base = distance > 0 ? Math.atan2(dy, dx) : 0;
  const cosA = d > 0 ? (length1 * length1 + d * d - length2 * length2) / (2 * length1 * d) : 1;
  const a1 = base + bend * Math.acos(Math.max(-1, Math.min(1, cosA)));
  const jx = Math.cos(a1) * length1, jy = Math.sin(a1) * length1;
  const ex = Math.cos(base) * d, ey = Math.sin(base) * d;
  const a2 = Math.atan2(ey - jy, ex - jx);
  return {
    angle1: a1 * DEG, angle2: wrapDegrees((a2 - a1) * DEG),
    jointX: rootX + jx / aspect, jointY: rootY + jy,
    endX: rootX + ex / aspect, endY: rootY + ey, reach,
  };
}

export interface BallisticState {
  x: number; y: number;
  vx: number; vy: number;
  /** Floor impacts so far. */
  bounces: number;
  /** 1 once the body lies on the floor, else 0. */
  resting: number;
  /** Seconds after launch of the first floor contact (Infinity while it has none). */
  firstImpact: number;
}

const MAX_BOUNCES = 64;

/**
 * Projectile under constant gravity along +y, as a pure function of the time since launch.
 * With a floor, impacts are solved analytically: each keeps `bounce` of the vertical and `slide`
 * of the horizontal speed; the body rests once a hop becomes negligible. Gravity pulls toward
 * +y for positive values (screen down in clip transform units), so the floor is crossed in the
 * direction gravity points. Before launch the start state holds.
 */
export function ballisticState(time: number, x: number, y: number, vx: number, vy: number,
  gravity: number, floor: number | null, bounce = 0.5, slide = 1): BallisticState {
  if (!(time > 0)) return { x, y, vx, vy, bounces: 0, resting: 0, firstImpact: Infinity };
  const flight = (t: number) => ({ x: x + vx * t, y: y + vy * t + 0.5 * gravity * t * t, vx, vy: vy + gravity * t });
  if (floor === null || gravity === 0) return { ...flight(time), bounces: 0, resting: 0, firstImpact: Infinity };
  const side = Math.sign(gravity), restitution = Math.max(0, Math.min(1, bounce)), keep = Math.max(0, Math.min(1, slide));
  // A start below the floor is lifted onto it.
  if ((y - floor) * side > 0) y = floor;
  let elapsed = 0, bounces = 0, firstImpact = Infinity;
  while (bounces <= MAX_BOUNCES) {
    const discriminant = Math.max(0, vy * vy - 2 * gravity * (y - floor));
    const impact = (-vy + side * Math.sqrt(discriminant)) / gravity;
    if (impact > 1e-9 && elapsed + impact > time) return { ...flight(time - elapsed), bounces, resting: 0, firstImpact };
    const step = Math.max(0, impact);
    x += vx * step; y = floor; elapsed += step;
    if (bounces === 0) firstImpact = elapsed;
    const hit = vy + gravity * step;
    vy = -restitution * hit; vx *= keep; bounces += 1;
    // A hop shorter than ~0.1 ms (or no rebound at all) ends the motion.
    if (Math.abs(2 * vy / gravity) < 1e-4) return { x, y: floor, vx: 0, vy: 0, bounces, resting: 1, firstImpact };
  }
  return { x, y: floor, vx: 0, vy: 0, bounces, resting: 1, firstImpact };
}
