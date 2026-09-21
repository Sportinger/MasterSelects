export function normalizeImageVector2(value: readonly number[]): [number, number] {
  const length = Math.hypot(value[0], value[1]);
  return length === 0 ? [0, 0] : [value[0] / length, value[1] / length];
}
