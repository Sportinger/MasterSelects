import type {
  DockLayoutStartTransitionDirection,
  DockLayoutTransitionStaggerMode,
} from '../../types/dock';

export const DOCK_LAYOUT_TRANSITION_EVENT = 'masterselects:dock-layout-transition';
export const START_CHROME_TRANSITION_EVENT = 'masterselects:start-chrome-transition';

const DOCK_LAYOUT_TRANSITION_DURATION_MS = 500;

export function requestDockLayoutTransition(
  durationMs = DOCK_LAYOUT_TRANSITION_DURATION_MS,
  staggerMode: DockLayoutTransitionStaggerMode = 'puzzle',
  startTransitionDirection?: DockLayoutStartTransitionDirection,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(DOCK_LAYOUT_TRANSITION_EVENT, {
    detail: { durationMs, staggerMode, startTransitionDirection },
  }));
  if (startTransitionDirection) {
    window.dispatchEvent(new CustomEvent(START_CHROME_TRANSITION_EVENT, {
      detail: { durationMs, direction: startTransitionDirection },
    }));
  }
}
