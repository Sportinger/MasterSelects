// Mobile Toolbar - Cut and Precision buttons

import { useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';


interface MobileToolbarProps {
  onCut: () => void;
  precisionMode: boolean;
  onPrecisionModeChange: (mode: boolean) => void;
}

export function MobileToolbar({
  onCut,
  precisionMode,
  onPrecisionModeChange,
}: MobileToolbarProps) {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const play = useTimelineStore((s) => s.play);
  const pause = useTimelineStore((s) => s.pause);
  const playheadPosition = useTimelineStore((s) => s.playheadPosition);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Format time as MM:SS.ms
  const formatTime = useCallback((time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }, []);

  return (
    <div className="mobile-toolbar">
      {/* Precision button - hold for slow drag */}
      <button
        className={`mobile-toolbar-btn precision ${precisionMode ? 'active' : ''}`}
        onTouchStart={() => onPrecisionModeChange(true)}
        onTouchEnd={() => onPrecisionModeChange(false)}
        onTouchCancel={() => onPrecisionModeChange(false)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
        </svg>
      </button>

      {/* Timecode display */}
      <div className="mobile-toolbar-time">
        {formatTime(playheadPosition)}
      </div>

      {/* Play/Pause button */}
      <button
        className="mobile-toolbar-btn play"
        onClick={togglePlayback}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* Cut button */}
      <button
        className="mobile-toolbar-btn cut"
        onClick={onCut}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3h-3z"/>
        </svg>
      </button>
    </div>
  );
}
