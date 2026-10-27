// Pitch axis of the piano roll: the playable range and the row <-> pitch mapping shared by the
// editor, its drag handling and its touch editing.

export const PITCH_MIN = 21;      // A0
export const PITCH_MAX = 108;     // C8
export const PITCH_COUNT = PITCH_MAX - PITCH_MIN + 1;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function pitchToY(pitch: number, rowH: number): number {
  return (PITCH_MAX - pitch) * rowH;
}

export function yToPitch(y: number, rowH: number): number {
  return PITCH_MAX - Math.floor(y / rowH);
}
