import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { NodeBounds, Viewport } from './canvasGeometry';
import { retainNodeDomViewport } from './nodeDomVisibility';

/** Measure only on resize, never force a layout read on every pan frame. */
export function useNodeDomViewport(ref: RefObject<HTMLDivElement | null>, viewport: Viewport, interacting: boolean, frozen = false,
  zooming?: RefObject<boolean>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [focused, setFocused] = useState(false);
  const retained = useRef<NodeBounds | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const resize = () => {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const focus = () => setFocused(!!document.activeElement && canvas.contains(document.activeElement)
      && !!document.activeElement.closest('[data-node-id]'));
    resize(); focus();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(canvas);
    if (!observer) window.addEventListener('resize', resize);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', focus);
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus); };
  }, [ref]);
  // Retain pointer capture and keyboard navigation until the interaction ends.
  // A pan or wheel zoom owns the view: keep the hit-target membership until it
  // settles, so fast or low-frame-rate pans and zooms never rebuild cards and
  // cables on every step.
  return useMemo(() => {
    if (interacting || focused) return null;
    if ((frozen || zooming?.current) && retained.current) return retained.current;
    retained.current = retainNodeDomViewport(retained.current, viewport, size.width, size.height);
    return retained.current;
  }, [interacting, focused, frozen, zooming, viewport, size]);
}
