import type {
  DockLayoutAnimationItem,
  DockLayoutAnimationSnapshot,
  DockLayoutAnimationTarget,
} from './layoutAnimationTypes';
import { DOCK_LAYOUT_ANIMATION_SELECTOR } from './layoutAnimationTypes';
import {
  cloneElementForLayoutTransition,
  collectTargetChildAnimationElements,
  createDockLayoutTransitionOverlay,
  pushElementLayoutAnimation,
  pushLiveElementLayoutAnimation,
  removeOverlayIfEmpty,
} from './layoutAnimationDom';
import {
  getDockLayoutEdgeRect,
  getDockLayoutEffectiveTiming,
  getDockLayoutOverlayZIndex,
  getPuzzleAnimationTiming,
  shouldAnimateLiveLayoutElement,
  toRelativeRect,
} from './layoutAnimationMath';

function appendChildLayoutAnimations({
  overlay,
  containerRect,
  previous,
  targetElement,
  snapshotDurationMs,
  delayMs,
  durationMs,
  animations,
}: {
  overlay: HTMLElement;
  containerRect: DOMRect;
  previous: DockLayoutAnimationItem;
  targetElement: HTMLElement;
  snapshotDurationMs: number;
  delayMs: number;
  durationMs: number;
  animations: Animation[];
}): void {
  if (previous.childItems.size === 0) return;

  const targetChildren = collectTargetChildAnimationElements(targetElement);

  previous.childItems.forEach((childItem, childId) => {
    const targetChild = targetChildren.get(childId);
    if (!targetChild) return;

    const targetRect = targetChild.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) return;

    const startRect = toRelativeRect(childItem.rect, containerRect);
    const endRect = toRelativeRect(targetRect, containerRect);
    const didMove = Math.abs(startRect.left - endRect.left) > 0.5 || Math.abs(startRect.top - endRect.top) > 0.5;
    const didResize = Math.abs(startRect.width - endRect.width) > 0.5 || Math.abs(startRect.height - endRect.height) > 0.5;
    if (!didMove && !didResize) return;

    const childClone = cloneElementForLayoutTransition(targetChild, 'dock-layout-child-transition-clone');
    const originalVisibility = targetChild.style.visibility;
    const childTiming = getDockLayoutEffectiveTiming(childId, snapshotDurationMs, delayMs, durationMs);
    targetChild.style.visibility = 'hidden';
    pushElementLayoutAnimation({
      overlay,
      element: childClone,
      startRect,
      endRect,
      delayMs: childTiming.delayMs,
      durationMs: childTiming.durationMs,
      overshootDeltaX: childItem.rect.left - targetRect.left,
      overshootDeltaY: childItem.rect.top - targetRect.top,
      animations,
      zIndex: getDockLayoutOverlayZIndex(childId, 'child'),
      onCleanup: () => {
        targetChild.style.visibility = originalVisibility;
      },
    });
  });
}

export function animateDockLayoutTransition(container: HTMLElement, snapshot: DockLayoutAnimationSnapshot): Animation[] {
  if (
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return [];
  }

  const animations: Animation[] = [];
  const nextElements = container.querySelectorAll<HTMLElement>(DOCK_LAYOUT_ANIMATION_SELECTOR);
  const containerRect = container.getBoundingClientRect();
  const targets: DockLayoutAnimationTarget[] = [];
  const nextIds = new Set<string>();
  const overlay = createDockLayoutTransitionOverlay(container);

  nextElements.forEach((element) => {
    const id = element.dataset.dockLayoutAnimId;
    if (!id || nextIds.has(id)) return;

    const nextRect = element.getBoundingClientRect();
    if (nextRect.width <= 0 || nextRect.height <= 0) return;
    const previous = snapshot.items.get(id);

    nextIds.add(id);
    const movementDistance = previous
      ? Math.hypot(previous.rect.left - nextRect.left, previous.rect.top - nextRect.top)
      : Math.min(nextRect.left - containerRect.left, containerRect.right - nextRect.right, nextRect.top - containerRect.top, containerRect.bottom - nextRect.bottom);
    const timing = getPuzzleAnimationTiming(id, nextRect, containerRect, snapshot.durationMs, movementDistance);

    targets.push({ element, id, rect: nextRect, previous: previous ?? null, ...timing });
  });

  targets.forEach(({ element, id, rect: nextRect, previous, delayMs, durationMs }) => {
    const panelTiming = getDockLayoutEffectiveTiming(id, snapshot.durationMs, delayMs, durationMs);

    if (previous) {
      const startRect = toRelativeRect(previous.rect, containerRect);
      const endRect = toRelativeRect(nextRect, containerRect);
      const deltaX = previous.rect.left - nextRect.left;
      const deltaY = previous.rect.top - nextRect.top;
      const didMove = Math.abs(startRect.left - endRect.left) > 0.5 || Math.abs(startRect.top - endRect.top) > 0.5;
      const didResize = Math.abs(startRect.width - endRect.width) > 0.5 || Math.abs(startRect.height - endRect.height) > 0.5;

      if (!didMove && !didResize) return;

      if (shouldAnimateLiveLayoutElement(id)) {
        pushLiveElementLayoutAnimation({
          element,
          deltaX,
          deltaY,
          scaleX: previous.rect.width / Math.max(nextRect.width, 1),
          scaleY: previous.rect.height / Math.max(nextRect.height, 1),
          delayMs: panelTiming.delayMs,
          durationMs: panelTiming.durationMs,
          animations,
          zIndex: getDockLayoutOverlayZIndex(id, 'panel'),
        });
        return;
      }

      const clone = previous.clone;
      const originalVisibility = element.style.visibility;

      if (previous.childItems.size > 0) {
        clone.classList.add('dock-layout-transition-clone--has-child-overlays');
      }
      element.style.visibility = 'hidden';

      pushElementLayoutAnimation({
        overlay,
        element: clone,
        startRect,
        endRect,
        delayMs: panelTiming.delayMs,
        durationMs: panelTiming.durationMs,
        overshootDeltaX: deltaX,
        overshootDeltaY: deltaY,
        animations,
        zIndex: getDockLayoutOverlayZIndex(previous.id, 'panel'),
        onCleanup: () => {
          element.style.visibility = originalVisibility;
        },
      });
      appendChildLayoutAnimations({
        overlay,
        containerRect,
        previous,
        targetElement: element,
        snapshotDurationMs: snapshot.durationMs,
        delayMs: panelTiming.delayMs,
        durationMs: panelTiming.durationMs,
        animations,
      });
      return;
    }

    const endRect = toRelativeRect(nextRect, containerRect);
    const startRect = getDockLayoutEdgeRect(endRect, containerRect);

    if (shouldAnimateLiveLayoutElement(id)) {
      pushLiveElementLayoutAnimation({
        element,
        deltaX: startRect.left - endRect.left,
        deltaY: startRect.top - endRect.top,
        scaleX: 1,
        scaleY: 1,
        delayMs: panelTiming.delayMs,
        durationMs: panelTiming.durationMs,
        animations,
        zIndex: getDockLayoutOverlayZIndex(id, 'panel'),
      });
      return;
    }

    const clone = cloneElementForLayoutTransition(element, 'dock-layout-transition-clone');
    const originalVisibility = element.style.visibility;
    element.style.visibility = 'hidden';

    pushElementLayoutAnimation({
      overlay,
      element: clone,
      startRect,
      endRect,
      delayMs: panelTiming.delayMs,
      durationMs: panelTiming.durationMs,
      overshootDeltaX: startRect.left - endRect.left,
      overshootDeltaY: startRect.top - endRect.top,
      animations,
      zIndex: getDockLayoutOverlayZIndex(id, 'panel'),
      onCleanup: () => {
        element.style.visibility = originalVisibility;
      },
    });
  });

  snapshot.items.forEach((previous, id) => {
    if (nextIds.has(id)) return;

    const startRect = toRelativeRect(previous.rect, containerRect);
    const endRect = getDockLayoutEdgeRect(startRect, containerRect);
    const movementDistance = Math.hypot(startRect.left - endRect.left, startRect.top - endRect.top);
    const timing = getPuzzleAnimationTiming(id, previous.rect, containerRect, snapshot.durationMs, movementDistance);
    const panelTiming = getDockLayoutEffectiveTiming(id, snapshot.durationMs, timing.delayMs, timing.durationMs);

    const exitElement = shouldAnimateLiveLayoutElement(id) && previous.liveElement
      ? previous.liveElement
      : previous.clone;

    if (exitElement === previous.liveElement) {
      exitElement.classList.add('dock-layout-transition-clone');
    }

    pushElementLayoutAnimation({
      overlay,
      element: exitElement,
      startRect,
      endRect,
      delayMs: panelTiming.delayMs,
      durationMs: panelTiming.durationMs,
      overshootDeltaX: startRect.left - endRect.left,
      overshootDeltaY: startRect.top - endRect.top,
      animations,
      zIndex: getDockLayoutOverlayZIndex(id, 'panel'),
    });
  });

  removeOverlayIfEmpty(overlay);

  return animations;
}
