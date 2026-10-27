// Speed-ramp presets of the phone speed sheet, written as the editor's own retime curve: a clip
// warp (ClipTimeRemap kind 'warp', points of timeline time -> source time, sampled piecewise
// linearly by services/timeline/retime/clipWarp.ts). A preset keeps the clip's length and plays the
// same source window as at constant speed, only the pace changes: the clip is split into equal
// timeline segments, each with a constant speed from the preset's profile, normalised so the
// segments together cover exactly the source window. Constant-speed segments are what the warp
// samples, so nothing is drawn as a smooth curve that the engine plays as straight pieces.
// Pure functions; the commands apply the result through setClipTimeRemap like the desktop.

import type { ClipTimeRemap } from '../../../types/timeline';

export type PhoneSpeedCurveId = 'speed-up' | 'slow-down' | 'slow-middle' | 'fast-middle' | 'pulse';

export interface PhoneSpeedCurvePreset {
  id: PhoneSpeedCurveId;
  label: string;
  /** Relative speed at normalised clip time u in [0, 1]; only the shape matters (it is normalised). */
  profile: (u: number) => number;
}

export const PHONE_SPEED_CURVES: readonly PhoneSpeedCurvePreset[] = [
  { id: 'speed-up', label: 'Speed up', profile: (u) => 0.35 + 1.65 * u * u },
  { id: 'slow-down', label: 'Slow down', profile: (u) => 0.35 + 1.65 * (1 - u) * (1 - u) },
  { id: 'slow-middle', label: 'Slow middle', profile: (u) => 1.6 - 1.3 * Math.sin(Math.PI * u) },
  { id: 'fast-middle', label: 'Fast middle', profile: (u) => 0.4 + 1.6 * Math.sin(Math.PI * u) },
  { id: 'pulse', label: 'Pulse', profile: (u) => 1.2 - 0.9 * Math.sin(2 * Math.PI * u) ** 2 },
];

/** Equal timeline segments per preset curve (49 warp points, well below the editor's 256). */
export const PHONE_SPEED_CURVE_SEGMENTS = 48;

export interface PhoneSpeedCurveClip {
  /** Timeline length in seconds (kept by the preset). */
  duration: number;
  inPoint: number;
  outPoint: number;
  /** Plays from outPoint to inPoint. */
  backward: boolean;
}

type ClipWarp = Extract<ClipTimeRemap, { kind: 'warp' }>;

export function getPhoneSpeedCurve(id: string): PhoneSpeedCurvePreset | undefined {
  return PHONE_SPEED_CURVES.find((preset) => preset.id === id);
}

/** The warp a preset gives this clip, or null when the clip has no source window or length to retime. */
export function buildPhoneSpeedCurveWarp(clip: PhoneSpeedCurveClip, id: PhoneSpeedCurveId): ClipWarp | null {
  const preset = getPhoneSpeedCurve(id);
  const span = clip.outPoint - clip.inPoint;
  if (!preset || !(clip.duration > 0) || !(span > 0) || !Number.isFinite(span)) return null;
  const segments = PHONE_SPEED_CURVE_SEGMENTS;
  const weights = Array.from({ length: segments }, (_, index) => Math.max(1e-3, preset.profile((index + 0.5) / segments)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const start = clip.backward ? clip.outPoint : clip.inPoint;
  const end = clip.backward ? clip.inPoint : clip.outPoint;
  const direction = clip.backward ? -1 : 1;
  const points: ClipWarp['points'] = [{ time: 0, source: start }];
  let covered = 0;
  for (let index = 0; index < segments; index++) {
    covered += weights[index];
    const last = index === segments - 1;
    points.push({
      time: last ? clip.duration : (clip.duration * (index + 1)) / segments,
      source: last ? end : start + direction * span * (covered / total),
    });
  }
  return { kind: 'warp', points };
}

/** Source time of a warp at clip-local time `local` (same piecewise-linear rule as the engine's sampleWarp). */
export function phoneWarpSourceAt(points: ClipWarp['points'], local: number): number {
  if (local <= points[0].time) return points[0].source;
  const last = points[points.length - 1];
  if (local >= last.time) return last.source;
  let index = 1;
  while (points[index].time < local) index++;
  const a = points[index - 1];
  const b = points[index];
  return a.source + ((local - a.time) / (b.time - a.time)) * (b.source - a.source);
}

/** Which preset produced this warp (for reopening the sheet), or null for a curve made elsewhere. */
export function identifyPhoneSpeedCurve(clip: PhoneSpeedCurveClip, warp: ClipWarp | undefined): PhoneSpeedCurveId | null {
  if (!warp || warp.points.length !== PHONE_SPEED_CURVE_SEGMENTS + 1) return null;
  for (const preset of PHONE_SPEED_CURVES) {
    const expected = buildPhoneSpeedCurveWarp(clip, preset.id);
    if (expected && expected.points.every((point, index) => (
      Math.abs(point.time - warp.points[index].time) < 1e-6 && Math.abs(point.source - warp.points[index].source) < 1e-6
    ))) return preset.id;
  }
  return null;
}
