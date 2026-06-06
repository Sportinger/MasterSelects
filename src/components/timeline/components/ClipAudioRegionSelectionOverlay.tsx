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
  onSelectionMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onEdgeMouseDown?: (edge: 'left' | 'right') => (e: React.MouseEvent<HTMLSpanElement>) => void;
  onGainMouseDown?: (mode: AudioRegionGainHandleMode) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => void;
  onResetGain?: () => void;
  interactive?: boolean;
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
  interactive = true,
}: ClipAudioRegionSelectionOverlayProps) {
  return (
    <div
      className={`clip-audio-region-selection ${snappedToZeroCrossing ? 'snapped' : ''} ${moving ? 'moving' : ''} ${resizing ? 'resizing' : ''} ${interactive ? '' : 'read-only'}`}
      style={{
        left: overlay.left,
        width: overlay.width,
      }}
      onMouseDown={interactive ? onSelectionMouseDown : undefined}
      onContextMenu={interactive ? onContextMenu : undefined}
      title="Drag to move the selected audio region; drag edges to resize"
    >
      <span
        className="clip-audio-region-edge left"
        onMouseDown={interactive ? onEdgeMouseDown?.('left') : undefined}
        title="Drag to resize the selected audio region start"
      />
      <span
        className="clip-audio-region-edge right"
        onMouseDown={interactive ? onEdgeMouseDown?.('right') : undefined}
        title="Drag to resize the selected audio region end"
      />
      {gainControl && (
        <div
          className="clip-audio-region-gain-control"
          style={{ top: `${gainControl.yPercent}%` }}
        >
          <div
            className="clip-audio-region-gain-line"
            onMouseDown={interactive ? onGainMouseDown?.('gain') : undefined}
            onDoubleClick={interactive ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onResetGain?.();
              } : undefined}
            title="Drag to set region gain; double-click to reset"
          />
          <button
            type="button"
            className="clip-audio-region-fade-handle fade-in"
            style={{ left: gainControl.fadeInPx }}
            onMouseDown={interactive ? onGainMouseDown?.('fade-in') : undefined}
            title={`Fade in gain change: ${gainControl.fadeInSeconds.toFixed(2)}s`}
          />
          <button
            type="button"
            className="clip-audio-region-fade-handle fade-out"
            style={{ right: gainControl.fadeOutPx }}
            onMouseDown={interactive ? onGainMouseDown?.('fade-out') : undefined}
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
