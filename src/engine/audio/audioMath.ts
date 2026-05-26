export const DEFAULT_TRUE_PEAK_CEILING_DB = -1;

export function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function dbToLinearGain(db: unknown, fallbackDb = 0): number {
  const value = finiteNumber(db, fallbackDb);
  return Math.pow(10, value / 20);
}

export function clampAudioPan(value: unknown): number {
  return Math.max(-1, Math.min(1, finiteNumber(value, 0)));
}

export function clampLinearGain(value: unknown, fallback = 1): number {
  return Math.max(0, finiteNumber(value, fallback));
}

export function hasNonDefaultAudioPan(value: unknown): boolean {
  return Math.abs(clampAudioPan(value)) > 0.001;
}
