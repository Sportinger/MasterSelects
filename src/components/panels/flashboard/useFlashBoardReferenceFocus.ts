import { useCallback, useEffect, useRef, type PointerEvent } from 'react';

const REFERENCE_AUTO_SCROLL_EDGE_PX = 58;
const REFERENCE_AUTO_SCROLL_MAX_PX_PER_FRAME = 8;

export function useFlashBoardReferenceFocus() {
  const referenceStripRef = useRef<HTMLDivElement>(null);
  const referencePointerPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const referenceAutoScrollFrameRef = useRef<number | null>(null);
  const referenceAutoScrollVelocityRef = useRef(0);

  const applyReferenceCardFocus = useCallback((strip: HTMLDivElement, clientX: number, clientY: number) => {
    const cards = strip.querySelectorAll<HTMLElement>('.fb-reference-card');

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const normalizedX = (clientX - centerX) / Math.max(1, rect.width * 0.82);
      const normalizedY = (clientY - centerY) / Math.max(1, rect.height * 0.82);
      const distance = Math.hypot(normalizedX, normalizedY);
      const focus = Math.max(0, 1 - distance);
      const easedFocus = Math.pow(focus, 1.35);

      card.style.setProperty('--fb-reference-focus', easedFocus.toFixed(3));
      card.style.zIndex = easedFocus > 0 ? String(10 + Math.round(easedFocus * 90)) : '';
    });
  }, []);

  const stopReferenceAutoScroll = useCallback(() => {
    referenceAutoScrollVelocityRef.current = 0;

    if (referenceAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(referenceAutoScrollFrameRef.current);
      referenceAutoScrollFrameRef.current = null;
    }
  }, []);

  const ensureReferenceAutoScroll = useCallback(() => {
    if (referenceAutoScrollFrameRef.current !== null) {
      return;
    }

    const tick = () => {
      const strip = referenceStripRef.current;
      const velocity = referenceAutoScrollVelocityRef.current;

      if (!strip || Math.abs(velocity) < 0.1) {
        referenceAutoScrollFrameRef.current = null;
        referenceAutoScrollVelocityRef.current = 0;
        return;
      }

      const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, strip.scrollLeft + velocity));

      if (nextScrollLeft === strip.scrollLeft) {
        referenceAutoScrollFrameRef.current = null;
        referenceAutoScrollVelocityRef.current = 0;
        return;
      }

      strip.scrollLeft = nextScrollLeft;

      const pointerPosition = referencePointerPositionRef.current;
      if (pointerPosition) {
        applyReferenceCardFocus(strip, pointerPosition.clientX, pointerPosition.clientY);
      }

      referenceAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    referenceAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
  }, [applyReferenceCardFocus]);

  const updateReferenceAutoScroll = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const strip = event.currentTarget;
    const computedStyle = window.getComputedStyle(strip);
    const isVerticalStrip = computedStyle.flexDirection === 'column' || computedStyle.overflowX === 'hidden';
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);

    if (isVerticalStrip || maxScrollLeft <= 1) {
      stopReferenceAutoScroll();
      return;
    }

    const rect = strip.getBoundingClientRect();
    const edgeSize = Math.min(REFERENCE_AUTO_SCROLL_EDGE_PX, Math.max(32, rect.width * 0.22));
    const leftDistance = event.clientX - rect.left;
    const rightDistance = rect.right - event.clientX;
    let velocity = 0;

    if (leftDistance < edgeSize) {
      const strength = Math.max(0, Math.min(1, (edgeSize - leftDistance) / edgeSize));
      velocity = -REFERENCE_AUTO_SCROLL_MAX_PX_PER_FRAME * Math.pow(strength, 1.35);
    } else if (rightDistance < edgeSize) {
      const strength = Math.max(0, Math.min(1, (edgeSize - rightDistance) / edgeSize));
      velocity = REFERENCE_AUTO_SCROLL_MAX_PX_PER_FRAME * Math.pow(strength, 1.35);
    }

    if ((velocity < 0 && strip.scrollLeft <= 0) || (velocity > 0 && strip.scrollLeft >= maxScrollLeft - 1)) {
      velocity = 0;
    }

    referenceAutoScrollVelocityRef.current = velocity;

    if (velocity === 0) {
      stopReferenceAutoScroll();
    } else {
      ensureReferenceAutoScroll();
    }
  }, [ensureReferenceAutoScroll, stopReferenceAutoScroll]);

  const updateReferenceCardFocus = useCallback((event: PointerEvent<HTMLDivElement>) => {
    referencePointerPositionRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };

    applyReferenceCardFocus(event.currentTarget, event.clientX, event.clientY);
    updateReferenceAutoScroll(event);
  }, [applyReferenceCardFocus, updateReferenceAutoScroll]);

  const resetReferenceCardFocus = useCallback((event?: PointerEvent<HTMLDivElement>) => {
    referencePointerPositionRef.current = null;
    const strip = event?.currentTarget ?? referenceStripRef.current;
    if (!strip) {
      return;
    }

    strip.querySelectorAll<HTMLElement>('.fb-reference-card').forEach((card) => {
      card.style.setProperty('--fb-reference-focus', '0');
      card.style.zIndex = '';
    });
  }, []);

  const handleReferenceStripPointerLeave = useCallback((event: PointerEvent<HTMLDivElement>) => {
    resetReferenceCardFocus(event);
    stopReferenceAutoScroll();
  }, [resetReferenceCardFocus, stopReferenceAutoScroll]);

  useEffect(() => () => {
    stopReferenceAutoScroll();
  }, [stopReferenceAutoScroll]);

  return {
    handleReferenceStripPointerLeave,
    referenceStripRef,
    updateReferenceCardFocus,
  };
}
