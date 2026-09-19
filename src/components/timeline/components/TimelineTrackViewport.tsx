import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface TimelineTrackViewportProps {
  enabled: boolean;
  forceVisible: boolean;
  height: number;
  trackId: string;
  children: ReactNode;
}

/** Keep lane geometry for scrolling while unmounting offscreen GPU/worker owners. */
export function TimelineTrackViewport({
  enabled, forceVisible, height, trackId, children,
}: TimelineTrackViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const canObserve = typeof IntersectionObserver !== 'undefined';
  useLayoutEffect(() => {
    if (!enabled || !canObserve || !ref.current) return;
    const element = ref.current;
    // Observe the scrolling section, not the whole document. A section can be
    // clipped by another panel while still lying inside the browser viewport.
    const root = element.closest('.timeline-section-viewport');
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      clearTimeout(releaseTimer);
      if (entry.isIntersecting) {
        setVisible(true);
      } else {
        // Brief reversals at the viewport edge should reuse the canvas/worker.
        // Sustained scrolling still releases resources shortly after exit.
        releaseTimer = setTimeout(() => setVisible(false), 200);
      }
    }, { root, rootMargin: '160px 0px' });
    observer.observe(element);
    return () => { clearTimeout(releaseTimer); observer.disconnect(); };
  }, [canObserve, enabled]);

  if (!enabled) return children;
  return (
    <div ref={ref} className="timeline-track-viewport" style={{ height, flexShrink: 0 }}>
      {visible || forceVisible || !canObserve ? children : (
        <div className="track-lane" data-track-id={trackId}
          data-dock-layout-child-anim-id={`timeline-track-lane:${trackId}`}
          data-virtualized="true" style={{ height }} />
      )}
    </div>
  );
}
