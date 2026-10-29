/** Slide time and ease-out curve of the node inspector sidebar. */
export const NODE_INSPECTOR_SLIDE_MS = 200;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** On the inspector while it slides: it leaves the flex row and lies over the canvas. */
export const NODE_INSPECTOR_SLIDING = 'data-node-inspector-sliding';

const running = new WeakMap<HTMLElement, Animation[]>();

export function canSlideNodeInspector(): boolean {
  return typeof window !== 'undefined' && typeof HTMLElement.prototype.animate === 'function'
    && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
}

function translationOf(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m41 : 0;
}

/**
 * Slides the inspector after `handle` in or out. Only transforms animate. While it moves, the
 * desktop sidebar lies over the canvas, so the canvas changes its size once per toggle, inside the
 * strip the sidebar covers, and never on every frame (no per-frame canvas reallocation, which
 * stutters or flickers on Linux/Mesa). The phone drawer already floats and only slides. A slide that
 * is reversed midway continues from where the sidebar is. `onSettled` runs once a slide completes.
 */
export function slideNodeInspector(handle: HTMLElement, opening: boolean, onSettled: () => void): { cancel: () => void } {
  const panel = handle.parentElement;
  const next = handle.nextElementSibling;
  const aside = next instanceof HTMLElement && next.classList.contains('node-workspace-inspector') ? next : null;
  const previous = running.get(handle);
  if (!panel || !aside || !canSlideNodeInspector()) {
    previous?.forEach(animation => animation.cancel());
    running.delete(handle);
    panel?.removeAttribute(NODE_INSPECTOR_SLIDING);
    aside?.removeAttribute(NODE_INSPECTOR_SLIDING);
    queueMicrotask(onSettled);
    return { cancel: () => {} };
  }
  const offset = previous ? translationOf(aside) : undefined;
  previous?.forEach(animation => animation.cancel());
  const floating = !aside.hasAttribute(NODE_INSPECTOR_SLIDING) && getComputedStyle(aside).position === 'absolute';
  if (!floating) aside.setAttribute(NODE_INSPECTOR_SLIDING, '');
  panel.setAttribute(NODE_INSPECTOR_SLIDING, '');
  const travel = Math.max(1, panel.getBoundingClientRect().right - aside.getBoundingClientRect().left);
  const from = offset ?? (opening ? travel : 0), to = opening ? 0 : travel;
  const timing: KeyframeAnimationOptions = { duration: NODE_INSPECTOR_SLIDE_MS * Math.min(1, Math.abs(to - from) / travel), easing: EASE_OUT, fill: 'forwards' };
  const animations = [aside.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], timing)];
  // The desktop handle stays in the flex row at the closed position and rides on the sidebar's edge.
  if (!floating) animations.push(handle.animate([{ transform: `translateX(${from - travel}px)` }, { transform: `translateX(${to - travel}px)` }], timing));
  running.set(handle, animations);
  const release = () => {
    animations.forEach(animation => animation.cancel());
    if (running.get(handle) === animations) running.delete(handle);
    panel.removeAttribute(NODE_INSPECTOR_SLIDING);
    aside.removeAttribute(NODE_INSPECTOR_SLIDING);
  };
  animations[0].onfinish = () => {
    if (running.get(handle) !== animations) return;
    onSettled();
    release();
  };
  return { cancel: () => { if (running.get(handle) === animations) release(); } };
}
