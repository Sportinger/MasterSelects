/** Dev-only cumulative counters; weak keys never retain unmounted canvases. */
const profiles = new WeakMap<HTMLElement, { commits: number; renderMs: number; maxRenderMs: number }>();
export function recordNodeCanvasRender(canvas: HTMLElement | null, duration: number) {
  if (!import.meta.env.DEV || !canvas) return;
  const value = profiles.get(canvas) ?? { commits: 0, renderMs: 0, maxRenderMs: 0 };
  value.commits++; value.renderMs += duration; value.maxRenderMs = Math.max(value.maxRenderMs, duration);
  profiles.set(canvas, value);
}
export function readNodeCanvasProfile(canvas: HTMLElement) {
  return { ...(profiles.get(canvas) ?? { commits: 0, renderMs: 0, maxRenderMs: 0 }) };
}
