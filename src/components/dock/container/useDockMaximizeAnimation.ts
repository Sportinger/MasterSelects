import { useEffect, useRef } from 'react';

interface UseDockMaximizeAnimationArgs {
  containerRef: React.RefObject<HTMLDivElement | null>;
  maximizedPanelId: string | null;
}

export function useDockMaximizeAnimation({
  containerRef,
  maximizedPanelId,
}: UseDockMaximizeAnimationArgs): void {
  const hasMountedRef = useRef(false);
  const maximizeAnimationTimeoutRef = useRef<number | null>(null);

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
  }, [containerRef, maximizedPanelId]);
}
