import { IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import type { PreviewCanvasZoom } from './usePreviewCanvasZoom';

interface PreviewCanvasZoomBarProps {
  zoom: PreviewCanvasZoom;
  compositionSize: { width: number; height: number };
  focusable: boolean;
}

/** Replaces the time transport for still images: zoom level, fit, 1:1 and zoom steps. */
export function PreviewCanvasZoomBar({ zoom, compositionSize, focusable }: PreviewCanvasZoomBarProps) {
  const tabIndex = focusable ? 0 : -1;
  return (
    <div className="preview-transport-row preview-canvas-zoom-bar">
      <span className="preview-canvas-zoom-size">{compositionSize.width} × {compositionSize.height} px</span>
      <div className="preview-transport-buttons">
        <button aria-label="Zoom out" onClick={zoom.zoomOut} tabIndex={tabIndex} title="Zoom out" type="button">
          <IconZoomOut aria-hidden="true" />
        </button>
        <button className="preview-canvas-zoom-text" onClick={zoom.fit} tabIndex={tabIndex} title="Fit to view" type="button">
          Fit
        </button>
        <button className="preview-canvas-zoom-text" onClick={zoom.actualPixels} tabIndex={tabIndex} title="Actual pixels (100%)" type="button">
          1:1
        </button>
        <button aria-label="Zoom in" onClick={zoom.zoomIn} tabIndex={tabIndex} title="Zoom in" type="button">
          <IconZoomIn aria-hidden="true" />
        </button>
      </div>
      <output aria-label="Zoom level">{zoom.percent}%</output>
    </div>
  );
}
