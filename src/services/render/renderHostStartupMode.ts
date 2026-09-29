import type { RenderHostDevMode } from './renderHostPort';

/** Explicit dev boot selection gives the host a fresh canvas before any context is acquired. */
export function renderHostStartupMode(
  development: boolean,
  search: string,
  persisted: RenderHostDevMode | null,
): RenderHostDevMode | null {
  if (development) {
    const requested = new URLSearchParams(search).get('renderHost');
    if (requested === 'main' || requested === 'worker-shadow' || requested === 'worker-presenting'
      || requested === 'worker-only' || requested === 'worker-gpu-only') return requested;
  }
  // Stale experimental settings must not activate the Worker on an ordinary reload.
  return persisted === 'main' ? 'main' : null;
}
