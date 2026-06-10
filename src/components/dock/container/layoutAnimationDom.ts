import type { DockLayoutAnimationRect } from './layoutAnimationTypes';
import { DOCK_LAYOUT_ANIMATION_EASING, DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR } from './layoutAnimationTypes';
import { getPuzzleOvershoot, toPx } from './layoutAnimationMath';

export function cloneElementForLayoutTransition(element: HTMLElement, className: string): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  const sourceCanvases = element.querySelectorAll('canvas');
  const clonedCanvases = clone.querySelectorAll('canvas');

  sourceCanvases.forEach((sourceCanvas, index) => {
    const clonedCanvas = clonedCanvases[index];
    if (!clonedCanvas || sourceCanvas.width <= 0 || sourceCanvas.height <= 0) return;

    clonedCanvas.width = sourceCanvas.width;
    clonedCanvas.height = sourceCanvas.height;
    try {
      const context = clonedCanvas.getContext('2d');
      context?.drawImage(sourceCanvas, 0, 0);
    } catch {
      // Some GPU-backed canvases cannot be sampled here; the panel chrome still animates.
    }
  });

  clone.classList.add(className);
  return clone;
}

export function createDockLayoutTransitionOverlay(container: HTMLElement): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'dock-layout-transition-overlay';
  container.appendChild(overlay);
  return overlay;
}

export function removeOverlayIfEmpty(overlay: HTMLElement): void {
  if (overlay.childElementCount === 0) {
    overlay.remove();
  }
}

export function collectTargetChildAnimationElements(element: HTMLElement): Map<string, HTMLElement> {
  const childTargets = new Map<string, HTMLElement>();
  const childElements = element.querySelectorAll<HTMLElement>(DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR);

  childElements.forEach((childElement) => {
    const id = childElement.dataset.dockLayoutChildAnimId;
    if (!id || childTargets.has(id)) return;
    childTargets.set(id, childElement);
  });

  return childTargets;
}

function createRectAnimation(
  element: HTMLElement,
  startRect: DockLayoutAnimationRect,
  endRect: DockLayoutAnimationRect,
  delayMs: number,
  durationMs: number,
  overshootDeltaX: number,
  overshootDeltaY: number,
): Animation {
  const overshootLeft = endRect.left + getPuzzleOvershoot(overshootDeltaX);
  const overshootTop = endRect.top + getPuzzleOvershoot(overshootDeltaY);
  const overshootWidth = endRect.width * 1.006;
  const overshootHeight = endRect.height * 1.006;

  element.style.right = 'auto';
  element.style.bottom = 'auto';
  element.style.left = toPx(startRect.left);
  element.style.top = toPx(startRect.top);
  element.style.width = toPx(startRect.width);
  element.style.height = toPx(startRect.height);

  return element.animate(
    [
      {
        left: toPx(startRect.left),
        top: toPx(startRect.top),
        width: toPx(startRect.width),
        height: toPx(startRect.height),
        offset: 0,
      },
      {
        left: toPx(overshootLeft),
        top: toPx(overshootTop),
        width: toPx(overshootWidth),
        height: toPx(overshootHeight),
        offset: 0.82,
      },
      {
        left: toPx(endRect.left),
        top: toPx(endRect.top),
        width: toPx(endRect.width),
        height: toPx(endRect.height),
        offset: 1,
      },
    ],
    {
      delay: delayMs,
      duration: durationMs,
      easing: DOCK_LAYOUT_ANIMATION_EASING,
      fill: 'backwards',
    },
  );
}

export function pushElementLayoutAnimation({
  overlay,
  element,
  startRect,
  endRect,
  delayMs,
  durationMs,
  overshootDeltaX,
  overshootDeltaY,
  animations,
  onCleanup,
  zIndex,
}: {
  overlay: HTMLElement;
  element: HTMLElement;
  startRect: DockLayoutAnimationRect;
  endRect: DockLayoutAnimationRect;
  delayMs: number;
  durationMs: number;
  overshootDeltaX: number;
  overshootDeltaY: number;
  animations: Animation[];
  onCleanup?: () => void;
  zIndex?: string;
}): Animation {
  if (zIndex) {
    element.style.zIndex = zIndex;
  }
  overlay.appendChild(element);
  const animation = createRectAnimation(
    element,
    startRect,
    endRect,
    delayMs,
    durationMs,
    overshootDeltaX,
    overshootDeltaY,
  );

  const cleanup = () => {
    onCleanup?.();
    element.remove();
    removeOverlayIfEmpty(overlay);
  };
  animation.addEventListener('finish', cleanup, { once: true });
  animation.addEventListener('cancel', cleanup, { once: true });
  animations.push(animation);
  return animation;
}

export function pushLiveElementLayoutAnimation({
  element,
  deltaX,
  deltaY,
  scaleX,
  scaleY,
  delayMs,
  durationMs,
  animations,
  zIndex,
}: {
  element: HTMLElement;
  deltaX: number;
  deltaY: number;
  scaleX: number;
  scaleY: number;
  delayMs: number;
  durationMs: number;
  animations: Animation[];
  zIndex?: string;
}): Animation {
  const originalPosition = element.style.position;
  const originalZIndex = element.style.zIndex;
  const originalTransformOrigin = element.style.transformOrigin;
  const originalWillChange = element.style.willChange;
  const shouldForcePosition = window.getComputedStyle(element).position === 'static';

  if (shouldForcePosition) {
    element.style.position = 'relative';
  }
  if (zIndex) {
    element.style.zIndex = zIndex;
  }
  element.style.transformOrigin = 'top left';
  element.style.willChange = originalWillChange
    ? `${originalWillChange}, transform`
    : 'transform';

  const animation = element.animate(
    [
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
        offset: 0,
      },
      {
        transform: `translate3d(${getPuzzleOvershoot(deltaX)}px, ${getPuzzleOvershoot(deltaY)}px, 0) scale(1.006, 1.006)`,
        offset: 0.82,
      },
      {
        transform: 'translate3d(0, 0, 0) scale(1, 1)',
        offset: 1,
      },
    ],
    {
      delay: delayMs,
      duration: durationMs,
      easing: DOCK_LAYOUT_ANIMATION_EASING,
      fill: 'backwards',
    },
  );

  const cleanup = () => {
    element.style.position = originalPosition;
    element.style.zIndex = originalZIndex;
    element.style.transformOrigin = originalTransformOrigin;
    element.style.willChange = originalWillChange;
  };
  animation.addEventListener('finish', cleanup, { once: true });
  animation.addEventListener('cancel', cleanup, { once: true });
  animations.push(animation);
  return animation;
}
