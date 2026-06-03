import { memo } from 'react';

interface ClipSelectionHitareasProps {
  canSelectAudioRegion: boolean;
  canSelectVideoBakeRegion: boolean;
  canSelectSpectralRegion: boolean;
  onAudioRegionMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onAudioRegionDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVideoBakeRegionMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onVideoBakeRegionDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onSpectralRegionMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onSpectralRegionDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onSpectralRegionDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onSpectralRegionDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export const ClipSelectionHitareas = memo(function ClipSelectionHitareas({
  canSelectAudioRegion,
  canSelectVideoBakeRegion,
  canSelectSpectralRegion,
  onAudioRegionMouseDown,
  onAudioRegionDoubleClick,
  onVideoBakeRegionMouseDown,
  onVideoBakeRegionDoubleClick,
  onSpectralRegionMouseDown,
  onSpectralRegionDragOver,
  onSpectralRegionDrop,
  onSpectralRegionDoubleClick,
}: ClipSelectionHitareasProps) {
  return (
    <>
      {canSelectAudioRegion && (
        <div
          className="clip-audio-region-hitarea"
          onMouseDown={onAudioRegionMouseDown}
          onDoubleClick={onAudioRegionDoubleClick}
          title="Double-click to select the whole clip; hold Ctrl/Strg and drag to select an audio region"
        />
      )}
      {canSelectVideoBakeRegion && (
        <div
          className="clip-video-bake-region-hitarea"
          onMouseDown={onVideoBakeRegionMouseDown}
          onDoubleClick={onVideoBakeRegionDoubleClick}
          title="Double-click to mark the whole clip; hold Ctrl/Strg and drag to mark a video bake region"
        />
      )}
      {canSelectSpectralRegion && (
        <div
          className="clip-audio-region-hitarea clip-spectral-region-hitarea"
          onMouseDown={onSpectralRegionMouseDown}
          onDragOver={onSpectralRegionDragOver}
          onDrop={onSpectralRegionDrop}
          onDoubleClick={onSpectralRegionDoubleClick}
          title="Hold Ctrl/Strg and drag to select a spectral region; add Shift or Alt for brush"
        />
      )}
    </>
  );
});
