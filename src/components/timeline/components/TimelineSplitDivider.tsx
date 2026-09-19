import type { PointerEventHandler } from 'react';
import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';

interface TimelineSplitDividerProps {
  audioLayerAdvancedMode: boolean;
  isDragging: boolean;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onTrackFocusStep: (direction: 'up' | 'down') => void;
  onToggleAudioLayerAdvancedMode: () => void;
  trackFocusMode: TimelineTrackFocusMode;
}

export function TimelineSplitDivider({
  audioLayerAdvancedMode,
  isDragging,
  onPointerDown,
  onTrackFocusStep,
  onToggleAudioLayerAdvancedMode,
  trackFocusMode,
}: TimelineSplitDividerProps) {
  return (
    <div
      className={`timeline-split-divider ${isDragging ? 'dragging' : ''}`}
      aria-label="Timeline split controls"
    >
      <div
        className="timeline-split-divider-hitbox"
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize video and audio track sections"
      />
      <div className="timeline-split-divider-controls">
        <button
          type="button"
          className="timeline-split-button"
          onClick={() => onTrackFocusStep('up')}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={trackFocusMode === 'audio'}
          title={trackFocusMode === 'audio' ? 'Already in audio focus' : 'Move track focus up'}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>
        <button
          type="button"
          className="timeline-split-button"
          onClick={() => onTrackFocusStep('down')}
          onPointerDown={(event) => event.stopPropagation()}
          disabled={trackFocusMode === 'video'}
          title={trackFocusMode === 'video' ? 'Already in video focus' : 'Move track focus down'}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <button
          type="button"
          className={`timeline-split-button timeline-audio-layer-mode-button ${audioLayerAdvancedMode ? 'active' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleAudioLayerAdvancedMode();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-pressed={audioLayerAdvancedMode}
          title={audioLayerAdvancedMode ? 'Hide advanced audio layer controls' : 'Show advanced audio layer controls'}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4-6.2-4-6.2-4z" />
            <circle cx="8" cy="8" r="1.8" />
            {!audioLayerAdvancedMode && <path d="M3 3l10 10" />}
          </svg>
        </button>
      </div>
      <div className="timeline-split-divider-line" />
    </div>
  );
}
