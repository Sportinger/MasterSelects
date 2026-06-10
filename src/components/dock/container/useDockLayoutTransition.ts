import { useEffect, useLayoutEffect, useRef } from 'react';

import { DOCK_LAYOUT_TRANSITION_EVENT } from '../../../stores/dockStore';
import type { DockLayout } from '../../../types/dock';
import { animateDockLayoutTransition } from './layoutAnimationRunner';
import {
  captureDockLayoutAnimationSnapshot,
  getDockLayoutAnimationTimeoutMs,
} from './layoutAnimationSnapshot';
import type { DockLayoutAnimationSnapshot } from './layoutAnimationTypes';

interface UseDockLayoutTransitionArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  layout: DockLayout;
}

export function useDockLayoutTransition({
  containerRef,
  layout,
}: UseDockLayoutTransitionArgs): void {
  const layoutAnimationTimeoutRef = useRef<number | null>(null);
  const layoutAnimationsRef = useRef<Animation[]>([]);
  const pendingLayoutAnimationRef = useRef<DockLayoutAnimationSnapshot | null>(null);

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
  }, [containerRef]);

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
  }, [containerRef, layout]);

  useEffect(() => () => {
    if (layoutAnimationTimeoutRef.current) {
      window.clearTimeout(layoutAnimationTimeoutRef.current);
      layoutAnimationTimeoutRef.current = null;
    }
    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
    layoutAnimationsRef.current = [];
    containerRef.current?.classList.remove('layout-switch-animating');
  }, [containerRef]);
}
