/**
 * Effects whose GPU pipeline could not be built on this device (driver compiler
 * failure, out of memory, invalid shader). The renderer skips them; the effect
 * inspector reads this registry so the skip is visible instead of silent.
 */
/** Thrown where a pass can only be skipped by aborting its encode; the effect loop reports it. */
export class EffectGpuPipelineError extends Error {
  override name = 'EffectGpuPipelineError';
}

const failures = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function reportEffectGpuFailure(effectType: string, message: string): void {
  if (failures.get(effectType) === message) return;
  failures.set(effectType, message);
  notify();
}

export function getEffectGpuFailure(effectType: string): string | undefined {
  return failures.get(effectType);
}

/** A new GPU device rebuilds every pipeline, so earlier failures no longer apply. */
export function clearEffectGpuFailures(): void {
  if (!failures.size) return;
  failures.clear();
  notify();
}

export function subscribeEffectGpuFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
