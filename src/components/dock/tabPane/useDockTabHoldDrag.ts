import { useCallback, useEffect, useRef, useState } from 'react';

import type { DockPanel } from '../../../types/dock';
import { HOLD_DURATION } from './layoutMath';

export type HoldProgress = 'idle' | 'holding' | 'ready' | 'fading';

interface HoldStartState {
  panel: DockPanel;
  offset: { x: number; y: number };
  mousePos: { x: number; y: number };
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
  const [holdingTabId, setHoldingTabId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState<HoldProgress>('idle');

  const startHold = useCallback((
    tabId: string,
    panel: DockPanel,
    target: HTMLElement,
    clientX: number,
    clientY: number,
  ) => {
    const rect = target.getBoundingClientRect();
    const offset = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
    const mousePos = { x: clientX, y: clientY };

    setHoldingTabId(tabId);
    setHoldProgress('holding');
    holdStartRef.current = { panel, offset, mousePos };

    holdTimerRef.current = window.setTimeout(() => {
      if (holdStartRef.current) {
        setHoldProgress('ready');
        const { panel: pendingPanel, offset: pendingOffset, mousePos: pendingMousePos } = holdStartRef.current;
        startDrag(pendingPanel, groupId, pendingOffset, pendingMousePos);
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
    const handleGlobalMouseUp = () => {
      if (holdProgress === 'holding') {
        cancelHold();
      }
    };

    const handleGlobalMouseMove = (event: MouseEvent) => {
      if (holdProgress === 'holding' && holdStartRef.current) {
        holdStartRef.current.mousePos = { x: event.clientX, y: event.clientY };
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
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
  };
}
