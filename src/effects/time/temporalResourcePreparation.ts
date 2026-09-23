let collecting: Set<Promise<unknown>> | undefined;
let exportFrameStep: number | undefined;
export const temporalExportFrameStep = () => exportFrameStep;
export const isCollectingTemporalPreparations = () => collecting !== undefined;

/** Collect only resources requested by one synchronous render, not unrelated tabs/owners. */
export function collectTemporalPreparations(frameStep?: number) {
  if (collecting) throw new Error('Temporal resource preparation cannot nest render collectors.');
  const pending = new Set<Promise<unknown>>();
  collecting = pending;
  exportFrameStep = frameStep && Number.isFinite(frameStep) && frameStep > 0 ? frameStep : undefined;
  return () => { if (collecting === pending) { collecting = undefined; exportFrameStep = undefined; } return [...pending]; };
}

export function recordTemporalPreparation(promise: Promise<unknown>) { collecting?.add(promise); }

export async function awaitTemporalPreparations(pending: readonly Promise<unknown>[], signal: AbortSignal) {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { await Promise.race([Promise.all(pending), aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

const statuses = new Map<string, string>();
const listeners = new Set<() => void>();
export const subscribeTemporalStatus = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getTemporalStatus = (effectId: string) => statuses.get(effectId) ?? '';
export function setTemporalStatus(effectId: string, status: string) {
  if (getTemporalStatus(effectId) === status) return;
  if (status) statuses.set(effectId, status); else statuses.delete(effectId);
  for (const listener of listeners) listener();
}
