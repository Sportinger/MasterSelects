// How node value cards show a number: up to four decimals, but a small non-zero value keeps three
// significant digits instead of rounding to 0 (a Coverage Floor of 0.000001 reads 0.000001).
const SIGNIFICANT_DIGITS = 3;
const MAX_FIELD_DECIMALS = 12;

export function nodeValueText(value: number): string {
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 0.01) return String(Number(value.toFixed(4)));
  return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
}

/** Decimals a number field needs to show `value` as nodeValueText does, and at least `minimum`. */
export function nodeValueDecimals(value: number, minimum: number): number {
  const text = nodeValueText(value);
  const [mantissa, exponent] = text.split('e-');
  const fraction = mantissa.split('.')[1]?.length ?? 0;
  const decimals = exponent === undefined ? fraction : Number(exponent) + fraction;
  return Math.min(MAX_FIELD_DECIMALS, Math.max(minimum, decimals));
}
