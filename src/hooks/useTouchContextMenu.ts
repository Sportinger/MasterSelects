import { useEffect } from 'react';

import { isDockResizeActive } from '../components/dock/dockResizeDomState';

const LONG_PRESS_MS = 520;
const LONG_PRESS_MOVE_TOLERANCE_PX = 12;
const SYNTHETIC_CONTEXT_MENU_MARKER = '__masterSelectsTouchContextMenu';
const SYNTHETIC_POINTER_CANCEL_MARKER = '__masterSelectsTouchContextMenuCancel';

type LongPressState = {
  pointerId: number | null;
  touchIdentifier: number | null;
  target: Element;
  startX: number;
  startY: number;
  timerId: number;
  fired: boolean;
};

type MarkedEvent = Event & Record<string, unknown>;

type SuppressedClick = {
  until: number;
};

export function isSyntheticTouchContextMenuEvent(event?: Event): boolean {
  return Boolean(event && (event as MarkedEvent)[SYNTHETIC_CONTEXT_MENU_MARKER]);
}

/** Maps a stationary primary touch to the editor's existing right-click path. */
export function useTouchContextMenu(): void {
  useEffect(() => {
    let press: LongPressState | null = null;
    let suppressedClick: SuppressedClick | null = null;

    const clearPress = () => {
      if (press) window.clearTimeout(press.timerId);
      press = null;
    };

    const cancelActivePointerGesture = (state: LongPressState) => {
      if (state.pointerId === null) return;
      const cancelEvent = typeof PointerEvent === 'function'
        ? new PointerEvent('pointercancel', {
            bubbles: true,
            cancelable: false,
            pointerId: state.pointerId,
            pointerType: 'touch',
          })
        : new MouseEvent('pointercancel', { bubbles: true });
      if (!('pointerId' in cancelEvent)) {
        Object.defineProperty(cancelEvent, 'pointerId', { value: state.pointerId });
      }
      Object.defineProperty(cancelEvent, SYNTHETIC_POINTER_CANCEL_MARKER, { value: true });
      state.target.dispatchEvent(cancelEvent);
    };

    const resolveCurrentMediaTarget = (state: LongPressState): Element | null => {
      const startedInMediaPanel = state.target.closest('.media-panel-content') !== null;
      if (state.target.isConnected && startedInMediaPanel) return state.target;
      if (typeof document.elementsFromPoint !== 'function') return null;

      const currentTarget = document.elementsFromPoint(state.startX, state.startY)
        .find((element) => element.closest('.media-panel-content') !== null);
      if (!currentTarget) return null;
      if (startedInMediaPanel) return currentTarget;

      // A restored mobile dock can briefly leave a dock-owned hit surface over
      // Media while its content settles. Only bypass that editor chrome, never
      // dialogs or unrelated overlays.
      return state.target.closest('.dock-panel-content, .dock-resize-handle, .dock-tab-pane')
        ? currentTarget
        : null;
    };

    const dispatchContextMenu = (state: LongPressState): boolean => {
      if (isDockResizeActive()) return false;
      const currentMediaTarget = resolveCurrentMediaTarget(state);
      const dispatchTarget = currentMediaTarget ?? (state.target.isConnected ? state.target : null);
      if (!dispatchTarget) return false;
      const contextMenuEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 0,
        clientX: state.startX,
        clientY: state.startY,
      });
      Object.defineProperty(contextMenuEvent, SYNTHETIC_CONTEXT_MENU_MARKER, { value: true });
      dispatchTarget.dispatchEvent(contextMenuEvent);
      if (contextMenuEvent.defaultPrevented) state.target = dispatchTarget;
      return contextMenuEvent.defaultPrevented;
    };

    const startPress = ({
      pointerId = null,
      touchIdentifier = null,
      target,
      clientX,
      clientY,
    }: {
      pointerId?: number | null;
      touchIdentifier?: number | null;
      target: Element;
      clientX: number;
      clientY: number;
    }) => {
      if (target.closest('.draggable-number')) return;

      const state: LongPressState = {
        pointerId,
        touchIdentifier,
        target,
        startX: clientX,
        startY: clientY,
        timerId: 0,
        fired: false,
      };
      state.timerId = window.setTimeout(() => {
        if (press !== state) return;
        if (!dispatchContextMenu(state)) {
          clearPress();
          return;
        }
        state.fired = true;
        cancelActivePointerGesture(state);
      }, LONG_PRESS_MS);
      press = state;
    };

    const findTouch = (touches: TouchList, identifier: number): Touch | null => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item?.(index) ?? touches[index];
        if (touch?.identifier === identifier) return touch;
      }
      return null;
    };

    const finishPress = (event: Event) => {
      if (!press) return;
      const completedPress = press;
      const didFire = completedPress.fired;
      clearPress();
      if (!didFire) return;
      suppressedClick = {
        until: performance.now() + 800,
      };
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.button !== 0) return;
      // A new physical contact is an intentional menu interaction. The click
      // suppression below only belongs to the release that ended the hold.
      suppressedClick = null;
      if (press) {
        if (press.pointerId === null && press.touchIdentifier !== null) {
          press.pointerId = event.pointerId;
          return;
        }
        // A second finger belongs to a pinch or another multi-touch gesture.
        clearPress();
        return;
      }
      if (!(event.target instanceof Element)) return;
      startPress({
        pointerId: event.pointerId,
        touchIdentifier: null,
        target: event.target,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId || press.fired) return;
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearPress();
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (press.touchIdentifier !== null) {
        // Touch Events own completion when both streams are available. This
        // also gives the Media Panel enough information to recognize a tap.
        press.pointerId = null;
        return;
      }
      finishPress(event);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if ((event as unknown as MarkedEvent)[SYNTHETIC_POINTER_CANCEL_MARKER]) return;
      if (!press || event.pointerId !== press.pointerId) return;
      if (press.touchIdentifier !== null) {
        // Safari may cancel Pointer Events while continuing to deliver the
        // corresponding Touch Events. Keep the hold alive until that touch
        // moves or ends instead of losing long-press after a page reload.
        press.pointerId = null;
        return;
      }
      finishPress(event);
    };

    const handleTouchStart = (event: TouchEvent) => {
      // Safari can deliver Touch Events before Pointer Events. Clear the hold
      // release guard here as well so the first deliberate tap remains usable.
      suppressedClick = null;
      if (event.touches.length !== 1) {
        clearPress();
        return;
      }
      const touch = event.touches.item?.(0) ?? event.touches[0];
      if (!touch || !(event.target instanceof Element)) return;
      if (press) {
        if (press.touchIdentifier === null) {
          press.touchIdentifier = touch.identifier;
          return;
        }
        if (press.touchIdentifier !== touch.identifier) clearPress();
        return;
      }
      startPress({
        pointerId: null,
        touchIdentifier: touch.identifier,
        target: event.target,
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!press || press.touchIdentifier === null || press.fired) return;
      const touch = findTouch(event.touches, press.touchIdentifier);
      if (!touch) {
        clearPress();
        return;
      }
      if (Math.hypot(touch.clientX - press.startX, touch.clientY - press.startY) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        clearPress();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!press || press.touchIdentifier === null) return;
      if (!findTouch(event.changedTouches, press.touchIdentifier)) return;
      const completedPress = press;
      if (completedPress.fired) {
        finishPress(event);
        return;
      }

      clearPress();
    };

    const handleTouchCancel = (event: TouchEvent) => {
      if (!press || press.touchIdentifier === null) return;
      if (!findTouch(event.changedTouches, press.touchIdentifier)) return;
      clearPress();
    };

    const handleClick = (event: MouseEvent) => {
      const suppression = suppressedClick;
      if (!suppression) return;
      if (performance.now() >= suppression.until) {
        suppressedClick = null;
        return;
      }
      // The context menu is mounted while the original finger is still down.
      // WebKit may therefore retarget the compatibility click to the newly
      // appeared menu item under that finger. Suppress that one click no
      // matter which element it lands on; a fresh touch/pointerdown clears the
      // guard above before a deliberate menu tap.
      suppressedClick = null;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: true });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerCancel, { capture: true, passive: false });
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
    window.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });
    window.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });
    document.addEventListener('click', handleClick, true);
    document.addEventListener('dblclick', handleClick, true);
    return () => {
      clearPress();
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      document.removeEventListener('touchstart', handleTouchStart, true);
      window.removeEventListener('touchmove', handleTouchMove, true);
      window.removeEventListener('touchend', handleTouchEnd, true);
      window.removeEventListener('touchcancel', handleTouchCancel, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('dblclick', handleClick, true);
    };
  }, []);
}
