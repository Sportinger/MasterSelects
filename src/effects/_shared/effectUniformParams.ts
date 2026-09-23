/** Keep renderer-owned graph objects and metadata out of numeric packers. */
export function toPrimitiveEffectParams(params: Record<string, unknown>): Record<string, number | boolean | string> {
  const primitiveParams: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') primitiveParams[key] = value;
  }
  return primitiveParams;
}
