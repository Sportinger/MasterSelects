import { nodeCountMeasure, nodeDurationMeasure } from '../../../../../services/nodeGraph/unified/nodeGraphPerformance';

/** Dev-only cumulative counters; weak keys never retain unmounted canvases. */
const profiles = new WeakMap<HTMLElement, { commits: number; renderMs: number; maxRenderMs: number }>();
export function recordNodeCanvasRender(canvas: HTMLElement | null, duration: number, cards = 0) {
  if (!import.meta.env.DEV || !canvas) return;
  const value = profiles.get(canvas) ?? { commits: 0, renderMs: 0, maxRenderMs: 0 };
  value.commits++; value.renderMs += duration; value.maxRenderMs = Math.max(value.maxRenderMs, duration);
  profiles.set(canvas, value);
  nodeDurationMeasure('react-commit', duration, { commit: value.commits });
  nodeCountMeasure('card-renders', { commit: value.commits, count: cards });
}
export function readNodeCanvasProfile(canvas: HTMLElement) {
  return { ...(profiles.get(canvas) ?? { commits: 0, renderMs: 0, maxRenderMs: 0 }) };
}

const cardRenders = import.meta.env.DEV ? new WeakMap<object, number>() : undefined;
export function recordNodeCardRender(profile: object): void {
  cardRenders?.set(profile, (cardRenders.get(profile) ?? 0) + 1);
}
export function takeNodeCardRenders(profile: object): number {
  const count = cardRenders?.get(profile) ?? 0;
  cardRenders?.delete(profile);
  return count;
}
