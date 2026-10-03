/**
 * Provenance seals for the pure Motion CPU oracles (Replicator evaluator, modifier
 * planner). The frame runtime seals an output immediately after the oracle returns it:
 * the output is deep-frozen and carries the canonical `cacheKey` of its inputs. The frame contract can then prove
 * provenance by recomputing that key instead of re-running the whole oracle and comparing
 * serialized results on every rendered frame. Copies and forged outputs are never sealed
 * and keep the full recompute check.
 */
const sealedOutputs = new WeakSet<object>();

function deepFreezePlainData(root: object): void {
  const pending: object[] = [root];
  while (pending.length > 0) {
    const current = pending.pop()! as Record<string, unknown>;
    for (const key of Object.keys(current)) {
      const child = current[key];
      if (typeof child === 'object' && child !== null) pending.push(child);
    }
    Object.freeze(current);
  }
}

export function sealMotionOracleOutput<T extends object>(output: T): T {
  if (sealedOutputs.has(output)) return output;
  deepFreezePlainData(output);
  sealedOutputs.add(output);
  return output;
}

/** True when `output` is an unmodified oracle result whose inputs hash to `expectedKey`. */
export function hasSealedMotionOracleProvenance(output: unknown, expectedKey: () => string): boolean {
  if (typeof output !== 'object' || output === null || !sealedOutputs.has(output)) return false;
  try {
    return (output as { cacheKey?: unknown }).cacheKey === expectedKey();
  } catch {
    return false;
  }
}
