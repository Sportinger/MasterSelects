export interface DockLayoutAnimationRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DockLayoutChildAnimationItem {
  id: string;
  rect: DockLayoutAnimationRect;
}

export interface DockLayoutAnimationItem {
  id: string;
  title: string;
  rect: DockLayoutAnimationRect;
  clone: HTMLElement;
  liveElement?: HTMLElement;
  childItems: Map<string, DockLayoutChildAnimationItem>;
}

export interface DockLayoutAnimationSnapshot {
  durationMs: number;
  items: Map<string, DockLayoutAnimationItem>;
}

export interface DockLayoutAnimationTarget {
  element: HTMLElement;
  id: string;
  rect: DOMRect;
  previous: DockLayoutAnimationItem | null;
  delayMs: number;
  durationMs: number;
}

export type DockLayoutEdge = 'left' | 'right' | 'top' | 'bottom';

export const DOCK_LAYOUT_ANIMATION_SELECTOR = '[data-dock-layout-anim-id]';
export const DOCK_LAYOUT_CHILD_ANIMATION_SELECTOR = '[data-dock-layout-child-anim-id]';
export const DOCK_LAYOUT_ANIMATION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const DOCK_LAYOUT_PUZZLE_STAGGER_MAX_RATIO = 0.22;
export const DOCK_LAYOUT_PUZZLE_DURATION_RATIO = 0.72;
export const DOCK_LAYOUT_ANIMATION_CLEANUP_BUFFER_MS = 180;
export const DOCK_LAYOUT_TIMELINE_REVEAL_RATIO = 0.5;
