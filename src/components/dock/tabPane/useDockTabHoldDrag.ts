import { useCallback, useEffect, useRef, useState } from 'react';

import type { DockPanel } from '../../../types/dock';
import { HOLD_DURATION } from './layoutMath';

export type HoldProgress = 'idle' | 'holding' | 'ready' | 'fading';

// Finger jitter tolerated while holding; a larger move on touch/pen means the
// user is swiping, not waiting for the hold, so the hold cancels.
const HOLD_MOVE_SLOP_PX = 10;

export interface HoldPointerInput {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: string;
}

interface HoldStartState {
  panel: DockPanel;
  offset: { x: number; y: number };
  pointerPos: { x: number; y: number };
  startPos: { x: number; y: number };
  pointerId: number;
  pointerType: string;
}

interface UseDockTabHoldDragArgs {
  groupId: string;
  startDrag: (
    panel: DockPanel,
    sourceGroupId: string,
    offset: { x: number; y: number },
    mousePos: { x: number; y: number },
  ) => void;
}

export function useDockTabHoldDrag({ groupId, startDrag }: UseDockTabHoldDragArgs) {
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<HoldStartState | null>(null);
  const lastPointerDownTypeRef = useRef<string>('mouse');
  const [holdingTabId, setHoldingTabId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState<HoldProgress>('idle');

  const notePointerDown = useCallback((pointerType: string) => {
    lastPointerDownTypeRef.current = pointerType;
  }, []);

  // Android fires contextmenu on long-press; on touch the long-press already
  // means "pick up this tab", so tab context menus check this before opening.
  const isTouchPointerDown = useCallback(() => lastPointerDownTypeRef.current === 'touch', []);

  const startHold = useCallback((
    tabId: string,
    panel: DockPanel,
    target: HTMLElement,
    pointer: HoldPointerInput,
  ) => {
    const rect = target.getBoundingClientRect();
    const offset = {
      x: pointer.clientX - rect.left,
      y: pointer.clientY - rect.top,
    };

    setHoldingTabId(tabId);
    setHoldProgress('holding');
    holdStartRef.current = {
      panel,
      offset,
      pointerPos: { x: pointer.clientX, y: pointer.clientY },
      startPos: { x: pointer.clientX, y: pointer.clientY },
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
    };

    holdTimerRef.current = window.setTimeout(() => {
      if (holdStartRef.current) {
        setHoldProgress('ready');
        const { panel: pendingPanel, offset: pendingOffset, pointerPos } = holdStartRef.current;
        startDrag(pendingPanel, groupId, pendingOffset, pointerPos);
        window.setTimeout(() => {
          setHoldProgress('idle');
          setHoldingTabId(null);
        }, 100);
      }
    }, HOLD_DURATION);
  }, [groupId, startDrag]);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = null;

    if (holdProgress === 'holding') {
      setHoldProgress('fading');
      window.setTimeout(() => {
        setHoldProgress('idle');
        setHoldingTabId(null);
      }, HOLD_DURATION);
    } else {
      setHoldProgress('idle');
      setHoldingTabId(null);
    }
  }, [holdProgress]);

  const cancelHoldIfHolding = useCallback(() => {
    if (holdProgress === 'holding') {
      cancelHold();
    }
  }, [cancelHold, holdProgress]);

  useEffect(() => {
    const handleGlobalPointerEnd = (event: PointerEvent) => {
      if (holdProgress !== 'holding') return;
      if (holdStartRef.current && event.pointerId !== holdStartRef.current.pointerId) return;
      cancelHold();
    };

    const handleGlobalPointerMove = (event: PointerEvent) => {
      if (holdProgress !== 'holding' || !holdStartRef.current) return;
      if (event.pointerId !== holdStartRef.current.pointerId) return;
      holdStartRef.current.pointerPos = { x: event.clientX, y: event.clientY };

      if (holdStartRef.current.pointerType !== 'mouse') {
        const dx = event.clientX - holdStartRef.current.startPos.x;
        const dy = event.clientY - holdStartRef.current.startPos.y;
        if (Math.hypot(dx, dy) > HOLD_MOVE_SLOP_PX) {
          cancelHold();
        }
      }
    };

    // A nearby resize/gesture handler may stop touch events while the tab has
    // implicit pointer capture. Observe them during capture so releasing the
    // finger always either cancels the hold or reaches the active dock drag.
    window.addEventListener('pointerup', handleGlobalPointerEnd, true);
    window.addEventListener('pointercancel', handleGlobalPointerEnd, true);
    window.addEventListener('pointermove', handleGlobalPointerMove, true);

    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerEnd, true);
      window.removeEventListener('pointercancel', handleGlobalPointerEnd, true);
      window.removeEventListener('pointermove', handleGlobalPointerMove, true);
    };
  }, [cancelHold, holdProgress]);

  useEffect(() => (
    () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
    }
  ), []);

  return {
    holdingTabId,
    holdProgress,
    startHold,
    cancelHold,
    cancelHoldIfHolding,
    notePointerDown,
    isTouchPointerDown,
  };
}
