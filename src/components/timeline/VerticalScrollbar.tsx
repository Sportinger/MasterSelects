// VerticalScrollbar - Custom vertical scrollbar with handles
// Matches the horizontal TimelineNavigator style

import { useRef, useState, useCallback, useEffect } from 'react';

interface VerticalScrollbarProps {
  scrollY: number;
  contentHeight: number;
  viewportHeight: number;
  onScrollChange: (scrollY: number) => void;
}

export function VerticalScrollbar({
  scrollY,
  contentHeight,
  viewportHeight,
  onScrollChange,
}: VerticalScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'thumb' | 'top' | 'bottom' | null>(null);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartScrollY, setDragStartScrollY] = useState(0);

  // Calculate thumb position and size
  const trackHeight = trackRef.current?.clientHeight ?? 200;

  // Thumb height represents the viewport as a fraction of total content
  const thumbHeightRatio = Math.min(1, viewportHeight / Math.max(1, contentHeight));
  const thumbHeight = Math.max(40, thumbHeightRatio * trackHeight); // Min 40px height

  // Thumb position represents scrollY as a fraction of scrollable area
  const maxScrollY = Math.max(0, contentHeight - viewportHeight);
  const scrollRatio = maxScrollY > 0 ? scrollY / maxScrollY : 0;
  const thumbTop = scrollRatio * (trackHeight - thumbHeight);

  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'thumb' | 'top' | 'bottom') => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(type);
    setDragStartY(e.clientY);
    setDragStartScrollY(scrollY);
  }, [scrollY]);

  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current || isDragging) return;

    const rect = trackRef.current.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const clickRatio = clickY / rect.height;

    // Jump to clicked position (center the thumb there)
    const newScrollRatio = Math.max(0, Math.min(1, clickRatio - thumbHeightRatio / 2));
    const newScrollY = newScrollRatio * maxScrollY;
    onScrollChange(Math.max(0, newScrollY));
  }, [isDragging, thumbHeightRatio, maxScrollY, onScrollChange]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartY;
      const trackHeight = trackRef.current?.clientHeight ?? 200;

      if (isDragging === 'thumb') {
        // Drag the thumb to scroll - fixed direction (not inverted)
        const scrollableTrackHeight = trackHeight - thumbHeight;
        if (scrollableTrackHeight <= 0) return;

        const deltaRatio = deltaY / scrollableTrackHeight;
        const newScrollY = dragStartScrollY + deltaRatio * maxScrollY;
        onScrollChange(Math.max(0, Math.min(maxScrollY, newScrollY)));
      } else if (isDragging === 'top' || isDragging === 'bottom') {
        // Handles just scroll for now (no resize behavior for vertical)
        const scrollableTrackHeight = trackHeight - thumbHeight;
        if (scrollableTrackHeight <= 0) return;

        const deltaRatio = deltaY / scrollableTrackHeight;
        const newScrollY = dragStartScrollY + deltaRatio * maxScrollY;
        onScrollChange(Math.max(0, Math.min(maxScrollY, newScrollY)));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStartY, dragStartScrollY, thumbHeight, maxScrollY, onScrollChange]);

  // Don't show scrollbar if content fits in viewport
  if (contentHeight <= viewportHeight) {
    return null;
  }

  return (
    <div className="vertical-scrollbar">
      <div
        className="vertical-scrollbar-track"
        ref={trackRef}
        onClick={handleTrackClick}
      >
        <div
          className={`vertical-scrollbar-thumb ${isDragging ? 'dragging' : ''}`}
          style={{
            top: thumbTop,
            height: thumbHeight,
          }}
          onMouseDown={(e) => handleMouseDown(e, 'thumb')}
        >
          <div
            className="vertical-scrollbar-handle vertical-scrollbar-handle-top"
            onMouseDown={(e) => handleMouseDown(e, 'top')}
          />
          <div className="vertical-scrollbar-grip" />
          <div
            className="vertical-scrollbar-handle vertical-scrollbar-handle-bottom"
            onMouseDown={(e) => handleMouseDown(e, 'bottom')}
          />
        </div>
      </div>
    </div>
  );
}
