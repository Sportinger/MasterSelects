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
  const dividerFadeTimeoutRef = useRef<number | null>(null);
  const layoutAnimationsRef = useRef<Animation[]>([]);
  const pendingLayoutAnimationRef = useRef<DockLayoutAnimationSnapshot | null>(null);
  const hasWarmedLayoutAnimationRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let warmupFrameId: number | null = null;
    let warmupSecondFrameId: number | null = null;
    let warmupIdleId: number | null = null;
    let warmupTimeoutId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const warmLayoutAnimationRuntime = () => {
      if (cancelled || hasWarmedLayoutAnimationRef.current) return;

      const container = containerRef.current;
      if (
        !container
        || !container.isConnected
        || container.classList.contains('layout-switch-animating')
      ) {
        return;
      }

      hasWarmedLayoutAnimationRef.current = true;
      const snapshot = captureDockLayoutAnimationSnapshot(container, 1);
      const animations = animateDockLayoutTransition(container, snapshot);
      animations.forEach((animation) => animation.cancel());

      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;contain:layout paint style;';
      container.appendChild(probe);
      if (typeof probe.animate !== 'function') {
        probe.remove();
        return;
      }

      const animation = probe.animate(
        [
          { transform: 'translate3d(0, 0, 0)', opacity: 0 },
          { transform: 'translate3d(0.01px, 0, 0)', opacity: 0 },
        ],
        { duration: 1, fill: 'both' },
      );
      const cleanup = () => probe.remove();
      animation.addEventListener('finish', cleanup, { once: true });
      animation.addEventListener('cancel', cleanup, { once: true });
    };

    const scheduleIdleWarmup = () => {
      if (cancelled) return;
      if (typeof idleWindow.requestIdleCallback === 'function') {
        warmupIdleId = idleWindow.requestIdleCallback(warmLayoutAnimationRuntime, { timeout: 1400 });
        return;
      }
      warmupTimeoutId = window.setTimeout(warmLayoutAnimationRuntime, 650);
    };

    warmupFrameId = window.requestAnimationFrame(() => {
      warmupSecondFrameId = window.requestAnimationFrame(scheduleIdleWarmup);
    });

    return () => {
      cancelled = true;
      if (warmupFrameId !== null) {
        window.cancelAnimationFrame(warmupFrameId);
      }
      if (warmupSecondFrameId !== null) {
        window.cancelAnimationFrame(warmupSecondFrameId);
      }
      if (warmupIdleId !== null && typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(warmupIdleId);
      }
      if (warmupTimeoutId !== null) {
        window.clearTimeout(warmupTimeoutId);
      }
    };
  }, [containerRef]);

  useEffect(() => {
    const handleLayoutTransition = (event: Event) => {
      const container = containerRef.current;
      if (!container) return;

      if (dividerFadeTimeoutRef.current) {
        window.clearTimeout(dividerFadeTimeoutRef.current);
        dividerFadeTimeoutRef.current = null;
      }
      container.classList.remove('layout-switch-divider-fade-in');

      const durationMs = event instanceof CustomEvent && typeof event.detail?.durationMs === 'number'
        ? event.detail.durationMs
        : 500;
      const staggerMode = event instanceof CustomEvent && event.detail?.staggerMode === 'sequence'
        ? 'sequence'
        : 'puzzle';
      const startTransitionDirection = event instanceof CustomEvent
        && (
          event.detail?.startTransitionDirection === 'to-start'
          || event.detail?.startTransitionDirection === 'from-start'
        )
        ? event.detail.startTransitionDirection
        : undefined;
      pendingLayoutAnimationRef.current = captureDockLayoutAnimationSnapshot(
        container,
        durationMs,
        staggerMode,
        startTransitionDirection,
      );
      container.classList.add('layout-switch-animating');
      container.classList.toggle('layout-switch-start-surface', staggerMode === 'sequence');
      container.classList.toggle('layout-switch-to-start', startTransitionDirection === 'to-start');
      container.classList.toggle('layout-switch-from-start', startTransitionDirection === 'from-start');
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
      if (snapshot.startTransitionDirection === 'from-start') {
        container.classList.add('layout-switch-divider-fade-in');
        dividerFadeTimeoutRef.current = window.setTimeout(() => {
          container.classList.remove('layout-switch-divider-fade-in');
          dividerFadeTimeoutRef.current = null;
        }, 660);
      }
      container.classList.remove('layout-switch-start-surface');
      container.classList.remove('layout-switch-to-start');
      container.classList.remove('layout-switch-from-start');
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
    if (dividerFadeTimeoutRef.current) {
      window.clearTimeout(dividerFadeTimeoutRef.current);
      dividerFadeTimeoutRef.current = null;
    }
    layoutAnimationsRef.current.forEach((animation) => animation.cancel());
    layoutAnimationsRef.current = [];
    containerRef.current?.classList.remove('layout-switch-animating');
    containerRef.current?.classList.remove('layout-switch-start-surface');
    containerRef.current?.classList.remove('layout-switch-to-start');
    containerRef.current?.classList.remove('layout-switch-from-start');
    containerRef.current?.classList.remove('layout-switch-divider-fade-in');
  }, [containerRef]);
}
