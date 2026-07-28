import type {
  DockLayoutAnimationItem,
  DockLayoutAnimationSnapshot,
  DockLayoutChildAnimationItem,
} from './layoutAnimationTypes';
import type {
  DockLayoutStartTransitionDirection,
  DockLayoutTransitionStaggerMode,
} from '../../../types/dock';
import {
  DOCK_LAYOUT_ANIMATION_CLEANUP_BUFFER_MS,
  DOCK_LAYOUT_ANIMATION_SELECTOR,
  DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR,
} from './layoutAnimationTypes';
import { cloneElementForLayoutTransition } from './layoutAnimationDom';
import { shouldAnimateLiveLayoutElement, toAnimationRect } from './layoutAnimationMath';

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

export function captureDockLayoutAnimationSnapshot(
  container: HTMLElement,
  durationMs: number,
  staggerMode: DockLayoutTransitionStaggerMode = 'puzzle',
  startTransitionDirection?: DockLayoutStartTransitionDirection,
): DockLayoutAnimationSnapshot {
  const items = new Map<string, DockLayoutAnimationItem>();
  const elements = container.querySelectorAll<HTMLElement>(DOCK_LAYOUT_ANIMATION_SELECTOR);

  elements.forEach((element) => {
    if (staggerMode === 'sequence' && !element.classList.contains('dock-tab-pane')) {
      return;
    }

    const id = element.dataset.dockLayoutAnimId;
    if (!id || items.has(id)) return;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const animateLiveElement = shouldAnimateLiveLayoutElement(id);
    items.set(id, {
      id,
      title: element.dataset.dockLayoutAnimTitle ?? '',
      rect: toAnimationRect(rect),
      clone: animateLiveElement
        ? undefined
        : cloneElementForLayoutTransition(element, 'dock-layout-transition-clone'),
      liveElement: animateLiveElement ? element : undefined,
      childItems: animateLiveElement ? new Map() : captureDockLayoutChildAnimationItems(element),
    });
  });

  return {
    durationMs,
    staggerMode,
    startTransitionDirection,
    items,
  };
}

export function getDockLayoutAnimationTimeoutMs(snapshot: DockLayoutAnimationSnapshot): number {
  return snapshot.durationMs + DOCK_LAYOUT_ANIMATION_CLEANUP_BUFFER_MS;
}
