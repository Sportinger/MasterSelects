import type { PtStatus } from '../contracts/ptTypes';

/**
 * Latest path tracer status per scene target, read by the preview overlay (spp, ms, state,
 * fallback reason) and the export progress. Plain data; listeners run synchronously.
 */
const statuses = new Map<string, PtStatus>();
const listeners = new Set<() => void>();

export function publishPtStatus(targetKey: string, status: PtStatus | null): void {
  if (status) statuses.set(targetKey, status); else statuses.delete(targetKey);
  for (const listener of listeners) listener();
}

export function getPtStatus(targetKey = 'main'): PtStatus | null {
  return statuses.get(targetKey) ?? null;
}

export function subscribePtStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
