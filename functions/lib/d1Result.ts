/**
 * Reads the affected-row count from a D1 `run()` result. D1 reports it as
 * `meta.changes`; test doubles and older shims may expose `changes` directly.
 * Returns `null` when the result carries no usable count so callers can fall
 * back to a verification read instead of guessing.
 */
export function readRunChanges(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const direct = (result as { changes?: unknown }).changes;
  if (typeof direct === 'number') return direct;
  const nested = (result as { meta?: { changes?: unknown } }).meta?.changes;
  return typeof nested === 'number' ? nested : null;
}
