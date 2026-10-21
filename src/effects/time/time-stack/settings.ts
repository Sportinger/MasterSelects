export const TIME_STACK_MAX_COUNT = 32;
/** Decay below this is used at this value (pow(0, 0) is undefined on the GPU); 1 keeps every instance at full opacity. */
export const TIME_STACK_MIN_DECAY = 0.0001;
export function timeStackSettings(params: Record<string, unknown>, localTime = Infinity) {
  const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const count = Math.max(1, Math.min(TIME_STACK_MAX_COUNT, Math.trunc(finite(params.count, 20))));
  const offset = Math.max(0, Math.min(10, finite(params.offset, 0.1)));
  const activeCount = offset === 0 ? count : Math.max(1, Math.min(count, Math.floor(Math.max(0, localTime) / offset + 1e-7) + 1));
  const delays = offset === 0 ? [] : Array.from({ length: activeCount - 1 }, (_, i) => (i + 1) * offset);
  return { count, offset, activeCount, delays };
}

/** Decay as the graph uses it (clamped to TIME_STACK_MIN_DECAY..1) and whether the saved value was out of range. */
export function timeStackDecay(params: Record<string, unknown>): { decay: number; clamped: boolean } {
  const raw = params.decay;
  if (raw === undefined) return { decay: 1, clamped: false };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { decay: 1, clamped: true };
  const decay = Math.min(1, Math.max(TIME_STACK_MIN_DECAY, raw));
  return { decay, clamped: raw < 0 || raw > 1 };
}
