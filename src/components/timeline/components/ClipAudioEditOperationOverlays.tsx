import { memo } from 'react';
import type { AudioEditOperationOverlay } from '../utils/activeRegionOverlays';

interface ClipAudioEditOperationOverlaysProps {
  overlays: readonly AudioEditOperationOverlay[];
  onActivateOverlay: (overlay: AudioEditOperationOverlay) => void;
}

export const ClipAudioEditOperationOverlays = memo(function ClipAudioEditOperationOverlays({
  overlays,
  onActivateOverlay,
}: ClipAudioEditOperationOverlaysProps) {
  return (
    <>
      {overlays.map((overlay) => (
        <div
          key={overlay.id}
          className="clip-audio-edit-operation-overlay"
          data-audio-edit-type={overlay.type}
          role="button"
          tabIndex={0}
          style={{
            left: overlay.left,
            width: overlay.width,
            top: overlay.top,
            height: overlay.height,
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onActivateOverlay(overlay);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            onActivateOverlay(overlay);
          }}
          title={overlay.label}
        >
          <span>{overlay.label}</span>
        </div>
      ))}
    </>
  );
});
