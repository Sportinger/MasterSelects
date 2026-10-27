import type { PointerEvent } from 'react';

/** Pointer-focus hygiene of the Q1 pro sheets: a tapped control lets go of focus a frame later (after
 * the compatibility mousedown a touch sends); keyboard activation never sends pointerup, so keyboard
 * focus and its :focus-visible ring stay. */
export function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  const target = event.currentTarget;
  window.requestAnimationFrame(() => { if (document.activeElement === target) target.blur(); });
}
