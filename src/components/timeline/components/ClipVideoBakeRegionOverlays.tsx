import { memo } from 'react';
import type { ClipVideoBakeRegionOverlay } from '../utils/activeRegionOverlays';

interface ClipVideoBakeRegionOverlaysProps {
  overlays: readonly ClipVideoBakeRegionOverlay[];
  onBakeRegion: (regionId: string) => void | Promise<void>;
  onUnbakeRegion: (regionId: string) => void;
  onRemoveRegion: (regionId: string) => void;
}

export const ClipVideoBakeRegionOverlays = memo(function ClipVideoBakeRegionOverlays({
  overlays,
  onBakeRegion,
  onUnbakeRegion,
  onRemoveRegion,
}: ClipVideoBakeRegionOverlaysProps) {
  return (
    <>
      {overlays.map((overlay) => (
        <div
          key={overlay.id}
          className={`clip-video-bake-region ${overlay.selection ? 'selection' : ''} status-${overlay.status ?? 'marked'}`}
          style={{
            left: overlay.left,
            width: overlay.width,
          }}
          title={overlay.selection ? 'Video bake selection' : 'Video bake region'}
        >
          {!overlay.selection && (
            <div className="clip-video-bake-region-controls">
              <button
                type="button"
                className="clip-video-bake-btn"
                disabled={overlay.status === 'baking'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (overlay.status === 'baked') {
                    onUnbakeRegion(overlay.id);
                    return;
                  }
                  void onBakeRegion(overlay.id);
                }}
                title={overlay.status === 'baked' ? 'Unbake video region' : 'Bake video region'}
              >
                {overlay.status === 'baked' ? 'Unbake' : overlay.status === 'baking' ? '...' : 'Bake'}
              </button>
              <button
                type="button"
                className="clip-video-bake-btn remove"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveRegion(overlay.id);
                }}
                title="Remove video bake region"
              >
                x
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
});
