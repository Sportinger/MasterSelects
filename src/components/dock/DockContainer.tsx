// Root dock container - wraps docked panels and renders floating panels

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { DOCK_LAYOUT_TRANSITION_EVENT, useDockStore } from '../../stores/dockStore';
import type { DropTarget } from '../../types/dock';
import { calculateRootEdgeDropPosition } from '../../utils/dockLayout';
import { DockNode } from './DockNode';
import { FloatingPanel } from './FloatingPanel';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import './dock.css';

interface DockLayoutAnimationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DockLayoutAnimationItem {
  id: string;
  title: string;
  rect: DockLayoutAnimationRect;
  clone: HTMLElement;
  liveElement?: HTMLElement;
  childItems: Map<string, DockLayoutChildAnimationItem>;
}

interface DockLayoutAnimationSnapshot {
  durationMs: number;
  items: Map<string, DockLayoutAnimationItem>;
}

interface DockLayoutChildAnimationItem {
  id: string;
  rect: DockLayoutAnimationRect;
}

const DOCK_LAYOUT_ANIMATION_SELECTOR = '[data-dock-layout-anim-id]';
const DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR = '[data-dock-layout-child-anim-id]';
const DOCK_LAYOUT_ANIMATION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const DOCK_LAYOUT_PUZZLE_STAGGER_MAX_RATIO = 0.22;
const DOCK_LAYOUT_PUZZLE_DURATION_RATIO = 0.72;
const DOCK_LAYOUT_ANIMATION_CLEANUP_BUFFER_MS = 180;
const DOCK_LAYOUT_TIMELINE_REVEAL_RATIO = 0.5;

interface DockLayoutAnimationTarget {
  element: HTMLElement;
  id: string;
  rect: DOMRect;
  previous: DockLayoutAnimationItem | null;
  delayMs: number;
  durationMs: number;
}

type DockLayoutEdge = 'left' | 'right' | 'top' | 'bottom';

function toAnimationRect(rect: DOMRect): DockLayoutAnimationRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashAnimationId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function getPuzzleAnimationTiming(
  id: string,
  rect: DockLayoutAnimationRect | DOMRect,
  containerRect: DOMRect,
  snapshotDurationMs: number,
  movementDistance: number,
): Pick<DockLayoutAnimationTarget, 'delayMs' | 'durationMs'> {
  const normalizedX = clampNumber((rect.left - containerRect.left) / Math.max(containerRect.width, 1), 0, 1);
  const normalizedY = clampNumber((rect.top - containerRect.top) / Math.max(containerRect.height, 1), 0, 1);
  const layoutWave = (normalizedX * 0.42) + (normalizedY * 0.58);
  const movementWeight = clampNumber(movementDistance / 720, 0, 1);
  const idJitter = (hashAnimationId(id) % 5) * Math.max(9, snapshotDurationMs * 0.012);
  const staggerMaxMs = Math.max(0, snapshotDurationMs * DOCK_LAYOUT_PUZZLE_STAGGER_MAX_RATIO);
  const delayMs = Math.round(layoutWave * staggerMaxMs + movementWeight * snapshotDurationMs * 0.04 + idJitter);
  const maxDurationMs = Math.max(180, snapshotDurationMs - delayMs);
  const rawDurationMs = Math.round(
    snapshotDurationMs * DOCK_LAYOUT_PUZZLE_DURATION_RATIO
    + movementWeight * snapshotDurationMs * 0.14
    - layoutWave * snapshotDurationMs * 0.08
    + idJitter,
  );

  return {
    delayMs,
    durationMs: clampNumber(rawDurationMs, Math.min(420, maxDurationMs), maxDurationMs),
  };
}

function getPuzzleOvershoot(delta: number): number {
  return clampNumber(-delta * 0.025, -8, 8);
}

function toRelativeRect(rect: DockLayoutAnimationRect | DOMRect, containerRect: DOMRect): DockLayoutAnimationRect {
  return {
    left: rect.left - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
    height: rect.height,
  };
}

function toPx(value: number): string {
  return `${value}px`;
}

function cloneElementForLayoutTransition(element: HTMLElement, className: string): HTMLElement {
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

function captureDockLayoutChildAnimationItems(element: HTMLElement): Map<string, DockLayoutChildAnimationItem> {
  const childItems = new Map<string, DockLayoutChildAnimationItem>();
  const childElements = element.querySelectorAll<HTMLElement>(DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR);

  childElements.forEach((childElement) => {
    const id = childElement.dataset.dockLayoutChildAnimId;
    if (!id || childItems.has(id)) return;

    const rect = childElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    childItems.set(id, {
      id,
      rect: toAnimationRect(rect),
    });
  });

  return childItems;
}

function captureDockLayoutAnimationSnapshot(container: HTMLElement, durationMs: number): DockLayoutAnimationSnapshot {
  const items = new Map<string, DockLayoutAnimationItem>();
  const elements = container.querySelectorAll<HTMLElement>(DOCK_LAYOUT_ANIMATION_SELECTOR);

  elements.forEach((element) => {
    const id = element.dataset.dockLayoutAnimId;
    if (!id || items.has(id)) return;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    items.set(id, {
      id,
      title: element.dataset.dockLayoutAnimTitle ?? '',
      rect: toAnimationRect(rect),
      clone: cloneElementForLayoutTransition(element, 'dock-layout-transition-clone'),
      liveElement: isPreviewLayoutAnimationId(id) ? element : undefined,
      childItems: captureDockLayoutChildAnimationItems(element),
    });
  });

  return { durationMs, items };
}

function createDockLayoutTransitionOverlay(container: HTMLElement): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'dock-layout-transition-overlay';
  container.appendChild(overlay);
  return overlay;
}

function removeOverlayIfEmpty(overlay: HTMLElement): void {
  if (overlay.childElementCount === 0) {
    overlay.remove();
  }
}

function collectTargetChildAnimationElements(element: HTMLElement): Map<string, HTMLElement> {
  const childTargets = new Map<string, HTMLElement>();
  const childElements = element.querySelectorAll<HTMLElement>(DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR);

  childElements.forEach((childElement) => {
    const id = childElement.dataset.dockLayoutChildAnimId;
    if (!id || childTargets.has(id)) return;
    childTargets.set(id, childElement);
  });

  return childTargets;
}

function getNearestDockLayoutEdge(rect: DockLayoutAnimationRect, containerRect: DOMRect): DockLayoutEdge {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const distances: Record<DockLayoutEdge, number> = {
    left: centerX,
    right: Math.max(0, containerRect.width - centerX),
    top: centerY,
    bottom: Math.max(0, containerRect.height - centerY),
  };

  return (Object.entries(distances) as Array<[DockLayoutEdge, number]>)
    .reduce((nearest, candidate) => (candidate[1] < nearest[1] ? candidate : nearest))[0];
}

function getDockLayoutEdgeRect(rect: DockLayoutAnimationRect, containerRect: DOMRect): DockLayoutAnimationRect {
  const edge = getNearestDockLayoutEdge(rect, containerRect);
  const padding = 28;

  switch (edge) {
    case 'left':
      return { ...rect, left: -rect.width - padding };
    case 'right':
      return { ...rect, left: containerRect.width + padding };
    case 'top':
      return { ...rect, top: -rect.height - padding };
    case 'bottom':
      return { ...rect, top: containerRect.height + padding };
    default:
      return rect;
  }
}

function isTimelineLayoutAnimationId(id: string): boolean {
  return id === 'panel:timeline' || id.startsWith('timeline-');
}

function isPreviewLayoutAnimationId(id: string): boolean {
  return id === 'panel:preview'
    || id.startsWith('panel:preview-')
    || id === 'panel:multi-preview'
    || id.startsWith('panel:multi-preview-');
}

function getDockLayoutOverlayZIndex(id: string, kind: 'panel' | 'child'): string {
  if (isTimelineLayoutAnimationId(id)) {
    return kind === 'child' ? '4' : '3';
  }

  return kind === 'child' ? '24' : '20';
}

function getDockLayoutEffectiveTiming(
  id: string,
  snapshotDurationMs: number,
  delayMs: number,
  durationMs: number,
): Pick<DockLayoutAnimationTarget, 'delayMs' | 'durationMs'> {
  if (!isTimelineLayoutAnimationId(id)) {
    return { delayMs, durationMs };
  }

  return {
    delayMs: 0,
    durationMs: Math.max(120, Math.round(snapshotDurationMs * DOCK_LAYOUT_TIMELINE_REVEAL_RATIO)),
  };
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

function pushElementLayoutAnimation({
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

function pushLiveElementLayoutAnimation({
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

function animateDockLayoutTransition(container: HTMLElement, snapshot: DockLayoutAnimationSnapshot): Animation[] {
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

      if (isPreviewLayoutAnimationId(id)) {
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

    if (isPreviewLayoutAnimationId(id)) {
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

    const exitElement = isPreviewLayoutAnimationId(id) && previous.liveElement
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

function getDockLayoutAnimationTimeoutMs(snapshot: DockLayoutAnimationSnapshot): number {
  return snapshot.durationMs + DOCK_LAYOUT_ANIMATION_CLEANUP_BUFFER_MS;
}

export function DockContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const maximizeAnimationTimeoutRef = useRef<number | null>(null);
  const layoutAnimationTimeoutRef = useRef<number | null>(null);
  const layoutAnimationsRef = useRef<Animation[]>([]);
  const pendingLayoutAnimationRef = useRef<DockLayoutAnimationSnapshot | null>(null);
  const { layout, dragState, endDrag, cancelDrag, updateDrag, toggleHoveredTabMaximized, maximizedPanelId } = useDockStore();

  const getRootEdgeDropTarget = useCallback((mouseX: number, mouseY: number): DropTarget | null => {
    const container = containerRef.current;
    if (!container) return null;

    const position = calculateRootEdgeDropPosition(container.getBoundingClientRect(), mouseX, mouseY);
    if (!position) return null;

    return {
      groupId: layout.root.id,
      position,
      scope: 'root-edge',
    };
  }, [layout.root.id]);

  const rootEdgeDropPosition = dragState.dropTarget?.scope === 'root-edge'
    ? dragState.dropTarget.position
    : null;

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    container.classList.add('maximize-animating');
    if (maximizeAnimationTimeoutRef.current) {
      window.clearTimeout(maximizeAnimationTimeoutRef.current);
    }
    maximizeAnimationTimeoutRef.current = window.setTimeout(() => {
      container.classList.remove('maximize-animating');
      maximizeAnimationTimeoutRef.current = null;
    }, 320);

    return () => {
      if (maximizeAnimationTimeoutRef.current) {
        window.clearTimeout(maximizeAnimationTimeoutRef.current);
        maximizeAnimationTimeoutRef.current = null;
      }
      container.classList.remove('maximize-animating');
    };
  }, [maximizedPanelId]);

  useEffect(() => {
    const handleLayoutTransition = (event: Event) => {
      const container = containerRef.current;
      if (!container) return;

      const durationMs = event instanceof CustomEvent && typeof event.detail?.durationMs === 'number'
        ? event.detail.durationMs
        : 500;
      pendingLayoutAnimationRef.current = captureDockLayoutAnimationSnapshot(container, durationMs);
      container.classList.add('layout-switch-animating');
    };

    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, handleLayoutTransition);
    return () => {
      window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, handleLayoutTransition);
    };
  }, []);

  useLayoutEffect(() => {
    const snapshot = pendingLayoutAnimationRef.current;
    if (!snapshot) return;

    pendingLayoutAnimationRef.current = null;
    const container = containerRef.current;
    if (!container) return;

    if (layoutAnimationTimeoutRef.current) {
      window.clearTimeout(layoutAnimationTimeoutRef.current);
      layoutAnimationTimeoutRef.current = null;
    }
    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
    layoutAnimationsRef.current = [];

    const animations = animateDockLayoutTransition(container, snapshot);
    layoutAnimationsRef.current = animations;

    const finishLayoutAnimation = () => {
      if (layoutAnimationTimeoutRef.current) {
        window.clearTimeout(layoutAnimationTimeoutRef.current);
      }
      container.classList.remove('layout-switch-animating');
      layoutAnimationTimeoutRef.current = null;
      layoutAnimationsRef.current = [];
    };

    if (animations.length === 0) {
      finishLayoutAnimation();
      return;
    }

    layoutAnimationTimeoutRef.current = window.setTimeout(() => {
      animations.forEach((animation) => animation.cancel());
      finishLayoutAnimation();
    }, getDockLayoutAnimationTimeoutMs(snapshot));

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (layoutAnimationsRef.current !== animations) return;
      finishLayoutAnimation();
    });
  }, [layout]);

  useEffect(() => () => {
    if (layoutAnimationTimeoutRef.current) {
      window.clearTimeout(layoutAnimationTimeoutRef.current);
      layoutAnimationTimeoutRef.current = null;
    }
    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
    layoutAnimationsRef.current = [];
    containerRef.current?.classList.remove('layout-switch-animating');
  }, []);

  // Global mouse handlers for drag operations
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.isDragging) return;

      const rootEdgeTarget = getRootEdgeDropTarget(e.clientX, e.clientY);
      const nextDropTarget = rootEdgeTarget
        ?? (dragState.dropTarget?.scope === 'root-edge' ? null : dragState.dropTarget);

      updateDrag({ x: e.clientX, y: e.clientY }, nextDropTarget);
    };

    const handleMouseUp = () => {
      if (!dragState.isDragging) return;
      endDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;

      if (!isTextInput && registry.matches('panel.toggleHoveredFullscreen', e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleHoveredTabMaximized();
        return;
      }

      if (e.key === 'Escape') {
        cancelDrag();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [dragState.isDragging, dragState.dropTarget, endDrag, cancelDrag, updateDrag, toggleHoveredTabMaximized, getRootEdgeDropTarget]);

  return (
    <div
      ref={containerRef}
      className={`dock-container ${dragState.isDragging ? 'dragging' : ''} ${maximizedPanelId ? 'is-panel-maximized' : ''}`}
    >
      {/* Main docked layout */}
      <div className="dock-root">
        <DockNode node={layout.root} />
      </div>

      {/* Full-root edge target preview */}
      {dragState.isDragging && rootEdgeDropPosition && (
        <div className={`dock-root-drop-overlay ${rootEdgeDropPosition}`} />
      )}

      {/* Floating panels */}
      {layout.floatingPanels.map((floating) => (
        <FloatingPanel key={floating.id} floating={floating} />
      ))}

      {/* Drag preview */}
      {dragState.isDragging && dragState.draggedPanel && (
        <div
          className="dock-drag-preview"
          style={{
            left: dragState.currentPos.x - dragState.dragOffset.x,
            top: dragState.currentPos.y - dragState.dragOffset.y,
          }}
        >
          {dragState.draggedPanel.title}
        </div>
      )}
    </div>
  );
}
