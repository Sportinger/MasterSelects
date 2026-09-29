import type { RenderHostDevMode } from './renderHostPort';

/** Local development defaults to strict Worker GPU rendering on a fresh canvas. */
export function renderHostStartupMode(
  development: boolean,
  search: string,
  persisted: RenderHostDevMode | null,
): RenderHostDevMode | null {
  if (development) {
    const requested = new URLSearchParams(search).get('renderHost');
    if (requested === 'main' || requested === 'worker-shadow' || requested === 'worker-presenting'
      || requested === 'worker-only' || requested === 'worker-gpu-only') return requested;
    return 'worker-gpu-only';
  }
  // Stale experimental settings must not activate the Worker on an ordinary reload.
  return persisted === 'main' ? 'main' : null;
}
