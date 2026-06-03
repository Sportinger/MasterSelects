import { memo } from 'react';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineSpectralRegionEditType } from '../../../stores/timeline/types';
import type {
  SpectralImageLayerOverlay,
  SpectralRegionOverlay,
} from '../utils/spectralRegionOverlays';

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface ClipSpectralRegionOverlaysProps {
  regionOverlay: SpectralRegionOverlay | null;
  selectionMode?: 'rectangle' | 'brush';
  imageLayerOverlays: readonly SpectralImageLayerOverlay[];
  canSelectSpectralRegion: boolean;
  selectedSpectralImageFile: MediaFile | null;
  onToolbarMouseDown: (e: React.MouseEvent) => void;
  onApplySpectralRegionEdit: (type: TimelineSpectralRegionEditType) => (e: React.MouseEvent) => void;
  onAddSelectedImageSpectralLayer: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const ClipSpectralRegionOverlays = memo(function ClipSpectralRegionOverlays({
  regionOverlay,
  selectionMode,
  imageLayerOverlays,
  canSelectSpectralRegion,
  selectedSpectralImageFile,
  onToolbarMouseDown,
  onApplySpectralRegionEdit,
  onAddSelectedImageSpectralLayer,
}: ClipSpectralRegionOverlaysProps) {
  return (
    <>
      {regionOverlay && (
        <div
          className={`clip-spectral-region-selection ${selectionMode === 'brush' ? 'brush' : 'rectangle'}`}
          style={{
            left: regionOverlay.left,
            width: regionOverlay.width,
            top: regionOverlay.top,
            height: regionOverlay.height,
          }}
        >
          <span className="clip-spectral-region-corner tl" />
          <span className="clip-spectral-region-corner tr" />
          <span className="clip-spectral-region-corner bl" />
          <span className="clip-spectral-region-corner br" />
        </div>
      )}
      {imageLayerOverlays.map(({ id, left: overlayLeft, width: overlayWidth, top, height, layer, mediaFile }) => {
        const blendMode = layer.blendMode ?? 'attenuate';
        const opacity = finiteNumberOr(layer.opacity, 0.85);
        const gainDb = finiteNumberOr(layer.gainDb, -18);
        const imageUrl = mediaFile?.thumbnailUrl || mediaFile?.url;

        return (
          <div
            key={id}
            className={`clip-spectral-image-layer blend-${blendMode} ${layer.enabled === false ? 'disabled' : ''}`}
            style={{
              left: overlayLeft,
              width: overlayWidth,
              top,
              height,
              opacity: Math.max(0.18, opacity),
              backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
            }}
            title={`${mediaFile?.name ?? 'Spectral image'}: ${blendMode}, ${gainDb.toFixed(1)} dB`}
          >
            <span>{blendMode}</span>
          </div>
        );
      })}
      {regionOverlay && canSelectSpectralRegion && (
        <div
          className="clip-spectral-region-toolbar"
          style={{
            left: Math.max(4, regionOverlay.left),
            top: Math.max(20, regionOverlay.top),
          }}
          onMouseDown={onToolbarMouseDown}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={onApplySpectralRegionEdit('spectral-mask')} title="Attenuate selected frequency region">Mask</button>
          <button type="button" onClick={onApplySpectralRegionEdit('spectral-resynthesis')} title="Create a resynthesis operation for the selected frequency region">Resyn</button>
          <button
            type="button"
            onClick={onAddSelectedImageSpectralLayer}
            disabled={!selectedSpectralImageFile}
            title={selectedSpectralImageFile ? `Add ${selectedSpectralImageFile.name} as a spectral image layer` : 'Select an image in the Media panel first'}
          >
            Img
          </button>
        </div>
      )}
    </>
  );
});
