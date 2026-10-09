/** Fixed composition-time schedule, independent of playback order or frame rate. */
export function curveLabelGlitchEvent(time: number): { age: number; event: number } {
  if (!Number.isFinite(time) || time < 12) return { age: -1, event: 0 };
  return { age: time % 12, event: Math.floor(time / 12) - 1 };
}
