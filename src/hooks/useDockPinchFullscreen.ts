import { useEffect } from 'react';

import { useDockStore } from '../stores/dockStore';
import { findTabGroupById } from '../stores/dockStore/layoutTree';
import { isEditableValueTouchSessionActive } from '../services/input/editableValueTouchSession';

type PinchPointer = {
  clientX: number;
  clientY: number;
  target: Element;
};

type DockPinch = {
  committed: boolean;
  panelId: string;
  pointerIds: [number, number];
  startDistance: number;
};

type SafariGestureEvent = Event & {
  readonly scale?: number;
};

const PINCH_OUT_THRESHOLD = 1.12;
const PINCH_IN_THRESHOLD = 1 / PINCH_OUT_THRESHOLD;
const SYNTHETIC_PINCH_CANCEL_MARKER = '__masterSelectsDockPinchCancel';

function getDistance(first: PinchPointer, second: PinchPointer): number {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function getPane(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>('.dock-tab-pane');
}

function paneKeepsNativePinch(pane: HTMLElement): boolean {
  if (pane.dataset.activePanelType === 'timeline') return true;
  return pane.querySelector([
    '.preview-container[data-preview-edit-mode="true"]',
    '.preview-container[data-preview-pinch-reserved="true"]',
  ].join(',')) !== null;
}

function getActivePanelId(pane: HTMLElement): string | null {
  const groupId = pane.dataset.groupId;
  const dockState = useDockStore.getState();
  const group = groupId ? findTabGroupById(dockState.layout.root, groupId) : null;
  const panel = group?.panels[group.activeIndex];
  return panel && panel.type !== 'timeline' ? panel.id : null;
}

function stopPinchEvent(event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function cancelFirstTouchInteraction(pointerId: number, target: Element): void {
  const cancelEvent = typeof PointerEvent === 'function'
    ? new PointerEvent('pointercancel', {
        bubbles: true,
        pointerId,
        pointerType: 'touch',
      })
    : new MouseEvent('pointercancel', { bubbles: true });
  Object.defineProperty(cancelEvent, 'pointerId', { configurable: true, value: pointerId });
  Object.defineProperty(cancelEvent, SYNTHETIC_PINCH_CANCEL_MARKER, { value: true });
  target.dispatchEvent(cancelEvent);
}

/** Pinch-out maximizes the active dock tab; pinch-in restores it. */
export function useDockPinchFullscreen(): void {
  useEffect(() => {
    const pointers = new Map<number, PinchPointer>();
    let pinch: DockPinch | null = null;
    let safariGesturePinch: Pick<DockPinch, 'committed' | 'panelId'> | null = null;
    let suppressPointerStream = false;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
      if (event.target.closest('.draggable-number')) return;
      if (isEditableValueTouchSessionActive()) return;
      pointers.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      });

      if (pointers.size !== 2) {
        if (suppressPointerStream) stopPinchEvent(event);
        return;
      }

      const entries = [...pointers.entries()];
      const [[firstId, first], [secondId, second]] = entries;
      const firstPane = getPane(first.target);
      const secondPane = getPane(second.target);
      if (!firstPane || firstPane !== secondPane || paneKeepsNativePinch(firstPane)) return;

      const panelId = getActivePanelId(firstPane);
      if (!panelId) return;

      pinch = {
        committed: false,
        panelId,
        pointerIds: [firstId, secondId],
        startDistance: Math.max(1, getDistance(first, second)),
      };
      suppressPointerStream = true;
      cancelFirstTouchInteraction(firstId, first.target);
      stopPinchEvent(event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const current = pointers.get(event.pointerId);
      if (!current) return;
      pointers.set(event.pointerId, {
        ...current,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (!pinch) return;

      stopPinchEvent(event);
      if (pinch.committed) return;
      const [first, second] = pinch.pointerIds.map(pointerId => pointers.get(pointerId));
      if (!first || !second) return;

      const scale = getDistance(first, second) / pinch.startDistance;
      if (scale >= PINCH_OUT_THRESHOLD) {
        useDockStore.getState().setMaximizedPanel(pinch.panelId);
        pinch.committed = true;
      } else if (scale <= PINCH_IN_THRESHOLD) {
        if (useDockStore.getState().maximizedPanelId === pinch.panelId) {
          useDockStore.getState().setMaximizedPanel(null);
        }
        pinch.committed = true;
      }
    };

    const handlePointerFinish = (event: PointerEvent) => {
      if ((event as PointerEvent & Record<string, unknown>)[SYNTHETIC_PINCH_CANCEL_MARKER]) return;
      if (!pointers.has(event.pointerId)) return;
      const shouldStop = suppressPointerStream;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) suppressPointerStream = false;
      if (shouldStop) stopPinchEvent(event);
    };

    // Safari exposes a separate gesture stream for viewport pinch. Keep it as
    // a fallback in case the browser withholds PointerEvent moves while it is
    // deciding whether to scale the page.
    const handleGestureStart = (event: Event) => {
      if (isEditableValueTouchSessionActive()) {
        event.preventDefault();
        return;
      }
      if (!(event.target instanceof Element)) return;
      const pane = getPane(event.target);
      if (!pane || paneKeepsNativePinch(pane)) return;
      const panelId = getActivePanelId(pane);
      if (!panelId) return;

      event.preventDefault();
      safariGesturePinch = { committed: false, panelId };
    };

    const handleGestureChange = (event: Event) => {
      if (!safariGesturePinch) return;
      event.preventDefault();
      if (safariGesturePinch.committed) return;
      const scale = (event as SafariGestureEvent).scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale)) return;

      if (scale >= PINCH_OUT_THRESHOLD) {
        useDockStore.getState().setMaximizedPanel(safariGesturePinch.panelId);
        safariGesturePinch.committed = true;
      } else if (scale <= PINCH_IN_THRESHOLD) {
        if (useDockStore.getState().maximizedPanelId === safariGesturePinch.panelId) {
          useDockStore.getState().setMaximizedPanel(null);
        }
        safariGesturePinch.committed = true;
      }
    };

    const handleGestureEnd = (event: Event) => {
      if (!safariGesturePinch) return;
      event.preventDefault();
      safariGesturePinch = null;
    };

    document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerFinish, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerFinish, { capture: true, passive: false });
    document.addEventListener('gesturestart', handleGestureStart, { capture: true, passive: false });
    window.addEventListener('gesturechange', handleGestureChange, { capture: true, passive: false });
    window.addEventListener('gestureend', handleGestureEnd, { capture: true, passive: false });
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerFinish, true);
      window.removeEventListener('pointercancel', handlePointerFinish, true);
      document.removeEventListener('gesturestart', handleGestureStart, true);
      window.removeEventListener('gesturechange', handleGestureChange, true);
      window.removeEventListener('gestureend', handleGestureEnd, true);
    };
  }, []);
}
