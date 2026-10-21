// Number parameters can arrive as anything: AI tools, keyframes and old saves do not check types.
// Renderers and inspectors read them with the same rule, so what the inspector reports is what renders.

/** Finite numbers, and text holding one, as given; NaN, ±Infinity, null and other text as the fallback. */
export function finiteEffectNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Whether a set value is not usable as a number (and is replaced by the fallback). Unset (undefined) is fine. */
export function isUnusableEffectNumber(value: unknown): boolean {
  return value !== undefined && !Number.isFinite(finiteEffectNumber(value, NaN));
}
