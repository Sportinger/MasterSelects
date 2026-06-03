import { memo } from 'react';
import type {
  AudioRegionGainControlOverlay,
  TimelineRegionOverlay,
} from '../utils/activeRegionOverlays';
import { formatAudioRegionGainLabel } from '../utils/audioRegionDisplay';

export type AudioRegionGainHandleMode = 'gain' | 'fade-in' | 'fade-out';

interface ClipAudioRegionSelectionOverlayProps {
  overlay: TimelineRegionOverlay;
  snappedToZeroCrossing: boolean;
  moving: boolean;
  resizing: boolean;
  gainControl: AudioRegionGainControlOverlay | null;
  onSelectionMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onEdgeMouseDown: (edge: 'left' | 'right') => (e: React.MouseEvent<HTMLSpanElement>) => void;
  onGainMouseDown: (mode: AudioRegionGainHandleMode) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => void;
  onResetGain: () => void;
}

export const ClipAudioRegionSelectionOverlay = memo(function ClipAudioRegionSelectionOverlay({
  overlay,
  snappedToZeroCrossing,
  moving,
  resizing,
  gainControl,
  onSelectionMouseDown,
  onContextMenu,
  onEdgeMouseDown,
  onGainMouseDown,
  onResetGain,
}: ClipAudioRegionSelectionOverlayProps) {
  return (
    <div
      className={`clip-audio-region-selection ${snappedToZeroCrossing ? 'snapped' : ''} ${moving ? 'moving' : ''} ${resizing ? 'resizing' : ''}`}
      style={{
        left: overlay.left,
        width: overlay.width,
      }}
      onMouseDown={onSelectionMouseDown}
      onContextMenu={onContextMenu}
      title="Drag to move the selected audio region; drag edges to resize"
    >
      <span
        className="clip-audio-region-edge left"
        onMouseDown={onEdgeMouseDown('left')}
        title="Drag to resize the selected audio region start"
      />
      <span
        className="clip-audio-region-edge right"
        onMouseDown={onEdgeMouseDown('right')}
        title="Drag to resize the selected audio region end"
      />
      {gainControl && (
        <div
          className="clip-audio-region-gain-control"
          style={{ top: `${gainControl.yPercent}%` }}
        >
          <div
            className="clip-audio-region-gain-line"
            onMouseDown={onGainMouseDown('gain')}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onResetGain();
            }}
            title="Drag to set region gain; double-click to reset"
          />
          <button
            type="button"
            className="clip-audio-region-fade-handle fade-in"
            style={{ left: gainControl.fadeInPx }}
            onMouseDown={onGainMouseDown('fade-in')}
            title={`Fade in gain change: ${gainControl.fadeInSeconds.toFixed(2)}s`}
          />
          <button
            type="button"
            className="clip-audio-region-fade-handle fade-out"
            style={{ right: gainControl.fadeOutPx }}
            onMouseDown={onGainMouseDown('fade-out')}
            title={`Fade out gain change: ${gainControl.fadeOutSeconds.toFixed(2)}s`}
          />
          <span className="clip-audio-region-gain-value">
            {formatAudioRegionGainLabel(gainControl.gainDb)}
          </span>
        </div>
      )}
    </div>
  );
});
