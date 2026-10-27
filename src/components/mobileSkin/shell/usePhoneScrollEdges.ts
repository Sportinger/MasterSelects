// Horizontal scroll strips of the shell (composition tabs, tool bar): marks on the element whether
// more content hides beyond its left or right edge (data-more-start / data-more-end), so the CSS can
// fade that edge, and offers scrolling one child fully into view without moving any ancestor.

import { useLayoutEffect, type RefObject } from 'react';

/** Room kept beside a child scrolled into view, so it never sits under the edge fade. */
export const PHONE_SCROLL_EDGE_PX = 24;

function markEdges(element: HTMLElement): void {
  const max = element.scrollWidth - element.clientWidth;
  const start = element.scrollLeft > 1;
  const end = max - element.scrollLeft > 1;
  if (element.dataset.moreStart !== String(start)) element.dataset.moreStart = String(start);
  if (element.dataset.moreEnd !== String(end)) element.dataset.moreEnd = String(end);
}

/**
 * Keeps data-more-start / data-more-end of `ref` current on scroll, resize and content change.
 * `deps` re-runs the first measurement when the children change.
 */
export function usePhoneScrollEdges(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => markEdges(element);
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the caller's content keys
  }, deps);
}

/**
 * Scrolls `scroller` horizontally (only it, no ancestor and no page) so that `child` is fully
 * visible with PHONE_SCROLL_EDGE_PX room to each edge, or as close as the strip allows.
 */
export function scrollChildIntoStrip(scroller: HTMLElement, child: HTMLElement, behavior: ScrollBehavior = 'auto'): void {
  const strip = scroller.getBoundingClientRect();
  const box = child.getBoundingClientRect();
  const edge = Math.min(PHONE_SCROLL_EDGE_PX, Math.max(0, (strip.width - box.width) / 2));
  let delta = 0;
  if (box.left < strip.left + edge) delta = box.left - strip.left - edge;
  else if (box.right > strip.right - edge) delta = box.right - strip.right + edge;
  if (Math.abs(delta) < 1) return;
  scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior });
  markEdges(scroller);
}
