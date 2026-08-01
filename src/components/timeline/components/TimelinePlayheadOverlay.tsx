import type { CSSProperties, RefObject } from 'react';

interface TimelinePlayheadOverlayProps {
  inlineStyle: CSSProperties | undefined;
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  playheadRef: RefObject<HTMLDivElement | null>;
  show: boolean;
  switchMotionClass: string;
}

export function TimelinePlayheadOverlay({
  inlineStyle,
  onMouseDown,
  playheadRef,
  show,
  switchMotionClass,
}: TimelinePlayheadOverlayProps) {
  if (!show) return null;

  return (
    <div
      ref={playheadRef}
      className={`playhead ${switchMotionClass}`}
      data-ai-id="timeline-playhead"
      aria-label="Timeline playhead"
      style={inlineStyle}
      onMouseDown={onMouseDown}
    >
      <div className="playhead-head" />
      <div className="playhead-line" />
    </div>
  );
}
