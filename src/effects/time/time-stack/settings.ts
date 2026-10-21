import { finiteEffectNumber } from '../../_shared/effectNumberParam';
export const TIME_STACK_MAX_COUNT = 32;
/** Decay below this is used at this value (pow(0, 0) is undefined on the GPU); 1 keeps every instance at full opacity. */
export const TIME_STACK_MIN_DECAY = 0.0001;
/** New Time Stacks fade each older copy to 80 %. */
export const TIME_STACK_DEFAULT_DECAY = 0.8;
/** A Time Stack without a stored Decay (saved project or preset from before Decay existed) keeps every copy at
 * full opacity, as it always rendered; the decay param's `legacyDefault`, used by every reader. */
export const TIME_STACK_LEGACY_DECAY = 1;
/** Count and offset as the owner uses them; numbers read with the same rule as the graph (effectNumberParam.ts). */
export function timeStackSettings(params: Record<string, unknown>, localTime = Infinity) {
  const count = Math.max(1, Math.min(TIME_STACK_MAX_COUNT, Math.trunc(finiteEffectNumber(params.count, 20))));
  const offset = Math.max(0, Math.min(10, finiteEffectNumber(params.offset, 0.1)));
  const activeCount = offset === 0 ? count : Math.max(1, Math.min(count, Math.floor(Math.max(0, localTime) / offset + 1e-7) + 1));
  const delays = offset === 0 ? [] : Array.from({ length: activeCount - 1 }, (_, i) => (i + 1) * offset);
  return { count, offset, activeCount, delays };
}

/** Decay as the graph uses it (unset: the legacy 1; an unusable value at the default; then clamped to TIME_STACK_MIN_DECAY..1)
 * and whether the saved value was out of range or not a number. */
export function timeStackDecay(params: Record<string, unknown>): { decay: number; clamped: boolean; invalid: boolean } {
  const raw = params.decay;
  if (raw === undefined) return { decay: TIME_STACK_LEGACY_DECAY, clamped: false, invalid: false };
  const value = finiteEffectNumber(raw, NaN);
  if (!Number.isFinite(value)) return { decay: TIME_STACK_DEFAULT_DECAY, clamped: false, invalid: true };
  const decay = Math.min(1, Math.max(TIME_STACK_MIN_DECAY, value));
  return { decay, clamped: value < 0 || value > 1, invalid: false };
}
