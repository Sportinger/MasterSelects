import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

interface TimelineRootShellProps {
  activeTrackResizeId: string | null;
  audioDisplayMode: string;
  audioFocusMode: boolean;
  children: ReactNode;
  clipInteractionActive: boolean;
  effectiveAudioLayerAdvancedMode: boolean;
  isHeaderWidthResizing: boolean;
  onMouseDownCapture: MouseEventHandler<HTMLDivElement>;
  openCompositionCount: number;
  splitDragSmoothing: boolean;
  splitDragVideoHeight: number | null;
  trackFocusMode: string;
  trackHeaderWidth: number;
}

export function TimelineRootShell({
  activeTrackResizeId,
  audioDisplayMode,
  audioFocusMode,
  children,
  clipInteractionActive,
  effectiveAudioLayerAdvancedMode,
  isHeaderWidthResizing,
  onMouseDownCapture,
  openCompositionCount,
  splitDragSmoothing,
  splitDragVideoHeight,
  trackFocusMode,
  trackHeaderWidth,
}: TimelineRootShellProps) {
  if (openCompositionCount === 0) {
    return (
      <div className="timeline-container timeline-empty">
        <div className="timeline-empty-message">
          <p>No composition open</p>
          <p className="hint">Double-click a composition in the Media panel to open it</p>
        </div>
      </div>
    );
  }

  const className = [
    'timeline-container',
    `audio-mode-${audioDisplayMode}`,
    `audio-layer-${effectiveAudioLayerAdvancedMode ? 'advanced' : 'basic'}`,
    `timeline-split-mode-${trackFocusMode}`,
    audioFocusMode ? 'audio-focus-mode' : '',
    trackFocusMode === 'video' ? 'video-focus-mode' : '',
    splitDragVideoHeight !== null ? 'is-split-dragging' : '',
    splitDragSmoothing ? 'is-split-drag-smoothing' : '',
    activeTrackResizeId !== null ? 'is-track-resizing' : '',
    isHeaderWidthResizing ? 'is-header-width-resizing' : '',
    clipInteractionActive ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={{ '--track-header-width': `${trackHeaderWidth}px` } as CSSProperties}
      onMouseDownCapture={onMouseDownCapture}
    >
      {children}
    </div>
  );
}
