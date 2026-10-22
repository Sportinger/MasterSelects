// A worker script that fails before it ever answers is usually a deploy: the tab still runs the old
// build and its hashed worker file is gone. Code that owns a worker reports it here; the chunk
// recovery (installed at boot) reloads the tab when the server really serves a newer build.
// Kept free of editor imports so any worker owner can report without pulling in the boot graph.
export const WORKER_LOAD_FAILURE_EVENT = 'masterselects:worker-load-failure';

export function reportWorkerLoadFailure(reason: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(WORKER_LOAD_FAILURE_EVENT, { detail: reason }));
}
