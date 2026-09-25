export const TIME_STACK_MAX_COUNT = 32;
export function timeStackSettings(params: Record<string, unknown>, localTime = Infinity) {
  const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const count = Math.max(1, Math.min(TIME_STACK_MAX_COUNT, Math.trunc(finite(params.count, 20))));
  const offset = Math.max(0, Math.min(10, finite(params.offset, 0.1)));
  const activeCount = offset === 0 ? count : Math.max(1, Math.min(count, Math.floor(Math.max(0, localTime) / offset + 1e-7) + 1));
  const delays = offset === 0 ? [] : Array.from({ length: activeCount - 1 }, (_, i) => (i + 1) * offset);
  return { count, offset, activeCount, delays };
}
