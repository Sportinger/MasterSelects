/** Keep renderer-owned graph objects and metadata out of numeric packers. */
export function toPrimitiveEffectParams(params: Record<string, unknown>): Record<string, number | boolean | string> {
  const primitiveParams: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') primitiveParams[key] = value;
  }
  return primitiveParams;
}

/** A uniform value: a non-numeric or non-finite parameter (tools, broken data) falls back to the default instead of a NaN uniform. */
export function finiteUniform(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : fallback;
}
